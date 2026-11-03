import {describe,expect,it} from 'vitest';
import {Simulation} from '../src/sim/simulation.js';
import type {MinionEntity,PresentationEvent,StructureEntity} from '../src/sim/types.js';
import {hero,makeSim,place,stepMany,testNavigation,killGuardStructures,structure} from './helpers.js';

type GoldAward = Extract<PresentationEvent,{type:'goldAwarded'}>;

function goldEvents(sim: Simulation): GoldAward[] {
  return sim.snapshot().events.filter((event): event is GoldAward => event.type === 'goldAwarded');
}

describe('authoritative gold reward events',()=>{
  it('reports one heroKill award to the actual hero killer with the death position',async()=>{
    const sim=await makeSim(8),blue=hero(sim,0),red=hero(sim,1);
    place(blue,{x:0,z:0});place(red,{x:1,z:0});red.hp=1;
    const goldBefore=blue.gold;
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);
    const awards=goldEvents(sim);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({recipientId:blue.id,targetId:red.id,amount:300,position:{x:1,z:0},reason:'heroKill',tick:1});
    expect(blue.gold-goldBefore).toBeGreaterThanOrEqual(300);
    const batch=sim.snapshot().events;
    expect(new Set(batch.map(event=>event.ordinal)).size).toBe(batch.length);
  });

  it('reports the existing team award, not an assist, when no hero lands the kill',async()=>{
    const navigation=await testNavigation();
    const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:2});
    const blueFirst=hero(sim,0,0),blueSecond=hero(sim,0,1),red=hero(sim,1,0);
    place(red,{x:-28,z:0});red.hp=1;
    blueFirst.gold=0;blueSecond.gold=0;
    blueSecond.alive=false;blueSecond.hp=0;blueSecond.respawnAtTick=10000;
    sim.step([]);
    expect(red.alive).toBe(false);
    const awards=goldEvents(sim);
    expect(awards).toHaveLength(2);
    expect(awards.map(award=>award.reason)).toEqual(['heroTeamReward','heroTeamReward']);
    expect(awards.map(award=>award.recipientId)).toEqual([blueFirst.id,blueSecond.id]);
    for(const award of awards) expect(award).toMatchObject({targetId:red.id,amount:150,position:{x:-28,z:0},tick:1});
    expect(blueFirst.gold).toBeGreaterThanOrEqual(150);
    expect(blueSecond.gold).toBeGreaterThanOrEqual(150);
  });

  it('reports a minion last hit only for a hero, and none for a non-hero kill',async()=>{
    const sim=await makeSim(8);
    stepMany(sim,Math.ceil(sim.catalog.rules.waves.firstWaveTime*sim.tickRateHz)+1);
    const minion=sim.state.entities.find((entity):entity is MinionEntity=>entity.kind==='minion'&&entity.team===1&&entity.minionKind==='melee')!;
    sim.state.entities=sim.state.entities.filter(entity=>entity.kind!=='minion'||entity.id===minion.id);
    const blue=hero(sim,0);
    place(blue,{x:0,z:0});place(minion,{x:1,z:0});
    minion.hp=1;minion.targetId=null;minion.targetRefreshTick=10000;
    blue.gold=0;
    sim.step([{type:'attack',heroId:blue.id,targetId:minion.id}]);
    expect(minion.alive).toBe(false);
    const awards=goldEvents(sim);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({recipientId:blue.id,targetId:minion.id,amount:24,position:{x:1,z:0},reason:'minionLastHit'});
    expect(blue.gold).toBeGreaterThanOrEqual(24);

    const towerSim=await makeSim(8);
    stepMany(towerSim,Math.ceil(towerSim.catalog.rules.waves.firstWaveTime*towerSim.tickRateHz)+1);
    const victim=towerSim.state.entities.find((entity):entity is MinionEntity=>entity.kind==='minion'&&entity.team===1&&entity.minionKind==='melee')!;
    towerSim.state.entities=towerSim.state.entities.filter(entity=>entity.kind!=='minion'||entity.id===victim.id);
    place(victim,{x:-28,z:0});victim.hp=1;victim.targetId=null;victim.targetRefreshTick=10000;
    const tower=towerSim.state.entities.find((entity):entity is StructureEntity=>entity.kind==='structure'&&entity.definitionId==='blue-outer-tower')!;
    tower.targetId=null;tower.targetRefreshTick=0;tower.attackCooldown=0;
    const towerBlue=hero(towerSim,0),towerRed=hero(towerSim,1);
    towerBlue.gold=0;towerRed.gold=0;
    towerSim.step([]);
    expect(victim.alive).toBe(false);
    expect(goldEvents(towerSim)).toEqual([]);
    expect(towerBlue.gold).toBeLessThan(1);
    expect(towerRed.gold).toBeLessThan(1);
  });

  it('reports the structure bounty to its hero killer and the fixed team share to teammates',async()=>{
    const navigation=await testNavigation();
    const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:2});
    const killer=hero(sim,0,0),teammate=hero(sim,0,1);
    const tower=sim.state.entities.find(entity=>entity.kind==='structure'&&entity.definitionId==='red-outer-tower')!;
    place(killer,{x:26,z:0});place(teammate,{x:0,z:0});tower.hp=1;
    killer.gold=0;teammate.gold=0;
    sim.step([{type:'attack',heroId:killer.id,targetId:tower.id}]);
    expect(tower.alive).toBe(false);
    const awards=goldEvents(sim);
    expect(awards).toHaveLength(2);
    expect(awards[0]).toMatchObject({recipientId:killer.id,targetId:tower.id,amount:150,position:{x:28,z:0},reason:'structureLastHit'});
    expect(awards[1]).toMatchObject({recipientId:teammate.id,targetId:tower.id,amount:60,reason:'structureTeamReward'});
    expect(killer.gold).toBeGreaterThanOrEqual(150);
    expect(teammate.gold).toBeGreaterThanOrEqual(60);
  });

  it('v9 gives one award per death and never rewards repeated corpse attacks',async()=>{
    const navigation=await testNavigation();
    const sim=new Simulation({seed:1,contentVersion:9,navigation,heroesPerTeam:2,heroIdsByTeam:[['veyra','veyra'],['veyra']]});
    const first=hero(sim,0,0),second=hero(sim,0,1),victim=hero(sim,1,0);
    place(first,{x:0,z:0});place(second,{x:0,z:1});place(victim,{x:1,z:0});victim.hp=1;
    sim.step([{type:'attack',heroId:first.id,targetId:victim.id},{type:'attack',heroId:second.id,targetId:victim.id}]);
    expect(victim.alive).toBe(false);
    const awards=goldEvents(sim);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({recipientId:first.id,targetId:victim.id,amount:300,reason:'heroKill'});
    expect(victim.deaths).toBe(1);
    const redGold=victim.gold;
    sim.step([{type:'attack',heroId:first.id,targetId:victim.id}]);
    expect(goldEvents(sim)).toEqual([]);
    expect(victim.deaths).toBe(1);
    expect(victim.gold).toBeCloseTo(redGold+sim.catalog.rules.passiveGoldPerSecond/sim.tickRateHz,6);
  });

  it('keeps a real zero-bounty base kill silent for the killer while paying its teammate',async()=>{
    const sim=new Simulation({seed:1,contentVersion:8,navigation:await testNavigation(),heroesPerTeam:2});
    const killer=hero(sim,0,0),teammate=hero(sim,0,1),base=structure(sim,'red-base');
    killGuardStructures(sim,1);sim.step([]);
    place(killer,{x:99,z:0});base.hp=1;
    const before=killer.gold,teamBefore=teammate.gold;
    sim.step([{type:'attack',heroId:killer.id,targetId:base.id}]);
    expect(base.alive).toBe(false);
    expect(killer.gold-before).toBeCloseTo(sim.catalog.rules.passiveGoldPerSecond/sim.tickRateHz,6);
    expect(teammate.gold-teamBefore).toBeCloseTo(60+sim.catalog.rules.passiveGoldPerSecond/sim.tickRateHz,6);
    expect(goldEvents(sim)).toEqual([expect.objectContaining({recipientId:teammate.id,targetId:base.id,amount:60,reason:'structureTeamReward'})]);
    expect(sim.isComplete()).toBe(true);
    const terminal=sim.snapshot().events;sim.step([]);expect(sim.snapshot().events).toEqual(terminal);
  });

  it('emits nothing for passive income, shopping, or an ordinary tick',async()=>{
    const sim=await makeSim(8),blue=hero(sim,0);
    sim.step([]);
    expect(goldEvents(sim)).toEqual([]);
    blue.gold=1000;
    const result=sim.step([{type:'buyItem',heroId:blue.id,itemId:'wayfarer_boots'}]);
    expect(result[0]?.accepted).toBe(true);
    expect(blue.items).toContain('wayfarer_boots');
    expect(goldEvents(sim)).toEqual([]);
    expect('events' in sim.state).toBe(false);
    expect(JSON.stringify(sim.state)).not.toContain('goldAwarded');
  });

  it('deep-copies nested position and retains the last batch after the match ends',async()=>{
    const sim=await makeSim(8),blue=hero(sim,0),red=hero(sim,1);
    place(blue,{x:0,z:0});place(red,{x:1,z:0});red.hp=1;
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);
    const first=sim.snapshot(),hash=sim.finalHash();
    const award=first.events.find((event):event is GoldAward=>event.type==='goldAwarded')! as unknown as {position:{x:number;z:number};amount:number};
    award.position.x=-999;award.amount=-1;
    expect(sim.finalHash()).toBe(hash);
    expect(goldEvents(sim)[0]).toMatchObject({amount:300,position:{x:1,z:0}});
    sim.step([]);
    expect(goldEvents(sim)).toEqual([]);

    const terminalSim=await makeSim(8),killer=hero(terminalSim,0),victim=hero(terminalSim,1);
    place(killer,{x:0,z:0});place(victim,{x:1,z:0});victim.hp=1;
    terminalSim.step([{type:'attack',heroId:killer.id,targetId:victim.id}]);
    const terminal=terminalSim.snapshot().events;
    expect(terminal.some(event=>event.type==='goldAwarded')).toBe(true);
    terminalSim.state.status='timeout';
    terminalSim.step([]);
    expect(terminalSim.snapshot().events).toEqual(terminal);
  });
});
