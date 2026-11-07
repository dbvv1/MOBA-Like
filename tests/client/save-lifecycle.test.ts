import {cameraFollowPolicy} from '../../src/render/camera-follow.js';
import {audioPolicyFromSearch} from '../../src/audio/battle.js';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {LocalMatch,restoreMatch} from '../../src/save/match.js';
import {createSaveSlot,MATCH_SAVE_KEY} from '../../src/save/storage.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
import {entryLightingSearch} from '../../src/ui/entry-lighting.js';
import {createGoldReceipt} from '../../src/ui/gold-receipt.js';
import {FixedClock} from '../../src/render/clock.js';
import {createLifetime} from '../../src/render/lifetime.js';
import {createSaveOwnership} from '../../src/save/ownership.js';
import {createAsyncLockManager} from './save-locks.js';

// Execute the actual client owner with real simulation/storage/navigation and EventTargets.
// Rendering/DOM are stubs: these are lifecycle regressions, NOT browser or WebGL evidence.
class Element extends EventTarget {
  hidden=false;disabled=false;textContent='';
  setAttribute(){}replaceChildren(){}
}
async function host(options:{acquire?:ReturnType<typeof createSaveOwnership>;data?:Map<string,string>}={}){
  const ids=new Map(['stage','notice','hud','restart','hero-select','hero-choice-details','sound-toggle','controls-help','keyboard-settings','keyboard-dialog'].map(id=>[id,new Element()]));
  const data=options.data??new Map<string,string>();
  let failWrite=false;
  const localStorage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(failWrite)throw new Error('quota');data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
  type Client={state:()=>{ready:boolean}};
  const window=Object.assign(new EventTarget(),{localStorage,mobaClient:undefined as Client|undefined});
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}},getElementById:(id:string)=>ids.get(id)});
  const frames=new Map<number,FrameRequestCallback>();let next=0,holdChoice=false,choices=0,panelsDisposed=0,worldsDisposed=0,locksReleased=0;
  const panels:Array<{button:Element;status:string}>=[];let hero='veyra';
  let failNavigation=false,failDraw=false;let onNavigation:(()=>void|Promise<void>)|undefined;let choice:'resume'|'new'|'preserve'='resume';
  const idle=()=>{};
  const code=await readFile(new URL('../../src/client.ts',import.meta.url),'utf8');
  const executable=ts.transpileModule(code.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url','SOURCE_URL'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const nav=await readFile(new URL('../../src/sim/nav/lane.navmesh',import.meta.url));
  const bindings={
    entryLightingSearch,cameraFollowPolicy,MINIMUM_ACCEPTANCE_TICKS:300,
    KeyboardBindings:class {label(value:string){return value;}},controlsHelp:()=>'',createKeyboardSettings:()=>({dispose:()=>{}}),parseLightingStyle:()=> 'baseline',location:{search:''},
    window,document,SOURCE_URL:new URL('../../src/client.ts',import.meta.url).href,
    getContent,LocalMatch,restoreMatch,createSaveSlot,createDetourNavigation,FixedClock,createLifetime,SAVE_COMPATIBILITY_ID:'test-rules',
    createHeroSelection:()=>({read:()=>[[hero],['veyra']],setBusy:idle,refresh:idle}),
    createSavePanel:()=>{const panel={button:new Element(),status:''};panels.push(panel);return {...panel,say:(text:string)=>{panel.status=text;},dispose:()=>{panelsDisposed++;}};},
    acquireSaveOwnership:options.acquire??(async()=>()=>{locksReleased++;}),
    chooseSavedMatch:async(_read:unknown,signal:AbortSignal)=>{
      choices++;
      if(!holdChoice)return choice;
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
    },
    createPlayableWorld:async()=>{let locked=true;return {backend:'three-webgl2',fallbackReason:'',cameraPolicy:'baseline',world:{setLocked:(value:boolean)=>{locked=value;},lightingState:idle,leavePointer:idle,cameraState:()=>({locked}),sync:idle,draw:()=>{if(failDraw)throw new Error('draw failed');},effectState:idle,targetingState:idle,motionState:idle,dispose:()=>{worldsDisposed++;}}};},
    audioPolicyFromSearch,createBattleAudio:()=>({enabled:true,setEnabled:idle,dispose:idle,unlock:idle,sync:idle}),
    createHud:()=>({say:idle,setLocked:idle,dispose:idle,update:idle,reject:idle,disable:idle}),createGoldReceipt,
    createControls:()=>({sync:idle,setEnabled:idle,skill:idle,dispose:idle,inspectPointer:idle}),
    fetch:async()=>{await onNavigation?.();return {ok:!failNavigation,status:503,arrayBuffer:async()=>nav.buffer.slice(nav.byteOffset,nav.byteOffset+nav.byteLength)};},
    requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},
    cancelAnimationFrame:(id:number)=>{frames.delete(id);},
  };
  new Function(...Object.keys(bindings),executable)(...Object.values(bindings));
  const event=(type:string)=>{const event=new Event(type);Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);};
  const ready=()=>vi.waitFor(()=>{expect(window.mobaClient?.state().ready).toBe(true);expect(frames.size).toBe(1);});
  return {window,data,frames,ids,event,ready,panels,setFailNavigation:(value:boolean)=>{failNavigation=value;},setFailDraw:(value:boolean)=>{failDraw=value;},setFailWrite:(value:boolean)=>{failWrite=value;},setOnNavigation:(value:()=>void|Promise<void>)=>{onNavigation=value;},setChoice:(value:typeof choice)=>{choice=value;},setHero:(value:string)=>{hero=value;},restart:()=>ids.get('restart')!.dispatchEvent(new Event('click')),save:()=>panels.at(-1)!.button.dispatchEvent(new Event('click')),setHoldChoice:(value:boolean)=>{holdChoice=value;},get choices(){return choices;},counts:()=>({panelsDisposed,worldsDisposed,locksReleased})};
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


