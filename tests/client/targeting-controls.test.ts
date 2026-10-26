import {describe,it,expect,vi} from 'vitest';
import {Simulation} from '../../src/sim/simulation.js';
import {createControls} from '../../src/input/controls.js';
import type {GameWorld} from '../../src/render/world.js';
const navigation={closestPoint:(point:{x:number;z:number})=>({...point}),findPath:(start:{x:number;z:number},end:{x:number;z:number})=>({success:true,points:[start,end],reason:null})};
function fixture(){
  const sim=new Simulation({seed:1,contentVersion:8,navigation}),snapshot=sim.snapshot(),hero=snapshot.heroes[0]!;
  const win=new EventTarget();vi.stubGlobal('window',win);
  const canvas=Object.assign(new EventTarget(),{focus:vi.fn()});
  const setTargeting=vi.fn(),enqueue=vi.fn();
  const world={canvas,setTargeting,aim:()=>({point:{x:hero.position.x+2,z:hero.position.z},entityId:null}),setPointer:vi.fn(),leavePointer:vi.fn()} as unknown as GameWorld;
  const controls=createControls(world,sim.catalog,()=>({snapshot,hero}),enqueue,()=>{},()=>{});
  const key=(key:string)=>{const event=new Event('keydown');Object.assign(event,{key});win.dispatchEvent(event);};
  const click=(button:number)=>{const event=new Event('pointerdown');Object.assign(event,{button,clientX:1,clientY:1});canvas.dispatchEvent(event);};
  return {controls,setTargeting,enqueue,key,click};
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
