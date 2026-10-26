import {describe,it,expect} from 'vitest';
import {minionSpacing} from '../src/sim/minion-spacing.js';
import {makeSim} from './helpers.js';
import type {MinionEntity} from '../src/sim/types.js';

const body=(id:number,x:number,z:number,movable=true)=>({id,position:{x,z},radius:.45,movable});
describe('versioned minion contact spacing',()=>{
  it('reads one position set, is permutation invariant and pushes both sides equally',()=>{
    const input=[body(1,0,0),body(2,.4,0),body(3,.2,.2)];
    expect(minionSpacing(input,.07)).toEqual(minionSpacing([...input].reverse(),.07));
    const pair=minionSpacing(input.slice(0,2),1);expect(pair.get(1)!.x).toBeCloseTo(-.25);expect(pair.get(2)!.x).toBeCloseTo(.25);
    for(const offset of minionSpacing(input,.07).values())expect(Math.hypot(offset.x,offset.z)).toBeLessThanOrEqual(.07000001);
  });
  it('keeps disabled bodies stationary, resolves exact coincidence deterministically, and leaves separated units alone',()=>{
    const fixed=minionSpacing([body(1,0,0,false),body(2,0,0)],.07);
    expect(fixed.get(1)).toEqual({x:0,z:0});expect(fixed.get(2)).toEqual({x:0,z:.07});
    expect(minionSpacing([body(1,0,0),body(2,2,0)],.07).get(1)).toEqual({x:0,z:0});
  });
  it('mirrors noncoincident corrections without depending on team or storage order',()=>{
    const bodies=[body(1,-.2,.1),body(2,.3,.2)];const original=minionSpacing(bodies,1);
    const mirrored=minionSpacing(bodies.map(b=>({...b,position:{x:-b.position.x,z:b.position.z}})),1);
    for(const b of bodies){expect(mirrored.get(b.id)!.x).toBeCloseTo(-original.get(b.id)!.x);expect(mirrored.get(b.id)!.z).toBeCloseTo(original.get(b.id)!.z);}
  });
  it('rejects disconnected, excessive-projection and long-detour corrections without teleporting',async()=>{
    const sim=await makeSim(10);for(let i=0;i<245;i++)sim.step([]);
    const units=sim.state.entities.filter((e):e is MinionEntity=>e.kind==='minion'&&e.alive).slice(0,2);
    for(const unit of units)unit.position={x:0,z:0};
    for(const e of sim.state.entities)if(e.kind==='minion'&&!units.includes(e))e.alive=false;
    const resolve=()=> (sim as unknown as {resolveMinionContacts():void}).resolveMinionContacts();
    const navigation=sim.navigation;const oldClosest=navigation.closestPoint,oldPath=navigation.findPath;
    try{
      navigation.closestPoint=()=>({x:50,z:0});resolve();expect(units.map(e=>e.position)).toEqual([{x:0,z:0},{x:0,z:0}]);
      navigation.closestPoint=p=>({...p});navigation.findPath=()=>({success:false,points:[],reason:'closed'});resolve();expect(units[0]!.position).toEqual({x:0,z:0});
      navigation.findPath=(a,b)=>({success:true,points:[a,{x:20,z:20},b],reason:null});resolve();expect(units[0]!.position).toEqual({x:0,z:0});
      // Even a short detour is not permission to jump its straight chord.
      navigation.findPath=(a,b)=>({success:true,points:[a,{x:.012,z:b.z/2},b],reason:null});resolve();expect(units.map(e=>e.position)).toEqual([{x:0,z:0},{x:0,z:0}]);
    }finally{navigation.closestPoint=oldClosest;navigation.findPath=oldPath;}
  });
  it('keeps already committed attacks when contact displacement changes the following range sample',async()=>{
    const sim=await makeSim(10);for(let i=0;i<245;i++)sim.step([]);
    const troops=sim.state.entities.filter((e):e is MinionEntity=>e.kind==='minion'&&e.alive&&e.team===0);
    const attacker=troops[0]!,obstacle=troops[1]!,target=sim.getHero(1,0)!;
    for(const entity of sim.state.entities)if(entity.kind==='minion'&&entity!==attacker&&entity!==obstacle)entity.alive=false;
    attacker.position={x:0,z:0};attacker.path=[];attacker.pathIndex=0;attacker.targetId=target.id;attacker.targetRefreshTick=9999;attacker.attackCooldown=0;
    obstacle.position={x:.2,z:0};obstacle.path=[];obstacle.statuses=[{kind:'stun',sourceId:target.id,expiresTick:9999,percent:0}];
    target.position={x:2.1,z:0};target.path=[];target.targetId=null;target.moveGoal=null;
    const hp=target.hp;sim.step([]);
    expect(sim.snapshot().events.some(event=>event.type==='basicAttack'&&event.sourceId===attacker.id&&event.targetId===target.id)).toBe(true);
    expect(target.hp).toBeLessThan(hp);expect(attacker.position.x).toBeLessThan(0);
    expect(Math.hypot(target.position.x-attacker.position.x,target.position.z-attacker.position.z)).toBeGreaterThan(sim.catalog.minions.melee.attackRange+target.radius);
    expect(obstacle.position).toEqual({x:.2,z:0});
  });
  it('reduces real overlapping troops on the same baked lane and replays deterministically',async()=>{
    const run=async(version:8|10)=>{const sim=await makeSim(version,1);for(let i=0;i<1200;i++)sim.step([]);const units=sim.snapshot().entities.filter(e=>e.alive&&e.kind==='minion');let overlaps=0;for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i]!,b=units[j]!;if(a.team===b.team&&Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)<a.radius+b.radius-.01)overlaps++;}return{overlaps,hash:sim.finalHash()};};
    const old=await run(8),next=await run(10);expect(old.overlaps).toBeGreaterThan(0);expect(next.overlaps).toBeLessThan(old.overlaps);expect(await run(10)).toEqual(next);
  });
});
