import {describe,it,expect,vi} from 'vitest';
import {Simulation} from '../../src/sim/simulation.js';
import {commandForRightClick} from '../../src/input/commands.js';
import {createControls} from '../../src/input/controls.js';
import type {GameWorld} from '../../src/render/world.js';
const navigation={closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})};
function fixture(){const sim=new Simulation({seed:1,contentVersion:10,navigation,heroesPerTeam:1});const snapshot=sim.snapshot(),hero=snapshot.heroes[0]!,enemy=snapshot.heroes[1]!;return{sim,snapshot,hero,enemy};}
describe('contextual enemy right click',()=>{
 it('names the picked enemy rather than auto-selecting a nearer one, and ground/ally remains copied Move',()=>{
  const {snapshot,hero,enemy}=fixture(),point={x:0,z:0};expect(commandForRightClick(hero,{point,entityId:enemy.id},snapshot)).toEqual({type:'attack',heroId:hero.id,targetId:enemy.id});
  for(const entityId of [null,hero.id]){const result=commandForRightClick(hero,{point,entityId},snapshot);expect(result).toEqual({type:'move',heroId:hero.id,point});if(result?.type==='move')expect(result.point).not.toBe(point);}
 });
 it('stale, dead and protected enemies do not silently turn into movement; dead player/terminal also reject',()=>{
  const {snapshot,hero,enemy}=fixture(),aim={point:{x:0,z:0},entityId:enemy.id};
  for(const update of [{alive:false},{invulnerable:true}])expect(commandForRightClick(hero,aim,{...snapshot,entities:snapshot.entities.map(e=>e.id===enemy.id?{...e,...update}:e)})).toBeNull();
  expect(commandForRightClick(hero,{...aim,entityId:999999},snapshot)).toBeNull();expect(commandForRightClick({...hero,alive:false},aim,snapshot)).toBeNull();expect(commandForRightClick(hero,aim,{...snapshot,status:'timeout'})).toBeNull();
 });
 it('the existing real command chases then commits; ground cancels target without changing the rules',()=>{
  const {sim,hero,enemy}=fixture();const snap=sim.snapshot();const command=commandForRightClick(hero,{point:null,entityId:enemy.id},snap)!;
  expect(sim.step([command])[0]?.accepted).toBe(true);expect(sim.snapshot().heroes[0]!.targetId).toBe(enemy.id);let hit=false;
  for(let i=0;i<1800&&!sim.isComplete();i++){sim.step([]);if(sim.snapshot().events.some(e=>e.type==='basicAttack'&&e.sourceId===hero.id&&e.targetId===enemy.id)){hit=true;break;}}
  expect(hit).toBe(true);const next=sim.snapshot(),own=next.heroes[0]!;const move=commandForRightClick(own,{point:{x:own.position.x-3,z:own.position.z},entityId:null},next)!;expect(sim.step([move])[0]?.accepted).toBe(true);expect(sim.snapshot().heroes[0]!.targetId).toBeNull();
 });
 it('canvas right click cancels skill aim and queues attack; UI sibling events never reach the canvas handler',()=>{
  const {sim,snapshot,hero,enemy}=fixture(),win=new EventTarget(),canvas=Object.assign(new EventTarget(),{focus:vi.fn()}),menu=new EventTarget(),enqueue=vi.fn(),setTargeting=vi.fn();vi.stubGlobal('window',win);vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false}));
  const world={canvas,setTargeting,aim:()=>({point:{x:0,z:0},entityId:enemy.id}),setPointer:vi.fn(),leavePointer:vi.fn()} as unknown as GameWorld;
  const controls=createControls(world,sim.catalog,()=>({snapshot,hero}),enqueue,()=>{},()=>{});
  try{controls.skill('E');const event=()=>Object.assign(new Event('pointerdown'),{button:2,clientX:1,clientY:1});menu.dispatchEvent(event());expect(enqueue).not.toHaveBeenCalled();canvas.dispatchEvent(event());expect(setTargeting).toHaveBeenLastCalledWith(null);expect(enqueue).toHaveBeenLastCalledWith({type:'attack',heroId:hero.id,targetId:enemy.id});const observed=controls.inspectPointer()!;expect(observed.aim.entityId).toBe(enemy.id);observed.aim.entityId=999;expect(controls.inspectPointer()!.aim.entityId).toBe(enemy.id);controls.dispose();expect(controls.inspectPointer()).toBeNull();canvas.dispatchEvent(event());expect(enqueue).toHaveBeenCalledTimes(1);}finally{controls.dispose();vi.unstubAllGlobals();}
 });
});
