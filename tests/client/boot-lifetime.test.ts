import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({navigation:vi.fn(),world:vi.fn(),sound:vi.fn()}));
vi.mock('../../src/sim/navigation.js',()=>({createDetourNavigation:state.navigation}));
vi.mock('../../src/render/world.js',()=>({createWorld:state.world}));
vi.mock('../../src/audio/battle.js',()=>({createBattleAudio:state.sound}));
vi.mock('../../src/ui/hud.js',()=>({createHud:()=>({dispose:vi.fn(),update:vi.fn(),say:vi.fn(),setLocked:vi.fn()})}));
vi.mock('../../src/input/controls.js',()=>({createControls:()=>({dispose:vi.fn()})}));
vi.mock('../../src/ui/hero-selection.js',()=>({createHeroSelection:()=>({read:()=>[['veyra'],['veyra']],setBusy:vi.fn()})}));
class Element extends EventTarget {
  textContent='';hidden=false;disabled=false;style={position:'',inset:''};parent:Element|null=null;children:Element[]=[];
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  replaceChildren=vi.fn((...children:Element[])=>{for(const child of this.children)child.parent=null;this.children=children;for(const child of children)child.parent=this;});
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();state.navigation.mockReset();state.world.mockReset();state.sound.mockReset();});
it('does not write the departed page when pending navigation fails',async()=>{
  const elements=new Map(['stage','notice','hud','restart','hero-select','hero-choice-details'].map(id=>[id,new Element()]));
  const win=new EventTarget();
  vi.stubGlobal('window',win);vi.stubGlobal('document',Object.assign(new EventTarget(),{getElementById:(id:string)=>elements.get(id),createElement:()=>new Element()}));
  let reject!:(reason:Error)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise((_,r)=>{reject=r;})));
  await import('../../src/client.js');
  win.dispatchEvent(new Event('pagehide'));
  const before=elements.get('notice')!.textContent;
  reject(new Error('late network failure'));await new Promise(r=>setTimeout(r,0));
  expect(elements.get('notice')!.textContent).toBe(before);
  expect(elements.get('stage')!.replaceChildren).not.toHaveBeenCalled();
  expect(elements.get('restart')!.disabled).toBe(true);
});
function page(){
  const elements=new Map(['stage','notice','hud','restart','hero-select','hero-choice-details'].map(id=>[id,new Element()]));
  const win=new EventTarget();vi.stubGlobal('window',win);vi.stubGlobal('document',Object.assign(new EventTarget(),{getElementById:(id:string)=>elements.get(id),createElement:()=>new Element()}));
  return {elements,win};
}
function restored(win:EventTarget){const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});win.dispatchEvent(event);}
const flush=()=>new Promise(r=>setTimeout(r,0));
it('aborts each visit, restores with a fresh request, and ignores old completion',async()=>{
  const {elements,win}=page();const requests:Array<{signal:AbortSignal;reject:(e:Error)=>void}>=[];
  vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_,reject)=>requests.push({signal:options.signal,reject}))));
  await import('../../src/client.js');expect(requests).toHaveLength(1);
  win.dispatchEvent(new Event('pagehide'));expect(requests[0]!.signal.aborted).toBe(true);
  restored(win);expect(requests).toHaveLength(2);expect(requests[1]!.signal.aborted).toBe(false);
  requests[0]!.reject(new Error('old failure'));await flush();
  expect(requests[1]!.signal.aborted).toBe(false);expect(elements.get('restart')!.disabled).toBe(true);
  requests[1]!.reject(new Error('current failure'));await flush();
  expect(elements.get('notice')!.textContent).toBe('current failure');expect(elements.get('restart')!.disabled).toBe(false);
  elements.get('restart')!.dispatchEvent(new Event('click'));expect(requests).toHaveLength(3);
  win.dispatchEvent(new Event('pagehide'));expect(requests[2]!.signal.aborted).toBe(true);
  requests[2]!.reject(new Error('second departure'));await flush();
  expect(elements.get('notice')!.textContent).toBe('Loading simulation and Three.js assets…');
});
it('does not decode or create resources from a late fetch response',async()=>{
  const {win}=page();let resolve!:(value:unknown)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{resolve=r;})));
  await import('../../src/client.js');win.dispatchEvent(new Event('pagehide'));
  const arrayBuffer=vi.fn();resolve({ok:true,arrayBuffer});await flush();
  expect(arrayBuffer).not.toHaveBeenCalled();expect(state.navigation).not.toHaveBeenCalled();
});
it('does not initialize navigation from a late response body',async()=>{
  const {win}=page();let resolve!:(value:ArrayBuffer)=>void;
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:()=>new Promise<ArrayBuffer>(r=>{resolve=r;})})));
  await import('../../src/client.js');await flush();win.dispatchEvent(new Event('pagehide'));resolve(new ArrayBuffer(0));await flush();
  expect(state.navigation).not.toHaveBeenCalled();
});
it('releases a real late Detour navigation once without starting sound or world',async()=>{
  const {win,elements}=page();
  const {readFile}=await import('node:fs/promises');
  const actual=await vi.importActual<typeof import('../../src/sim/navigation.js')>('../../src/sim/navigation.js');
  const bytes=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  const navigation=await actual.createDetourNavigation(new Uint8Array(bytes));const destroy=vi.spyOn(navigation,'destroy');
  let resolve!:(value:typeof navigation)=>void;
  state.navigation.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
  await import('../../src/client.js');await flush();win.dispatchEvent(new Event('pagehide'));resolve(navigation);await flush();
  expect(destroy).toHaveBeenCalledTimes(1);expect(state.sound).not.toHaveBeenCalled();expect(state.world).not.toHaveBeenCalled();
  expect(elements.get('notice')!.textContent).toBe('Loading simulation and Three.js assets…');
  win.dispatchEvent(new Event('pagehide'));expect(destroy).toHaveBeenCalledTimes(1);
});

