import {describe,it,expect,vi} from 'vitest';
import {Simulation} from '../../src/sim/simulation.js';
import {createControls} from '../../src/input/controls.js';
import type {GameWorld} from '../../src/render/world.js';
const navigation={closestPoint:(point:{x:number;z:number})=>({...point}),findPath:(start:{x:number;z:number},end:{x:number;z:number})=>({success:true,points:[start,end],reason:null})};
function fixture(){
  const sim=new Simulation({seed:1,contentVersion:8,navigation}),snapshot=sim.snapshot(),hero=snapshot.heroes[0]!;
  const win=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false});vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  const canvas=Object.assign(new EventTarget(),{focus:vi.fn()});
  const setTargeting=vi.fn(),enqueue=vi.fn(),focusCamera=vi.fn(),say=vi.fn();
  const world={canvas,setTargeting,aim:()=>({point:{x:hero.position.x+2,z:hero.position.z},entityId:null}),setPointer:vi.fn(),leavePointer:vi.fn()} as unknown as GameWorld;
  const controls=createControls(world,sim.catalog,()=>({snapshot,hero}),enqueue,say,focusCamera);
  const key=(key:string,target?:object)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,code:key===' '?'Space':`Key${key.toUpperCase()}`});if(target)Object.defineProperty(event,'target',{value:target});win.dispatchEvent(event);return event;};
  const click=(button:number)=>{const event=new Event('pointerdown');Object.assign(event,{button,clientX:1,clientY:1});canvas.dispatchEvent(event);};
  return {controls,setTargeting,enqueue,key,click,win,doc,focusCamera,say};
}
describe('existing input owns the targeting preview lifecycle',()=>{
  it('switches selected skill and clears on Esc, stop, attack-move, right click and disposal',()=>{
    const f=fixture();try{
      f.controls.skill('Q');expect(f.setTargeting).toHaveBeenLastCalledWith('Q');
      f.controls.skill('E');expect(f.setTargeting).toHaveBeenLastCalledWith('E');
      for(const key of ['Escape','S','A']){f.controls.skill('E');f.key(key);expect(f.setTargeting).toHaveBeenLastCalledWith(null);}
      f.controls.skill('Q');f.click(2);expect(f.setTargeting).toHaveBeenLastCalledWith(null);expect(f.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({type:'move'}));
      f.controls.skill('R');f.controls.dispose();expect(f.setTargeting).toHaveBeenLastCalledWith(null);
      f.key('E');expect(f.setTargeting).toHaveBeenLastCalledWith(null);
    }finally{f.controls.dispose();vi.unstubAllGlobals();}
  });
  it('left-click still queues the real cast then clears preview, with no direct sim mutation',()=>{
    const f=fixture();try{f.controls.skill('E');f.click(0);expect(f.enqueue).toHaveBeenCalledTimes(1);expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({type:'cast',slot:'E'}));expect(f.setTargeting).toHaveBeenLastCalledWith(null);}finally{f.controls.dispose();vi.unstubAllGlobals();}
  });
});

describe('UI and background focus handoff uses the real controls consumer',()=>{
  it('native shop buttons and summary own Space and QWER without gameplay consumption',()=>{
    const f=fixture();try{
      for(const tagName of ['BUTTON','SUMMARY']){
        const target={tagName};
        for(const key of [' ','Q','W','E','R'])expect(f.key(key,target).defaultPrevented).toBe(false);
      }
      expect(f.focusCamera).not.toHaveBeenCalled();expect(f.setTargeting).not.toHaveBeenCalled();expect(f.enqueue).not.toHaveBeenCalled();
      f.key('E');f.click(0);expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({type:'cast',slot:'E'}));
    }finally{f.controls.dispose();vi.unstubAllGlobals();}
  });
  it('moving focus into native shop UI cancels old aim but UI skill actions can arm a fresh cast',()=>{
    const f=fixture();try{
      f.controls.skill('E');const event=new Event('focusin');Object.defineProperty(event,'target',{value:{tagName:'BUTTON'}});f.win.dispatchEvent(event);
      f.click(0);expect(f.enqueue).not.toHaveBeenCalled();expect(f.setTargeting).toHaveBeenLastCalledWith(null);
      f.controls.skill('E');f.click(0);expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({type:'cast',slot:'E'}));
    }finally{f.controls.dispose();vi.unstubAllGlobals();}
  });
  it('losing window focus cancels armed casts rather than firing on a later return click',()=>{
    const f=fixture();try{
      f.controls.skill('E');f.win.dispatchEvent(new Event('blur'));
      expect(f.setTargeting).toHaveBeenLastCalledWith(null);f.click(0);expect(f.enqueue).not.toHaveBeenCalled();
      f.key('A');f.win.dispatchEvent(new Event('blur'));f.click(0);expect(f.enqueue).not.toHaveBeenCalled();
      f.controls.skill('E');f.click(0);expect(f.enqueue).toHaveBeenCalledTimes(1);
    }finally{f.controls.dispose();vi.unstubAllGlobals();}
  });
});

it('hidden document cancels targeting even without a window blur, and updates the stale instruction',()=>{
 const f=fixture();try{
  f.controls.skill('E');f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
  expect(f.setTargeting).toHaveBeenLastCalledWith(null);expect(f.say).toHaveBeenLastCalledWith('Aim cancelled.');
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));f.click(0);expect(f.enqueue).not.toHaveBeenCalled();
  f.controls.skill('E');f.click(0);expect(f.enqueue).toHaveBeenCalledTimes(1);
 }finally{f.controls.dispose();vi.unstubAllGlobals();}
});
