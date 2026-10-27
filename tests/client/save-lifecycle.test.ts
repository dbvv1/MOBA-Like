import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {LocalMatch,restoreMatch} from '../../src/save/match.js';
import {createSaveSlot,MATCH_SAVE_KEY} from '../../src/save/storage.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
import {FixedClock} from '../../src/render/clock.js';
import {createLifetime} from '../../src/render/lifetime.js';

// Execute the actual client owner with real simulation/storage/navigation and EventTargets.
// Rendering/DOM are stubs: these are lifecycle regressions, NOT browser or WebGL evidence.
class Element extends EventTarget {
  hidden=false;disabled=false;textContent='';
  setAttribute(){}replaceChildren(){}
}
async function host(){
  const ids=new Map(['stage','notice','hud','restart','hero-select','hero-choice-details','sound-toggle'].map(id=>[id,new Element()]));
  const data=new Map<string,string>();
  const localStorage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  type Client={state:()=>{ready:boolean}};
  const window=Object.assign(new EventTarget(),{localStorage,mobaClient:undefined as Client|undefined});
  const document=Object.assign(new EventTarget(),{hidden:false,getElementById:(id:string)=>ids.get(id)});
  const frames=new Map<number,FrameRequestCallback>();let next=0,holdChoice=false,choices=0,panelsDisposed=0,worldsDisposed=0,locksReleased=0;
  const idle=()=>{};
  const code=await readFile(new URL('../../src/client.ts',import.meta.url),'utf8');
  const executable=ts.transpileModule(code.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url','SOURCE_URL'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const nav=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  const bindings={
    window,document,SOURCE_URL:new URL('../../src/client.ts',import.meta.url).href,
    getContent,LocalMatch,restoreMatch,createSaveSlot,createDetourNavigation,FixedClock,createLifetime,SAVE_COMPATIBILITY_ID:'test-rules',
    createHeroSelection:()=>({read:()=>[['veyra'],['veyra']],setBusy:idle}),
    createSavePanel:()=>({button:new Element(),say:idle,dispose:()=>{panelsDisposed++;}}),
    acquireSaveOwnership:async()=>()=>{locksReleased++;},
    chooseSavedMatch:async(_read:unknown,signal:AbortSignal)=>{
      choices++;
      if(!holdChoice)return 'resume';
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
    },
    createWorld:async()=>{let locked=true;return {setLocked:(value:boolean)=>{locked=value;},cameraState:()=>({locked}),sync:idle,draw:idle,effectState:idle,targetingState:idle,motionState:idle,dispose:()=>{worldsDisposed++;}};},
    createBattleAudio:()=>({enabled:true,setEnabled:idle,dispose:idle,unlock:idle,sync:idle}),
    createHud:()=>({say:idle,setLocked:idle,dispose:idle,update:idle,reject:idle,disable:idle}),
    createControls:()=>({skill:idle,dispose:idle,inspectPointer:idle}),
    fetch:async()=>({ok:true,arrayBuffer:async()=>nav.buffer.slice(nav.byteOffset,nav.byteOffset+nav.byteLength)}),
    requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},
    cancelAnimationFrame:(id:number)=>{frames.delete(id);},
  };
  new Function(...Object.keys(bindings),executable)(...Object.values(bindings));
  const event=(type:string)=>{const event=new Event(type);Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);};
  const ready=()=>vi.waitFor(()=>{expect(window.mobaClient?.state().ready).toBe(true);expect(frames.size).toBe(1);});
  return {window,data,frames,ids,event,ready,setHoldChoice:(value:boolean)=>{holdChoice=value;},get choices(){return choices;},counts:()=>({panelsDisposed,worldsDisposed,locksReleased})};
}

describe('local-save client history lifecycle',()=>{
  it('recreates one live owner on two consecutive persisted history returns',async()=>{
    const app=await host();
    try{
      await app.ready();
      for(let cycle=1;cycle<=2;cycle++){
        app.event('pagehide');expect(app.frames.size).toBe(0);expect(app.data.has(MATCH_SAVE_KEY)).toBe(true);
        expect(app.counts()).toEqual({panelsDisposed:cycle,worldsDisposed:cycle,locksReleased:cycle});
        app.event('pageshow');await app.ready();expect(app.choices).toBe(cycle);
      }
    }finally{app.event('pagehide');}
  });
  it('cancels an old pending resume choice without overwriting the next boot UI',async()=>{
    const app=await host();
    try{
      await app.ready();app.event('pagehide');app.setHoldChoice(true);app.event('pageshow');
      await vi.waitFor(()=>expect(app.choices).toBe(1));
      app.event('pagehide');app.setHoldChoice(false);app.event('pageshow');await app.ready();
      expect(app.choices).toBe(2);expect(app.ids.get('notice')!.hidden).toBe(true);expect(app.ids.get('restart')!.disabled).toBe(false);
    }finally{app.event('pagehide');}
  });
});
