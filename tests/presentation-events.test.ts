import {describe,it,expect} from 'vitest';
import {hero,makeSim,place} from './helpers.js';
import type {PresentationEvent,SimCommand} from '../src/sim/types.js';

async function arena(version:1|8|9=8){const sim=await makeSim(version);const blue=hero(sim,0),red=hero(sim,1);place(blue,{x:0,z:0});place(red,{x:4,z:0});return {sim,blue,red};}

describe('authoritative per-tick presentation events',()=>{
  it('reports instantaneous start and delivery separately; rejected input emits nothing',async()=>{
    const {sim,blue}=await arena();expect(sim.snapshot().events).toEqual([]);
    const command:SimCommand={type:'cast',heroId:blue.id,slot:'W',direction:{x:0,z:1}};
    expect(sim.step([command])[0].accepted).toBe(true);
    expect(sim.snapshot().events.map(e=>e.type)).toEqual(['castStarted','castResolved']);
    const [start,end]=sim.snapshot().events;expect(start).toMatchObject({tick:1,ordinal:0,castId:1,heroId:blue.id,abilityId:'veyra.w',slot:'W'});
    expect(end).toMatchObject({tick:1,ordinal:1,castId:1});
    expect(sim.step([command])[0].accepted).toBe(false);expect(sim.snapshot().events).toEqual([]);
  });
  it('isolates copies, retains terminal batch, and lets per-step consumers collect several ticks once',async()=>{
    const {sim,blue}=await arena();const batches:PresentationEvent[]=[];
    sim.step([{type:'cast',heroId:blue.id,slot:'Q',direction:{x:0,z:1}}]);
    const first=sim.snapshot(),hash=sim.finalHash();
    (first.events[0] as {heroId:number}).heroId=-99;
    expect(sim.finalHash()).toBe(hash);expect(sim.snapshot().events[0]).toMatchObject({heroId:blue.id});
    batches.push(...sim.snapshot().events);
    for(let i=0;i<8;i++){sim.step([]);batches.push(...sim.snapshot().events);}
    expect(batches.map(e=>e.type)).toEqual(['castStarted','castResolved']);
    expect(new Set(batches.map(e=>`${e.tick}:${e.ordinal}`)).size).toBe(2);
    expect(first.events).toHaveLength(1);expect(sim.snapshot().events).toEqual([]);
    sim.state.status='timeout';const terminal=sim.snapshot().events;sim.step([]);expect(sim.snapshot().events).toEqual(terminal);
  });
  it('keeps the nonempty final tick on post-match calls, and restart begins with no events',async()=>{
    const sim=await makeSim(8,1,{maxMatchSeconds:0.01}),blue=hero(sim,0);
    sim.step([{type:'cast',heroId:blue.id,slot:'W',direction:{x:0,z:1}}]);
    expect(sim.isComplete()).toBe(true);const batch=sim.snapshot().events;expect(batch).toHaveLength(2);
    sim.step([]);expect(sim.snapshot().events).toEqual(batch);expect((await makeSim(8)).snapshot().events).toEqual([]);
  });
  it('v9 reports later committed overkill swings without corpse damage',async()=>{
    const sim=new (await import('../src/sim/simulation.js')).Simulation({seed:1,contentVersion:9,navigation:await (await import('./helpers.js')).testNavigation(),heroesPerTeam:2});
    const first=hero(sim,0,0),second=hero(sim,0,1),victim=hero(sim,1,0);
    place(first,{x:0,z:0});place(second,{x:0,z:1});place(victim,{x:1,z:0});victim.hp=1;
    sim.step([{type:'attack',heroId:first.id,targetId:victim.id},{type:'attack',heroId:second.id,targetId:victim.id}]);
    expect(sim.snapshot().events.map(e=>e.type)).toEqual(['basicAttack','heroDamaged','basicAttack']);
    expect(first.attackCooldown).toBeGreaterThan(0);expect(second.attackCooldown).toBeGreaterThan(0);
  });
  it('reports genuine targeted invalidation as cancellation, never resolve or damage',async()=>{
    const {sim,blue,red}=await arena(1);const events:PresentationEvent[]=[];
    sim.step([{type:'cast',heroId:blue.id,slot:'Q',targetId:red.id}]);events.push(...sim.snapshot().events);
    place(red,{x:40,z:0});for(let i=0;i<8;i++){sim.step([]);events.push(...sim.snapshot().events);}
    expect(events.map(e=>e.type)).toEqual(['castStarted','castCancelled']);
    expect(events[1]).toMatchObject({reason:'invalidTarget',castId:1});
  });
  it('reports stun cancellation once at the existing interruption point',async()=>{
    const {sim,blue}=await arena();sim.step([{type:'cast',heroId:blue.id,slot:'R',point:{x:0,z:0}}]);
    blue.statuses.push({kind:'stun',percent:0,expiresTick:100,sourceId:hero(sim,1).id});
    sim.step([]);expect(sim.snapshot().events).toEqual([expect.objectContaining({type:'castCancelled',reason:'stunned',castId:1})]);
    sim.step([]);expect(sim.snapshot().events).toEqual([]);
  });
  for(const version of [8,9] as const){
    it(`v${version} reports projectile delivery then actual impact on a later tick`,async()=>{
      const {sim,blue,red}=await arena(version);place(red,{x:9,z:0});const events:PresentationEvent[]=[];
      sim.step([{type:'cast',heroId:blue.id,slot:'Q',direction:{x:1,z:0}}]);events.push(...sim.snapshot().events);
      for(let i=0;i<20;i++){sim.step([]);events.push(...sim.snapshot().events);}
      const resolved=events.find(e=>e.type==='castResolved')!,damage=events.find(e=>e.type==='heroDamaged')!;
      expect(damage).toMatchObject({sourceId:blue.id,targetId:red.id,abilityId:'veyra.q',shieldAbsorbed:0});
      expect(damage.tick).toBeGreaterThan(resolved.tick);
    });
    it(`v${version} emits a committed basic swing even when fully shielded`,async()=>{
      const {sim,blue,red}=await arena(version);place(red,{x:1,z:0});red.shield=1000;red.shieldExpiresTick=100;
      sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);
      expect(sim.snapshot().events).toEqual([
        expect.objectContaining({type:'basicAttack',sourceId:blue.id,targetId:red.id}),
        expect.objectContaining({type:'heroDamaged',hpDamage:0,shieldAbsorbed:expect.any(Number),abilityId:null}),
      ]);
      expect((sim.snapshot().events[1] as Extract<PresentationEvent,{type:'heroDamaged'}>).shieldAbsorbed).toBeGreaterThan(0);
      sim.step([]);expect(sim.snapshot().events).toEqual([]);
    });
    it(`v${version} caps lethal HP damage and cancels the victim's actual cast`,async()=>{
      const {sim,blue,red}=await arena(version);place(red,{x:1,z:0});red.hp=1;
      sim.step([{type:'cast',heroId:red.id,slot:'R',point:{x:0,z:0}},{type:'attack',heroId:blue.id,targetId:red.id}]);
      expect(sim.snapshot().events.map(e=>e.type)).toEqual(['castStarted','basicAttack','heroDamaged','castCancelled']);
      expect(sim.snapshot().events[2]).toMatchObject({hpDamage:1,shieldAbsorbed:0});
      expect(sim.snapshot().events[3]).toMatchObject({reason:'dead',heroId:red.id});expect(red.alive).toBe(false);
    });
    it(`v${version} repeated identical inputs regenerate identical event batches and hashes`,async()=>{
      const a=await arena(version),b=await arena(version);for(let tick=0;tick<25;tick++){
        const commands:SimCommand[]=tick===0?[{type:'cast',heroId:a.blue.id,slot:'Q',direction:{x:1,z:0}}]:[];
        a.sim.step(commands);b.sim.step(commands);expect(a.sim.snapshot().events).toEqual(b.sim.snapshot().events);expect(a.sim.finalHash()).toBe(b.sim.finalHash());
      }
    });
  }
  it('v9 preserves both committed lethal swings and damage before deaths',async()=>{
    const {sim,blue,red}=await arena(9);place(red,{x:1,z:0});blue.hp=red.hp=1;
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id},{type:'attack',heroId:red.id,targetId:blue.id}]);
    expect(sim.snapshot().events.map(e=>e.type)).toEqual(['basicAttack','heroDamaged','basicAttack','heroDamaged']);
    expect(blue.alive||red.alive).toBe(false);
  });
});