describe('local-save client asynchronous ownership lifecycle',()=>{
  it('replaces Veyra with a saved Morrow after an in-page restart, including rapid clicks',async()=>{
    const manager=createAsyncLockManager(),app=await host({acquire:createSaveOwnership(()=>manager.locks)});
    try{
      await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
      expect(JSON.parse(old).recipe.heroIdsByTeam[0]).toEqual(['veyra']);
      app.setHero('morrow');app.restart();app.restart();app.restart();
      await vi.waitFor(()=>expect(manager.releasing).toBe(1));
      expect(manager.requests).toHaveLength(1);expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);
      expect(app.ids.get('restart')!.disabled).toBe(true);expect(app.frames.size).toBe(0);
      manager.finishRelease();await app.ready();
      expect(app.panels).toHaveLength(2);expect(app.panels.at(-1)!.button.disabled).toBe(false);
      app.save();expect(app.panels.at(-1)!.status).toContain('Saved at');
      expect(JSON.parse(app.data.get(MATCH_SAVE_KEY)!).recipe.heroIdsByTeam[0]).toEqual(['morrow']);
    }finally{app.event('pagehide');await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();}
  });
  it('cancels a restarting boot during release and allows only the latest history return to save',async()=>{
    const manager=createAsyncLockManager(),app=await host({acquire:createSaveOwnership(()=>manager.locks)});
    try{
      await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
      app.restart();await vi.waitFor(()=>expect(manager.releasing).toBe(1));
      app.event('pagehide');app.event('pageshow');
      expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);expect(manager.requests).toHaveLength(1);
      manager.finishRelease();await app.ready();
      expect(manager.requests).toHaveLength(2);expect(app.panels).toHaveLength(3);
      expect(app.counts().panelsDisposed).toBe(2);expect(app.choices).toBe(1);
      expect(app.panels.at(-1)!.button.disabled).toBe(false);app.save();
      expect(app.panels.at(-1)!.status).toContain('Saved at');
    }finally{app.event('pagehide');await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();}
  });
  it('does not let a second tab or its restart modify the first tab checkpoint',async()=>{
    const manager=createAsyncLockManager(),owner=await host({acquire:createSaveOwnership(()=>manager.locks)});
    let other:Awaited<ReturnType<typeof host>>|undefined;
    try{
      await owner.ready();owner.save();const old=owner.data.get(MATCH_SAVE_KEY)!;
      other=await host({acquire:createSaveOwnership(()=>manager.locks),data:owner.data});await other.ready();
      expect(other.panels.at(-1)!.button.disabled).toBe(true);expect(other.choices).toBe(0);
      other.save();other.setHero('morrow');other.restart();await other.ready();other.save();
      expect(other.panels.at(-1)!.status).toContain('Playing without saving');
      expect(other.panels.at(-1)!.button.disabled).toBe(true);expect(owner.data.get(MATCH_SAVE_KEY)).toBe(old);
      other.event('pagehide');expect(owner.data.get(MATCH_SAVE_KEY)).toBe(old);
      expect(owner.panels.at(-1)!.button.disabled).toBe(false);owner.save();
      expect(owner.panels.at(-1)!.status).toContain('Saved at');
    }finally{other?.event('pagehide');owner.event('pagehide');await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();}
  });
});


