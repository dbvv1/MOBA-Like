import {describe,it,expect} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {Simulation} from '../../src/sim/simulation.js';
import {commandForCast,moveCommand,validPoint,isInputElement} from '../../src/input/commands.js';
const navigation={closestPoint:(point:{x:number;z:number})=>({...point}),findPath:(start:{x:number;z:number},end:{x:number;z:number})=>({success:true,points:[start,end],reason:null})};
function fixture(version:1|2){const sim=new Simulation({seed:1,contentVersion:version,navigation});const snapshot=sim.snapshot();return {catalog:getContent(version),snapshot,hero:snapshot.heroes[0]!};}
describe('client commands from catalog and snapshots',()=>{
  it('v1 Q targets an alive enemy and rejects self/no target',()=>{const {hero,snapshot,catalog}=fixture(1);const enemy=snapshot.entities.find(e=>e.team!==hero.team)!;expect(commandForCast(hero,'Q',{point:null,entityId:enemy.id},snapshot,catalog)).toMatchObject({type:'cast',targetId:enemy.id});expect(commandForCast(hero,'Q',{point:null,entityId:hero.id},snapshot,catalog)).toBeNull();});
  it('v2 Q is direction based, W follows data, and zero direction rejects',()=>{const {hero,snapshot,catalog}=fixture(2);const aim={point:{x:hero.position.x+3,z:hero.position.z+4},entityId:null};expect(commandForCast(hero,'Q',aim,snapshot,catalog)).toMatchObject({direction:{x:.6,z:.8},targetId:null});expect(commandForCast(hero,'W',aim,snapshot,catalog)).toMatchObject({direction:{x:.6,z:.8}});expect(commandForCast(hero,'Q',{point:hero.position,entityId:null},snapshot,catalog)).toBeNull();});
  it('point casts copy world position and dead heroes reject',()=>{const {hero,snapshot,catalog}=fixture(2);const point={x:1,z:2};const command=commandForCast(hero,'E',{point,entityId:null},snapshot,catalog);expect(command).toMatchObject({point});if(command?.type==='cast')expect(command.point).not.toBe(point);expect(commandForCast({...hero,alive:false},'E',{point,entityId:null},snapshot,catalog)).toBeNull();});
  it('movement rejects nonfinite points without mutating caller coordinates',()=>{const point={x:2,z:3};expect(moveCommand(7,point)).toEqual({type:'move',heroId:7,point});expect(moveCommand(7,{x:NaN,z:0})).toBeNull();expect(validPoint(null)).toBe(false);});
  it('editing a form does not become gameplay hotkeys',()=>{expect(isInputElement({tagName:'INPUT'}as unknown as EventTarget)).toBe(true);expect(isInputElement({tagName:'CANVAS'}as unknown as EventTarget)).toBe(false);});
});