it('normal boot owns navigation until departure and restores a new simulation owner',async()=>{
  const {win,elements}=page();
  const {readFile}=await import('node:fs/promises');
  const actual=await vi.importActual<typeof import('../../src/sim/navigation.js')>('../../src/sim/navigation.js');
  const bytes=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  const releases:ReturnType<typeof vi.fn>[]=[];
  state.navigation.mockImplementation(async()=>{const navigation=await actual.createDetourNavigation(new Uint8Array(bytes));releases.push(vi.spyOn(navigation,'destroy'));return navigation;});
  const worlds:Array<{dispose:ReturnType<typeof vi.fn>}> = [];
  state.world.mockImplementation(async()=>{const world={dispose:vi.fn(),sync:vi.fn()};worlds.push(world);return world;});
  state.sound.mockImplementation(()=>({dispose:vi.fn()}));
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
  elements.set('sound-toggle',Object.assign(new Element(),{setAttribute:vi.fn()}));
  await import('../../src/client.js');await flush();
  expect(Reflect.get(win,'mobaClient').snapshot().tick).toBe(0);expect(elements.get('notice')!.hidden).toBe(true);
  win.dispatchEvent(new Event('pagehide'));expect(Reflect.has(win,'mobaClient')).toBe(false);expect(releases[0]).toHaveBeenCalledTimes(1);expect(worlds[0]!.dispose).toHaveBeenCalledTimes(1);
  restored(win);await flush();expect(Reflect.get(win,'mobaClient').snapshot().tick).toBe(0);expect(worlds).toHaveLength(2);
  win.dispatchEvent(new Event('pagehide'));expect(releases[1]).toHaveBeenCalledTimes(1);expect(worlds[1]!.dispose).toHaveBeenCalledTimes(1);
});
it('releases a late world without clearing the restored visit HUD',async()=>{
  const {win,elements}=page();
  const {readFile}=await import('node:fs/promises');
  const actual=await vi.importActual<typeof import('../../src/sim/navigation.js')>('../../src/sim/navigation.js');
  const bytes=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  state.navigation.mockImplementation(()=>actual.createDetourNavigation(new Uint8Array(bytes)));
  state.sound.mockImplementation(()=>({dispose:vi.fn()}));
  elements.set('sound-toggle',Object.assign(new Element(),{setAttribute:vi.fn()}));
  let resolveWorld!:(world:unknown)=>void;
  state.world.mockImplementation(()=>new Promise(r=>{resolveWorld=r;}));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}).mockRejectedValueOnce(new Error('new visit failure')));
  await import('../../src/client.js');await flush();expect(state.world).toHaveBeenCalledTimes(1);
  win.dispatchEvent(new Event('pagehide'));restored(win);await flush();
  expect(elements.get('notice')!.textContent).toBe('new visit failure');
  const clears=elements.get('stage')!.replaceChildren.mock.calls.length;
  const dispose=vi.fn();resolveWorld({dispose});await flush();
  expect(dispose).toHaveBeenCalledTimes(1);expect(elements.get('notice')!.textContent).toBe('new visit failure');
  expect(elements.get('stage')!.replaceChildren).toHaveBeenCalledTimes(clears);
});

it('an old successful world cannot replace the restored successful visit canvas',async()=>{
  const {win,elements}=page();
  const {readFile}=await import('node:fs/promises');
  const actual=await vi.importActual<typeof import('../../src/sim/navigation.js')>('../../src/sim/navigation.js');
  const bytes=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  state.navigation.mockImplementation(()=>actual.createDetourNavigation(new Uint8Array(bytes)));
  state.sound.mockImplementation(()=>({dispose:vi.fn()}));
  elements.set('sound-toggle',Object.assign(new Element(),{setAttribute:vi.fn()}));
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
  const worlds:Array<{host:Element;canvas:Element;finish:()=>void;dispose:ReturnType<typeof vi.fn>}> = [];
  state.world.mockImplementation((host:Element)=>new Promise(resolve=>{
    const canvas=new Element(),dispose=vi.fn(()=>canvas.remove());
    // Match real createWorld: host replacement occurs after async assets, before return.
    worlds.push({host,canvas,dispose,finish(){host.replaceChildren(canvas);resolve({dispose,sync:vi.fn()});}});
  }));
  await import('../../src/client.js');await flush();expect(worlds).toHaveLength(1);
  win.dispatchEvent(new Event('pagehide'));restored(win);await flush();expect(worlds).toHaveLength(2);
  worlds[1]!.finish();await flush();expect(Reflect.has(win,'mobaClient')).toBe(true);
  const current=worlds[1]!,old=worlds[0]!;
  old.finish();await flush();
  expect(current.canvas.parent).toBe(current.host);
  expect(current.host.children).toContain(current.canvas);
  expect(old.dispose).toHaveBeenCalledTimes(1);expect(current.dispose).not.toHaveBeenCalled();
  expect(elements.get('notice')!.hidden).toBe(true);
  expect(old.host.parent).toBeNull();
  expect(current.host.parent).toBe(elements.get('stage'));
  expect(current.host.style).toEqual({position:'absolute',inset:'0'});
  win.dispatchEvent(new Event('pagehide'));expect(current.dispose).toHaveBeenCalledTimes(1);
});
