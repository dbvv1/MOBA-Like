import {describe,it,expect,vi,afterEach} from 'vitest';
import {KeyboardBindings} from '../../src/input/bindings.js';
import {createControls} from '../../src/input/controls.js';
import {Simulation} from '../../src/sim/simulation.js';
import type {SimCommand} from '../../src/sim/types.js';
import type {GameWorld} from '../../src/render/world.js';

// Real input adapter, catalog, command construction and simulation. Only DOM/rendering and storage are controlled.
const navigation={closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})};
function fixture(){
  const sim=new Simulation({seed:1,contentVersion:10,navigation,heroesPerTeam:1});
  const win=new EventTarget();vi.stubGlobal('window',win);
  const canvas=Object.assign(new EventTarget(),{focus:vi.fn()}),commands:SimCommand[]=[],say=vi.fn(),focus=vi.fn(),setTargeting=vi.fn();
  let aimEnemy=false;
  const world={canvas,setTargeting,setPointer:vi.fn(),leavePointer:vi.fn(),aim:()=>{
    const snapshot=sim.snapshot(),hero=snapshot.heroes[0]!;
    return {point:{x:hero.position.x+2,z:hero.position.z},entityId:aimEnemy?snapshot.heroes[1]!.id:null};
  }} as unknown as GameWorld;
  const values=new Map<string,string>(),store={getItem:(name:string)=>values.get(name)??null,setItem:(name:string,value:string)=>{values.set(name,value);},removeItem:(name:string)=>{values.delete(name);}};
  const bindings=new KeyboardBindings(()=>store);
  const controls=createControls(world,sim.catalog,()=>{const snapshot=sim.snapshot();return {snapshot,hero:snapshot.heroes[0]!};},command=>commands.push(command),say,focus,bindings);
  const key=(key:string,extra:Record<string,unknown>={})=>{
    const event=Object.assign(new Event('keydown',{cancelable:true}),{key,code:'',repeat:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,...extra});
    win.dispatchEvent(event);return event;
  };
  const click=(button=0)=>canvas.dispatchEvent(Object.assign(new Event('pointerdown',{cancelable:true}),{button,clientX:1,clientY:1}));
  return {sim,win,world,commands,say,focus,setTargeting,bindings,controls,key,click,store,enemy(){aimEnemy=true;}};
}
afterEach(()=>vi.unstubAllGlobals());

