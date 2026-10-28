import {describe,expect,it,vi} from 'vitest';
import {advanceCaptureFrames,yieldCaptureTask} from '../../src/capture/tasks.js';
import {snapshotCapture,captureDownload} from '../../src/capture/snapshot.js';
import {validateBundleManifest,verifyBrowserBundle,sha256} from '../../src/capture/bundle.js';

function frames(total:number){
  let frame=0;
  const read=()=>({ready:true,frame,frames:total,complete:frame===total-1});
  const next=vi.fn((ack:number)=>{if(ack!==frame)throw new Error('Stale');if(frame===total-1)return false;frame++;return true;});
  return {read,next};
}
describe('visible capture frame acknowledgments',()=>{
  it('advances exactly 1 then 15 without skipping acknowledgments',async()=>{
    const state=frames(20),yieldTask=vi.fn(async()=>{});
    expect(await advanceCaptureFrames(state.read,state.next,1,yieldTask)).toBe(1);
    expect(await advanceCaptureFrames(state.read,state.next,15,yieldTask)).toBe(15);
    expect(state.next.mock.calls.map(([ack])=>ack)).toEqual(Array.from({length:16},(_,i)=>i));
    expect(state.read().frame).toBe(16);expect(yieldTask).toHaveBeenCalledTimes(14);
  });
  it('clamps a 15-frame request to the final frame and repeated done is inert',async()=>{
    const state=frames(3);
    expect(await advanceCaptureFrames(state.read,state.next,15,async()=>{})).toBe(2);
    expect(await advanceCaptureFrames(state.read,state.next,1,async()=>{})).toBe(0);
    expect(state.next).toHaveBeenCalledTimes(2);
    const single=frames(1);expect(await advanceCaptureFrames(single.read,single.next,15,async()=>{})).toBe(0);expect(single.next).not.toHaveBeenCalled();
  });
  it('detects another consumer advancing while a batch yielded; never silently skips',async()=>{
    const state=frames(30);
    await expect(advanceCaptureFrames(state.read,state.next,15,async()=>{state.next(state.read().frame);})).rejects.toThrow('Stale');
    expect(state.next.mock.calls).toEqual([[0],[1]]);
  });
  it('rejects malformed acknowledgment and non-ready capture',async()=>{
    const state=frames(3);
    await expect(advanceCaptureFrames(state.read,()=>true,1,async()=>{})).rejects.toThrow('exactly one');
    await expect(advanceCaptureFrames(()=>({...state.read(),ready:false}),state.next,1,async()=>{})).rejects.toThrow('not ready');
  });
});
describe('capture cooperative task cleanup',()=>{
  it('yields a real task and can abort before or during a wait',async()=>{
    const live=new AbortController();let settled=false;
    const task=yieldCaptureTask(live.signal).then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);await task;
    const abort=new AbortController(),pending=yieldCaptureTask(abort.signal);abort.abort(new Error('departed'));
    await expect(pending).rejects.toThrow('departed');await expect(yieldCaptureTask(abort.signal)).rejects.toThrow('departed');
  });
  it('closes both ports and removes abort listeners on completion/cancellation',async()=>{
    const channels:Array<{port1:{onmessage:null|(()=>void);close:ReturnType<typeof vi.fn>};port2:{postMessage:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}}> = [];
    class FakeChannel {port1={onmessage:null as null|(()=>void),close:vi.fn()};port2={postMessage:vi.fn(),close:vi.fn()};constructor(){channels.push(this);}}
    vi.stubGlobal('MessageChannel',FakeChannel);
    try{
      const a=new AbortController(),remove=vi.spyOn(a.signal,'removeEventListener');const done=yieldCaptureTask(a.signal);channels[0]!.port1.onmessage!();await done;
      expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
      const b=new AbortController(),pending=yieldCaptureTask(b.signal);b.abort(new Error('cancel'));await expect(pending).rejects.toThrow('cancel');
      for(const channel of channels){expect(channel.port1.close).toHaveBeenCalledTimes(1);expect(channel.port2.close).toHaveBeenCalledTimes(1);expect(channel.port1.onmessage).toBeNull();}
    }finally{vi.unstubAllGlobals();}
  });
});
describe('same-frame WebGL canvas export',()=>{
  const source=(events:string[],callback:(fn:BlobCallback)=>void)=>({renderOnly:()=>events.push('renderOnly'),canvas:{width:1280,height:720,toBlob:(fn:BlobCallback,type?:string)=>{expect(type).toBe('image/png');events.push('bitmap-copy');callback(fn);}}});
  it('copies pixels before any yield and retains that metadata through async encoding',async()=>{
    const events:string[]=[],state={frame:4,virtualFrame:6064,sourceCommit:'a'.repeat(40),bundleSha256:'b'.repeat(64),renderer:'llvmpipe',rendererClass:'software',shot:'first-tower',seed:61,input:'idle',nested:{tick:3032}};
    let callback:BlobCallback=()=>{};
    const pending=snapshotCapture(source(events,fn=>{callback=fn;}),()=>{events.push('metadata');return state;},new AbortController().signal);
    expect(events).toEqual(['renderOnly','metadata','bitmap-copy']);state.frame=5;state.nested.tick=999;
    const png=new Blob(['actual-canvas-test-placeholder'],{type:'image/png'});callback(png);
    const packet=await pending;expect(packet.metadata).toMatchObject({frame:4,nested:{tick:3032}});
    const artifact=await captureDownload(packet,'test-run',0),json=JSON.parse(await artifact.json.text());
    expect(artifact.png).toBe(png);expect(json).toMatchObject({frame:4,sourceCommit:'a'.repeat(40),bundleSha256:'b'.repeat(64),renderer:'llvmpipe',image:{width:1280,height:720},repeatComparison:'not performed'});
    expect(json.pngSha256).toBe(await sha256(await png.arrayBuffer()));expect(artifact.name).toContain('software-llvmpipe');
  });
  it('never changes size, advances simulation or accepts a failed encoder',async()=>{
    const events:string[]=[],bad=source(events,fn=>fn(null));bad.canvas.width=1920;
    expect(()=>snapshotCapture(bad,()=>({}),new AbortController().signal)).toThrow('1280');expect(events).toEqual([]);
    bad.canvas.width=1280;await expect(snapshotCapture(bad,()=>({}),new AbortController().signal)).rejects.toThrow('encoding failed');
    const dirty=source([],()=>{throw new Error('SecurityError');});await expect(snapshotCapture(dirty,()=>({}),new AbortController().signal)).rejects.toThrow('SecurityError');
  });
  it('rejects late encoding after cancellation',async()=>{
    const abort=new AbortController();let callback:BlobCallback=()=>{};
    const pending=snapshotCapture(source([],fn=>{callback=fn;}),()=>({frame:0}),abort.signal);abort.abort(new Error('left page'));
    await expect(pending).rejects.toThrow('left page');callback(new Blob(['png'],{type:'image/png'}));
  });
});
describe('browser bundle evidence',()=>{
  const build={sourceCommit:'a'.repeat(40),sourceDirty:false};
  async function fixture(){
    const bytes=new TextEncoder().encode('actual served module'),files=[{file:'assets/capture.js',sha256:await sha256(bytes)}];
    return {manifest:{format:1,...build,bundle:{sha256:await sha256(new TextEncoder().encode(JSON.stringify(files))),files}},bytes};
  }
  it('requires matching source and exact manifest digest',async()=>{
    const {manifest}=await fixture();expect(await validateBundleManifest(manifest,build)).toEqual(manifest.bundle);
    await expect(validateBundleManifest({...manifest,sourceDirty:true},build)).rejects.toThrow('source');
    await expect(validateBundleManifest({...manifest,bundle:{...manifest.bundle,sha256:'b'.repeat(64)}},build)).rejects.toThrow('digest');
  });
  it.each(['../outside','https://evil.example/x','/absolute','assets/%2fsecret','capture-bundle.json'])('rejects unsafe or self-referential path %s',async file=>{
    const {manifest}=await fixture();manifest.bundle.files[0]!.file=file;await expect(validateBundleManifest(manifest,build)).rejects.toThrow('file');
  });
  it('verifies actual bytes and the running entry module, with redirects disallowed',async()=>{
    const {manifest,bytes}=await fixture(),base=new URL('https://example.test/candidate/');
    const fetcher=vi.fn(async(url:URL,options:RequestInit)=>{expect(options.redirect).toBe('error');return url.pathname.endsWith('capture-bundle.json')?new Response(JSON.stringify(manifest)):new Response(bytes);});
    vi.stubGlobal('fetch',fetcher);
    try{
      expect(await verifyBrowserBundle(base,new URL('assets/capture.js',base).href,build,new AbortController().signal,()=>{})).toEqual(manifest.bundle);
      await expect(verifyBrowserBundle(base,new URL('assets/old.js',base).href,build,new AbortController().signal,()=>{})).rejects.toThrow('absent');
      fetcher.mockImplementation(async(url:URL)=>url.pathname.endsWith('capture-bundle.json')?new Response(JSON.stringify(manifest)):new Response('wrong bytes'));
      await expect(verifyBrowserBundle(base,new URL('assets/capture.js',base).href,build,new AbortController().signal,()=>{})).rejects.toThrow('bytes mismatch');
    }finally{vi.unstubAllGlobals();}
  });
});
