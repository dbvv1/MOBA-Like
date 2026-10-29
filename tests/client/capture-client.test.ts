import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({world:null as any,destroy:vi.fn(),createWorld:vi.fn(),prepareError:null as Error|null}));
vi.mock('../../src/render/world.js',()=>({createWorld:async(...args:unknown[])=>{mocks.createWorld(...args);return mocks.world;}}));
vi.mock('../../src/sim/navigation.js',()=>({createDetourNavigation:async()=>({destroy:mocks.destroy})}));
vi.mock('../../src/capture/bundle.js',async importOriginal=>({...await importOriginal<typeof import('../../src/capture/bundle.js')>(),verifyBrowserBundle:async()=>({sha256:'b'.repeat(64),files:[]})}));
vi.mock('../../src/capture/session.js',()=>({CaptureSession:class {
  sim={catalog:{}};frame=0;constructor(readonly config:any){}
  get metadata(){return {frame:this.frame,frames:this.config.frames,complete:this.frame===this.config.frames-1,shot:this.config.shot,seed:this.config.seed,input:this.config.input,t:(this.config.startFrame+this.frame)/60,virtualFrame:this.config.startFrame+this.frame,simTick:Math.floor((this.config.startFrame+this.frame)/2)};}
  async prepare(_world:unknown,_yield:unknown,progress:(value:any)=>void){progress({phase:'preroll',completed:0,total:6060,virtualFrame:0});if(mocks.prepareError)throw mocks.prepareError;progress({phase:'warmup',completed:12,total:12,virtualFrame:6060});}
  next(_world:unknown,frame=this.frame){if(frame!==this.frame)throw new Error('Stale frame acknowledgment');if(this.frame===this.config.frames-1)return false;this.frame++;return true;}
}}));
class Element extends EventTarget {
  textContent='';hidden=false;disabled=false;value=0;max=1;href='';download='';clicks=0;
  removeAttribute(name:string){if(name==='href')this.href='';}
  click(){if(!this.disabled){this.clicks++;this.dispatchEvent(new Event('click'));}}
}
let nodes:Map<string,Element>,host:EventTarget&{__shot?:any;__shotNext?:(frame?:number)=>boolean},callback:BlobCallback;
const node=(id:string)=>nodes.get(id)!;
beforeEach(()=>{
  vi.resetModules();mocks.prepareError=null;mocks.destroy.mockClear();mocks.createWorld.mockClear();
  nodes=new Map(['stage','notice','error','progress','identity','metadata','next','next-15','save','downloads','download-label','png','json'].map(id=>[`capture-${id}`,new Element()]));
  node('capture-downloads').hidden=true;
  host=new EventTarget();
  const canvas=Object.assign(new EventTarget(),{width:1280,height:720,toBlob:(fn:BlobCallback)=>{callback=fn;}});
  const gl={isContextLost:()=>false,getExtension:()=>null,getParameter:(key:number)=>key===1?'llvmpipe':'test',RENDERER:1,VENDOR:2,VERSION:3,finish:vi.fn()};
  mocks.world={canvas,setCaptureView:vi.fn(),captureContext:()=>gl,captureState:()=>({viewport:{bufferWidth:1280,bufferHeight:720}}),renderOnly:vi.fn(),dispose:vi.fn()};
  vi.stubGlobal('window',host);vi.stubGlobal('document',{querySelector:(selector:string)=>nodes.get(selector.slice(1))});
  vi.stubGlobal('location',{href:'https://example.test/capture.html?shot=first-tower&seed=61&t=101&input=idle&frames=18',search:'?shot=first-tower&seed=61&t=101&input=idle&frames=18',reload:vi.fn(),assign:vi.fn()});
  vi.stubGlobal('__MOBA_CAPTURE_BUILD__',{sourceCommit:'a'.repeat(40),sourceDirty:false});
  vi.stubGlobal('fetch',async()=>new Response(new Uint8Array([1])));
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:test-${Math.random()}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
});
afterEach(()=>{host.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('capture page controls (CPU DOM and renderer doubles; not browser/GPU evidence)',()=>{
  it.each([['','baseline'],['&standards=tower-standards','tower-standards']])('passes explicit standards selection to the real world boundary: %s',async(suffix,expected)=>{
    vi.stubGlobal('location',{href:`https://example.test/capture.html?shot=barracks-road${suffix}`,search:`?shot=barracks-road${suffix}`,reload:vi.fn(),assign:vi.fn()});
    await import('../../src/capture/client.js');
    expect(host.__shot.ready).toBe(true);
    expect(mocks.createWorld).toHaveBeenCalledWith(node('capture-stage'),{},expect.objectContaining({standards:expected}));
    expect(mocks.world.setCaptureView).toHaveBeenCalledWith(expect.objectContaining({pose:{position:{x:-82,y:24,z:18},target:{x:-82,y:0,z:0},fov:45}}));
  });
  it('handles 15/1 frame clicks, blocks a repeated busy click, and disables done',async()=>{
    await import('../../src/capture/client.js');expect(host.__shot.ready).toBe(true);
    node('capture-next-15').click();node('capture-next-15').click();
    await vi.waitFor(()=>expect(host.__shot.frame).toBe(15));await vi.waitFor(()=>expect(node('capture-next').disabled).toBe(false));
    node('capture-next').click();await vi.waitFor(()=>expect(node('capture-next').disabled).toBe(false));
    expect(host.__shot.frame).toBe(16);expect(()=>host.__shotNext!(15)).toThrow('Stale');
    node('capture-next-15').click();await vi.waitFor(()=>expect(host.__shot.complete).toBe(true));
    expect(host.__shot.frame).toBe(17);expect(node('capture-next').disabled).toBe(true);expect(node('capture-next-15').disabled).toBe(true);
    expect(host.__shotNext!(17)).toBe(false);expect(node('capture-notice').textContent).toContain('done');
  });
  it('locks stepping while encoding, retains paired links, and releases resources on exit',async()=>{
    await import('../../src/capture/client.js');node('capture-save').click();node('capture-save').click();
    expect(mocks.world.renderOnly).toHaveBeenCalledTimes(1);expect(node('capture-next').disabled).toBe(true);
    expect(()=>host.__shotNext!(0)).toThrow('locked');expect(host.__shot.frame).toBe(0);
    callback(new Blob(['test-only-double-not-real-pixels'],{type:'image/png'}));
    await vi.waitFor(()=>expect(node('capture-downloads').hidden).toBe(false));
    expect(node('capture-png').download.replace(/\.png$/,'.json')).toBe(node('capture-json').download);
    expect(node('capture-png').clicks).toBe(1);expect(node('capture-json').clicks).toBe(1);expect(host.__shot.frame).toBe(0);
    host.dispatchEvent(new Event('pagehide'));expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);expect(mocks.world.dispose).toHaveBeenCalledTimes(1);expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(host.__shotNext).toBeUndefined();expect(node('capture-save').disabled).toBe(true);
  });
  it('stops a 15-frame batch at its first yield when leaving the page',async()=>{
    await import('../../src/capture/client.js');node('capture-next-15').click();expect(host.__shot.frame).toBe(1);
    host.dispatchEvent(new Event('pagehide'));await new Promise(resolve=>setTimeout(resolve,0));
    expect(host.__shot.frame).toBe(1);expect(host.__shotNext).toBeUndefined();expect(mocks.world.dispose).toHaveBeenCalledTimes(1);expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it('shows an encoder failure and permits retry on the unchanged frame',async()=>{
    await import('../../src/capture/client.js');node('capture-save').click();callback(null);
    await vi.waitFor(()=>expect(node('capture-save').disabled).toBe(false));expect(node('capture-error').textContent).toContain('encoding failed');expect(host.__shot.frame).toBe(0);
    node('capture-save').click();callback(new Blob(['test-only-double'],{type:'image/png'}));await vi.waitFor(()=>expect(node('capture-png').clicks).toBe(1));expect(host.__shot.frame).toBe(0);
  });
  it('does not create download URLs for an encoder callback arriving after exit',async()=>{
    await import('../../src/capture/client.js');node('capture-save').click();host.dispatchEvent(new Event('pagehide'));
    callback(new Blob(['test-only-double'],{type:'image/png'}));await new Promise(resolve=>setTimeout(resolve,0));expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('visibly rejects missing secure-context crypto rather than hanging at module loading',async()=>{
    vi.stubGlobal('crypto',{});await import('../../src/capture/client.js');expect(host.__shot.ready).toBe(false);expect(node('capture-error').textContent).toContain('HTTPS or localhost');
  });
  it('surfaces prepare failure instead of leaving Preparing',async()=>{
    mocks.prepareError=new Error('prepare fixture failed');await import('../../src/capture/client.js');
    expect(host.__shot.ready).toBe(false);expect(node('capture-error').textContent).toContain('prepare fixture failed');expect(node('capture-save').disabled).toBe(true);
  });
  it('cleans up and visibly stops when the renderer reports context loss',async()=>{
    await import('../../src/capture/client.js');mocks.world.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
    expect(host.__shotNext).toBeUndefined();expect(node('capture-error').textContent).toContain('WebGL context lost');expect(mocks.world.dispose).toHaveBeenCalledTimes(1);
  });
});