describe('remapped keys feed the original MOBA consumer, not another gameplay implementation',()=>{
  it('a remapped skill enters the same cast path, label and simulation acceptance',()=>{
    const f=fixture();try{
      f.bindings.edit('Q','F');f.bindings.apply();
      f.key('q');f.click();expect(f.commands).toEqual([]);
      const event=f.key('f',{code:'KeyZ'});expect(event.defaultPrevented).toBe(true);expect(f.setTargeting).toHaveBeenLastCalledWith('Q');expect(f.say).toHaveBeenLastCalledWith(expect.stringMatching(/^F /));
      f.click();expect(f.commands).toHaveLength(1);expect(f.commands[0]).toMatchObject({type:'cast',slot:'Q'});
      const before=f.sim.snapshot().heroes[0]!.mana;
      expect(f.sim.step(f.commands)[0]?.accepted).toBe(true);expect(f.sim.snapshot().heroes[0]!.mana).toBeLessThan(before);
      expect(f.setTargeting).toHaveBeenLastCalledWith(null);
    }finally{f.controls.dispose();}
  });
  it('draft, conflict and cancel never redirect live input; successful apply does',()=>{
    const f=fixture();try{
      f.bindings.edit('E','F');f.key('f');expect(f.setTargeting).not.toHaveBeenCalled();
      f.key('e');expect(f.setTargeting).toHaveBeenLastCalledWith('E');f.key('Escape');
      expect(f.bindings.edit('E','Q')).toEqual({ok:false,reason:'conflict',action:'Q'});f.bindings.cancel();
      f.key('f');expect(f.setTargeting).toHaveBeenLastCalledWith(null);
      f.bindings.edit('E','F');f.bindings.apply();f.key('f');expect(f.setTargeting).toHaveBeenLastCalledWith('E');
      f.click();expect(f.sim.step(f.commands)[0]?.accepted).toBe(true);
    }finally{f.controls.dispose();}
  });
  it('remapped attack-move/stop are accepted by the same simulation and camera remains outside it',()=>{
    const f=fixture();try{
      f.bindings.edit('attackMove','D');f.bindings.edit('stop','X');f.bindings.edit('focusCamera','C');f.bindings.apply();
      f.key('d');f.click();expect(f.commands[0]?.type).toBe('attackMove');expect(f.sim.step(f.commands.splice(0))[0]?.accepted).toBe(true);
      f.key('x');expect(f.commands[0]?.type).toBe('stop');expect(f.sim.step(f.commands.splice(0))[0]?.accepted).toBe(true);
      f.key(' ');expect(f.focus).not.toHaveBeenCalled();f.key('c');expect(f.focus).toHaveBeenCalledTimes(1);expect(f.commands).toHaveLength(0);
    }finally{f.controls.dispose();}
  });
  it('entering settings releases old aim and blocks keyboard, HUD skill and pointer commands',()=>{
    const f=fixture();try{
      f.key('e');expect(f.setTargeting).toHaveBeenLastCalledWith('E');f.controls.setEnabled(false);
      expect(f.setTargeting).toHaveBeenLastCalledWith(null);expect(f.controls.inspectPointer()).toBeNull();
      f.bindings.beginCapture('Q');expect(f.bindings.capture({key:'f'} as KeyboardEvent)).toEqual({ok:true});
      f.key('q');f.key('s');f.key(' ');f.controls.skill('W');f.click(2);expect(f.commands).toHaveLength(0);expect(f.focus).not.toHaveBeenCalled();
      f.bindings.apply();f.controls.setEnabled(true);f.click();expect(f.commands).toHaveLength(0);
      f.key('f');f.click();expect(f.commands[0]).toMatchObject({type:'cast',slot:'Q'});
    }finally{f.controls.dispose();}
  });
  it('blur releases aiming; typing, consumed UI events, repeats, chords and IME do not cast',()=>{
    const f=fixture();try{
      f.key('e');f.bindings.edit('W','G');f.bindings.beginCapture('Q');f.win.dispatchEvent(new Event('blur'));f.click();expect(f.commands).toHaveLength(0);
      expect(f.bindings.captureAction).toBeNull();expect(f.bindings.draft.W).toBe('G');
      for(const extra of [{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}])f.key('q',extra);
      const consumed=Object.assign(new Event('keydown',{cancelable:true}),{key:'q'});consumed.preventDefault();f.win.dispatchEvent(consumed);
      const typed=Object.assign(new Event('keydown'),{key:'q'});Object.defineProperty(typed,'target',{value:{tagName:'INPUT'}});f.win.dispatchEvent(typed);
      f.click();expect(f.commands).toHaveLength(0);
      f.key('q');f.click();expect(f.commands).toHaveLength(1);
    }finally{f.controls.dispose();}
  });
  it('preserves 9311 contextual enemy attack and rejects commands after disposal',()=>{
    const f=fixture();try{
      f.bindings.edit('Q','F');f.bindings.apply();f.key('f');f.enemy();f.click(2);
      expect(f.commands[0]).toMatchObject({type:'attack',targetId:f.sim.snapshot().heroes[1]!.id});
      expect(f.sim.step(f.commands.splice(0))[0]?.accepted).toBe(true);expect(f.setTargeting).toHaveBeenLastCalledWith(null);
      f.controls.dispose();f.controls.setEnabled(true);f.controls.skill('Q');f.key('f');f.click(2);expect(f.commands).toHaveLength(0);
    }finally{f.controls.dispose();}
  });
  it('a new input owner uses persisted bindings; defaults restore the original keys',()=>{
    const f=fixture();try{
      f.bindings.edit('Q','F');f.bindings.apply();f.controls.dispose();
      const fresh=new KeyboardBindings(()=>f.store);const commands:SimCommand[]=[];
      const controls=createControls(f.world,f.sim.catalog,()=>{const snapshot=f.sim.snapshot();return {snapshot,hero:snapshot.heroes[0]!};},c=>commands.push(c),()=>{},()=>{},fresh);
      try{f.key('q');f.click();expect(commands).toHaveLength(0);f.key('f');f.click();expect(commands[0]).toMatchObject({type:'cast',slot:'Q'});
        fresh.defaults();expect(fresh.apply()).toBe(true);commands.length=0;f.key('f');f.click();expect(commands).toHaveLength(0);f.key('q');f.click();expect(commands).toHaveLength(1);
      }finally{controls.dispose();}
    }finally{f.controls.dispose();}
  });
  it('binding choice does not enter replay commands or change the same seeded simulation result',()=>{
    const f=fixture();try{
      f.bindings.edit('E','F');f.bindings.apply();f.key('f');f.click();
      const replay=new Simulation({seed:1,contentVersion:10,navigation,heroesPerTeam:1});
      expect(f.commands[0]).toMatchObject({type:'cast',slot:'E'});expect(JSON.stringify(f.commands)).not.toContain('bindings');
      for(let i=0;i<30;i++){f.sim.step(i===0?f.commands:[]);replay.step(i===0?structuredClone(f.commands):[]);}
      expect(f.sim.snapshot()).toEqual(replay.snapshot());
    }finally{f.controls.dispose();}
  });
});
