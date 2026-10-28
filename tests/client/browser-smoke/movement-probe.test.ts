// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {installMovementProbe,assertActiveMoveAtStop,assertStoppedAtKeyPosition} from './movement-probe.mjs';

const hero=(x:number,goal:number|null)=>({id:9,alive:true,position:{x,z:0},moveGoal:goal===null?null:{x:goal,z:0}});
const valid=()=>({beforeMove:{tick:100,status:'running',hero:hero(0,null)},click:{input:{trusted:true},pointer:{command:{type:'move'}}},beforeStop:{tick:105,status:'running',input:{trusted:true,key:'s'},hero:hero(1,10)}});
afterEach(()=>vi.unstubAllGlobals());
describe('real-key movement and stop evidence, not a timing allowance',()=>{
 it('accepts an active travelled move stopped at the actual key position',()=>{
  const p=valid();assertActiveMoveAtStop(p);assertStoppedAtKeyPosition(p,hero(1,null),hero(1,null));
 });
 it.each(['arrived','premature-clear'])('rejects %s movement at the actual key even if a preceding sample was active',()=>{
  const p=valid();p.beforeStop.hero.moveGoal=null;
  expect(()=>assertActiveMoveAtStop(p)).toThrow('Move must still be active before stop');
 });
 it('rejects no movement, an enemy attack click, and untrusted/synthetic input',()=>{
  const still=valid();still.beforeStop.hero.position.x=0;expect(()=>assertActiveMoveAtStop(still)).toThrow('Movement must occur');
  const attack=valid();attack.click.pointer.command.type='attack';expect(()=>assertActiveMoveAtStop(attack)).toThrow('Right click must issue movement');
  const synthetic=valid();synthetic.beforeStop.input.trusted=false;expect(()=>assertActiveMoveAtStop(synthetic)).toThrow('real page keyboard');
 });
 it('cannot pass an ignored S merely because the hero naturally reaches its destination and stays there',()=>{
  const p=valid();assertActiveMoveAtStop(p);
  expect(()=>assertStoppedAtKeyPosition(p,hero(10,null),hero(10,null))).toThrow('not pass by natural arrival');
 });
 it('rejects continued movement or a product clearing the goal while the hero still drifts',()=>{
  expect(()=>assertStoppedAtKeyPosition(valid(),hero(2,10),hero(3,10))).toThrow();
  expect(()=>assertStoppedAtKeyPosition(valid(),hero(1,null),hero(2,null))).toThrow('actual keydown position');
 });
 it('observes pointer after the actual DOM canvas handler but keyboard before its consumer',()=>{
  document.body.innerHTML='<main id="stage"><canvas></canvas></main>';const canvas=document.querySelector('canvas')!;
  let snapshot={tick:1,status:'running',heroes:[hero(0,null)]};let pointer:unknown=null;
  Object.assign(window,{mobaClient:{snapshot:()=>snapshot,state:()=>({pointer})}});
  const consumePointer=()=>{pointer={command:{type:'move'}};};
  const consumeStop=()=>{snapshot={tick:3,status:'running',heroes:[hero(2,null)]};};
  canvas.addEventListener('pointerdown',consumePointer);window.addEventListener('keydown',consumeStop);
  installMovementProbe(9);
  try{
   canvas.dispatchEvent(new MouseEvent('pointerdown',{button:2,bubbles:true,clientX:20,clientY:30}));
   snapshot={tick:2,status:'running',heroes:[hero(1,10)]};
   canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}));
   const p=(window as unknown as {__mobaMovementProbe:ReturnType<typeof valid>}).__mobaMovementProbe;
   expect(p.click.pointer.command.type).toBe('move');expect(p.beforeStop.hero.position.x).toBe(1);expect(snapshot.heroes[0]!.position.x).toBe(2);
  }finally{(window as unknown as {__mobaMovementProbeCleanup:()=>void}).__mobaMovementProbeCleanup();window.removeEventListener('keydown',consumeStop);document.body.replaceChildren();}
 });
 it('latches the actual key event snapshot without freezing simulation or replacing input handlers',async()=>{
  let snapshot={tick:100,status:'running',heroes:[hero(0,null)]};let pointer:unknown=null;
  const canvas={};const win=Object.assign(new EventTarget(),{mobaClient:{snapshot:()=>snapshot,state:()=>({pointer})}});
  vi.stubGlobal('window',win);vi.stubGlobal('document',{querySelector:()=>canvas});
  installMovementProbe(9);
  const down=new Event('pointerdown');Object.defineProperties(down,{button:{value:2},target:{value:canvas},clientX:{value:10},clientY:{value:20}});pointer={command:{type:'move'}};win.dispatchEvent(down);await Promise.resolve();
  snapshot={tick:105,status:'running',heroes:[hero(1,10)]};
  const key=new Event('keydown');Object.defineProperty(key,'key',{value:'s'});win.dispatchEvent(key);
  snapshot={tick:110,status:'running',heroes:[hero(10,null)]};
  const p=(win as unknown as {__mobaMovementProbe:ReturnType<typeof valid>}).__mobaMovementProbe;
  expect(p.beforeStop.tick).toBe(105);expect(p.beforeStop.hero.position.x).toBe(1);expect(p.beforeStop.hero.moveGoal).toEqual({x:10,z:0});
  expect(snapshot.heroes[0]!.position.x).toBe(10);expect(p.click.pointer.command.type).toBe('move');
  (win as unknown as {__mobaMovementProbeCleanup:()=>void}).__mobaMovementProbeCleanup();
 });
});