describe('replacement startup preserves the last checkpoint',()=>{
  it('keeps exact old bytes when navigation fails after New match',async()=>{
    const app=await host();
    try{
      await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
      app.setFailNavigation(true);app.restart();
      await vi.waitFor(()=>expect(app.ids.get('notice')!.textContent).toContain('Navigation asset failed'));
      expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);
      expect(app.frames.size).toBe(0);expect(app.ids.get('restart')!.disabled).toBe(false);
    }finally{app.event('pagehide');}
  });
});


describe('replacement transaction boundaries',()=>{
  it('keeps old bytes after initial draw fails, then retries successfully',async()=>{
    const app=await host();
    try{
      await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
      app.setHero('morrow');app.setFailDraw(true);app.restart();
      await vi.waitFor(()=>expect(app.ids.get('notice')!.textContent).toContain('draw failed'));
      expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);expect(app.frames.size).toBe(0);
      app.setFailDraw(false);app.restart();await app.ready();
      expect(JSON.parse(app.data.get(MATCH_SAVE_KEY)!).recipe.heroIdsByTeam[0]).toEqual(['morrow']);
    }finally{app.event('pagehide');}
  });
  it('does not replace a changed checkpoint during startup and shows the conflict',async()=>{
    const app=await host();
    try{
      await app.ready();app.save();const newer=app.data.get(MATCH_SAVE_KEY)!+' ';
      app.setOnNavigation(()=>app.data.set(MATCH_SAVE_KEY,newer));app.setHero('morrow');app.restart();await app.ready();
      expect(app.data.get(MATCH_SAVE_KEY)).toBe(newer);
      expect(app.panels.at(-1)!.status).toContain('Not saved (conflict)');
      expect(app.panels.at(-1)!.button.disabled).toBe(true);
    }finally{app.event('pagehide');}
  });
  it('retains old bytes on failed replacement writes and allows a visible save retry',async()=>{
    const app=await host();
    try{
      await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
      app.setFailWrite(true);app.setHero('morrow');app.restart();await app.ready();
      expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);
      expect(app.panels.at(-1)!.status).toContain('Not saved (unavailable)');
      expect(app.panels.at(-1)!.button.disabled).toBe(false);
      app.setFailWrite(false);app.save();
      expect(JSON.parse(app.data.get(MATCH_SAVE_KEY)!).recipe.heroIdsByTeam[0]).toEqual(['morrow']);
    }finally{app.event('pagehide');}
  });
  it.each(['new','preserve'] as const)('handles the existing checkpoint dialog choice %s without pre-clearing',async choice=>{
    const app=await host();
    try{
      await app.ready();app.save();app.event('pagehide');const old=app.data.get(MATCH_SAVE_KEY)!;
      app.setChoice(choice);app.setHero('morrow');
      app.setOnNavigation(()=>expect(app.data.get(MATCH_SAVE_KEY)).toBe(old));
      app.event('pageshow');await app.ready();
      if(choice==='new')expect(JSON.parse(app.data.get(MATCH_SAVE_KEY)!).recipe.heroIdsByTeam[0]).toEqual(['morrow']);
      else expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);
    }finally{app.event('pagehide');}
  });
});


it('preserves the checkpoint when pagehide cancels replacement during navigation',async()=>{
  const app=await host();let finish!:()=>void;let entered=false;
  try{
    await app.ready();app.save();const old=app.data.get(MATCH_SAVE_KEY)!;
    app.setOnNavigation(()=>{entered=true;return new Promise<void>(resolve=>{finish=resolve;});});
    app.restart();await vi.waitFor(()=>expect(entered).toBe(true));
    app.event('pagehide');finish();
    await vi.waitFor(()=>expect(app.counts().panelsDisposed).toBe(2));
    expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);expect(app.frames.size).toBe(0);
    app.setOnNavigation(()=>{});app.event('pageshow');await app.ready();
    expect(app.choices).toBe(1);expect(app.data.get(MATCH_SAVE_KEY)).toBe(old);
  }finally{finish?.();app.event('pagehide');}
});
