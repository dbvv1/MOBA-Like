import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/sim/simulation.js';
import type {HeroEntity} from '../src/sim/types.js';
import {hero,makeSim,place,stepMany,testNavigation} from './helpers.js';
function phase(sim:Simulation,reverse=false){const original=sim.state.entities;if(reverse)sim.state.entities=[...original].reverse();sim.state.tick++;(sim as unknown as {updateUnits():void}).updateUnits();sim.state.entities=original;}
function move(unit:HeroEntity,x:number){unit.targetId=null;unit.moveGoal={x,z:0};unit.path=[{...unit.position},{x,z:0}];unit.pathIndex=0;}
async function duel(version:1|2|7|8|9=9){const sim=await makeSim(version),blue=hero(sim,0),red=hero(sim,1);place(blue,{x:0,z:0});place(red,{x:1,z:0});blue.targetId=red.id;red.targetId=blue.id;blue.hp=red.hp=1;blue.attackCooldown=red.attackCooldown=0;return {sim,blue,red};}
describe('staged unit phase semantics',()=>{
  it('mutually lethal committed hits both land; every death precedes XP/level rewards',async()=>{
    const hashes=[];
    for(const reverse of [false,true]){const {sim,blue,red}=await duel();blue.xp=red.xp=sim.catalog.rules.xpLevels[1]!-1;const gold=[blue.gold,red.gold];phase(sim,reverse);
      for(const [index,h]of[blue,red].entries()){expect(h.alive).toBe(false);expect(h.hp).toBe(0);expect(h.level).toBe(2);expect(h.kills).toBe(1);expect(h.gold).toBe(gold[index]!+300);expect(h.respawnAtTick).toBe(1+Math.ceil(sim.catalog.rules.heroRespawnBaseSeconds*sim.tickRateHz));}
      expect(sim.state.stats.heroKills).toEqual([1,1]);hashes.push(sim.finalHash());
    }expect(hashes[0]).toBe(hashes[1]);
  });
  it('legacy v8 retains original sequential mutually lethal behavior',async()=>{const {sim,blue,red}=await duel(8);phase(sim);expect(blue.alive).toBe(true);expect(red.alive).toBe(false);});
  for(const beginsInside of [false,true])it(`range reads the common entry state (beginsInside=${beginsInside})`,async()=>{
    const hashes=[];
    for(const reverse of [false,true]){const sim=await makeSim(9),blue=hero(sim,0),red=hero(sim,1);place(blue,{x:0,z:0});const range=blue.stats.attackRange+red.radius;place(red,{x:range+(beginsInside?-.05:.05),z:0});blue.targetId=red.id;move(red,beginsInside?20:0);const hp=red.hp;phase(sim,reverse);
      const distance=Math.abs(red.position.x-blue.position.x);if(beginsInside){expect(distance).toBeGreaterThan(range);expect(red.hp).toBeLessThan(hp);expect(blue.attackCooldown).toBeGreaterThan(0);}else{expect(distance).toBeLessThan(range);expect(red.hp).toBe(hp);expect(blue.attackCooldown).toBe(0);}
      hashes.push(sim.finalHash());
    }expect(hashes[0]).toBe(hashes[1]);
  });
  it('stable same-team effective-hit order handles shields, crossing-zero credit and committed overkill swings',async()=>{
    const hashes=[];for(const reverse of[false,true]){const sim=new Simulation({seed:1,contentVersion:9,navigation:await testNavigation(),heroesPerTeam:3});const victim=hero(sim,1);place(victim,{x:1,z:0});victim.armor=0;victim.hp=15;victim.shield=15;victim.shieldExpiresTick=100;
      const attackers=[0,1,2].map(slot=>hero(sim,0,slot));for(const h of attackers){place(h,{x:0,z:0});h.stats.attackDamage=20;h.targetId=victim.id;}
      phase(sim,reverse);expect(victim.alive).toBe(false);expect(victim.shield).toBe(0);expect(attackers.map(h=>h.kills)).toEqual([0,1,0]);expect(sim.state.stats.damageByTeam[0]).toBe(40);expect(attackers.every(h=>h.attackCooldown>0)).toBe(true);hashes.push(sim.finalHash());
    }expect(hashes[0]).toBe(hashes[1]);
  });
  it('dead, stunned, or casting at phase entry has no committed attack',async()=>{
    for(const unavailable of ['dead','stun','cast'] as const){const {sim,blue,red}=await duel();if(unavailable==='dead')blue.alive=false;else if(unavailable==='stun')blue.statuses.push({kind:'stun',percent:0,expiresTick:100,sourceId:red.id});else blue.cast={id:1,slot:'Q',abilityId:'veyra.q',remainingTicks:10,targetId:null,direction:{x:1,z:0},point:null};phase(sim);expect(red.alive).toBe(true);expect(blue.kills).toBe(0);}
  });
  it('nearby XP uses common committed positions',async()=>{
    const sim=new Simulation({seed:1,contentVersion:9,navigation:await testNavigation(),heroesPerTeam:2});stepMany(sim,241);const minion=sim.state.entities.find(e=>e.kind==='minion'&&e.team===1)!;expect(minion.kind).toBe('minion');
    sim.state.entities=sim.state.entities.filter(e=>e.kind!=='minion'||e.id===minion.id);place(minion,{x:0,z:0});minion.hp=1;const attacker=hero(sim,0),observer=hero(sim,0,1);place(attacker,{x:-1,z:0});attacker.targetId=minion.id;place(observer,{x:sim.catalog.rules.heroXpAuraRange+.05,z:0});move(observer,0);const before=observer.xp;phase(sim);expect(observer.xp).toBeGreaterThan(before);
  });
  it('a nearby observer killed in the same unit phase gets no minion aura XP',async()=>{
    for(const reverse of [false,true]){
      const sim=new Simulation({seed:1,contentVersion:9,navigation:await testNavigation(),heroesPerTeam:2});stepMany(sim,241);
      const minion=sim.state.entities.find(e=>e.kind==='minion'&&e.team===1)!;
      sim.state.entities=sim.state.entities.filter(e=>e.kind!=='minion'||e.id===minion.id);place(minion,{x:0,z:0});minion.hp=1;
      const attacker=hero(sim,0),observer=hero(sim,0,1),killer=hero(sim,1);place(attacker,{x:-1,z:0});attacker.targetId=minion.id;
      place(observer,{x:3,z:0});observer.hp=1;observer.targetId=null;observer.moveGoal=null;observer.path=[];place(killer,{x:4,z:0});killer.targetId=observer.id;
      const before=observer.xp;phase(sim,reverse);expect(minion.alive).toBe(false);expect(observer.alive).toBe(false);expect(observer.xp).toBe(before);
    }
  });
  it('canonical read tie-breaks are independent of outer storage order for identical target distances',async()=>{
    const hashes=[];for(const reverse of[false,true]){const sim=new Simulation({seed:1,contentVersion:9,navigation:await testNavigation(),heroesPerTeam:2});stepMany(sim,241);const minion=sim.state.entities.find(e=>e.kind==='minion'&&e.team===0)!;sim.state.entities=sim.state.entities.filter(e=>e.kind!=='minion'||e.id===minion.id);place(minion,{x:0,z:0});place(hero(sim,1),{x:2,z:0});place(hero(sim,1,1),{x:-2,z:0});minion.targetId=null;if(minion.kind==='minion')minion.targetRefreshTick=0;phase(sim,reverse);expect(minion.targetId).toBe(hero(sim,1).id);hashes.push(sim.finalHash());}expect(hashes[0]).toBe(hashes[1]);
  });
});
