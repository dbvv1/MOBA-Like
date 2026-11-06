import {describe,expect,it} from 'vitest';
import {Simulation} from '../../src/sim/simulation.js';
import type {MinionEntity,PresentationEvent} from '../../src/sim/types.js';
import {createGoldReceipt,GOLD_RECEIPT_LIFETIME_SECONDS} from '../../src/ui/gold-receipt.js';
import {hero,makeSim,place,stepMany,testNavigation} from '../helpers.js';

type GoldAward=Extract<PresentationEvent,{type:'goldAwarded'}>;

function award(overrides:Partial<GoldAward>&Pick<GoldAward,'tick'|'ordinal'|'amount'|'reason'>&{recipientId?:number}):GoldAward{
  return {type:'goldAwarded',recipientId:7,targetId:1,position:{x:0,z:0},...overrides} as GoldAward;
}

describe('player gold receipt consumes authoritative awards',()=>{
  it('shows the real minion last-hit bounty for the player only',async()=>{
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
    const snapshot=sim.snapshot(),receipt=createGoldReceipt(blue.id);
    receipt.consume(snapshot.events,snapshot.timeSeconds);
    expect(receipt.read(snapshot.timeSeconds)).toBe('+24 gold · 补刀');
  });

  it('shows a real team reward even when the receiving player is dead',async()=>{
    const navigation=await testNavigation();
    const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:2});
    const blueFirst=hero(sim,0,0),blueSecond=hero(sim,0,1),red=hero(sim,1,0);
    place(red,{x:-28,z:0});red.hp=1;
    blueSecond.alive=false;blueSecond.hp=0;blueSecond.respawnAtTick=10000;
    sim.step([]);
    expect(red.alive).toBe(false);
    const snapshot=sim.snapshot(),receipt=createGoldReceipt(blueSecond.id);
    receipt.consume(snapshot.events,snapshot.timeSeconds);
    expect(receipt.read(snapshot.timeSeconds)).toBe('+150 gold · 团队击杀');
    expect(receipt.read(snapshot.timeSeconds)).toBe(receipt.read(snapshot.timeSeconds));
    // The victim's own receipt is empty: awards are filtered by recipient, not by team.
    expect(createGoldReceipt(red.id).read(snapshot.timeSeconds)).toBe('');
  });

  it('stays empty for real passive income and shopping',async()=>{
    const sim=await makeSim(8),blue=hero(sim,0),receipt=createGoldReceipt(blue.id);
    sim.step([]);
    receipt.consume(sim.snapshot().events,sim.timeSeconds);
    expect(receipt.read(sim.timeSeconds)).toBe('');
    blue.gold=1000;
    expect(sim.step([{type:'buyItem',heroId:blue.id,itemId:'wayfarer_boots'}])[0]?.accepted).toBe(true);
    receipt.consume(sim.snapshot().events,sim.timeSeconds);
    expect(receipt.read(sim.timeSeconds)).toBe('');
  });

  it('merges awards from the same tick and names mixed reasons',()=>{
    const receipt=createGoldReceipt(7);
    receipt.consume([
      award({tick:12,ordinal:0,amount:24,reason:'minionLastHit'}),
      award({tick:12,ordinal:1,recipientId:8,amount:300,reason:'heroKill'}),
      award({tick:12,ordinal:2,amount:60,reason:'structureTeamReward'}),
    ],12);
    expect(receipt.read(12)).toBe('+84 gold · 多项奖励');

    const sameReason=createGoldReceipt(7);
    sameReason.consume([
      award({tick:4,ordinal:0,amount:150,reason:'heroTeamReward'}),
      award({tick:4,ordinal:1,amount:150,reason:'heroTeamReward'}),
    ],4);
    expect(sameReason.read(4)).toBe('+300 gold · 团队击杀');
  });

  it('shows only the latest tick when one call carries several ticks',()=>{
    const receipt=createGoldReceipt(7);
    receipt.consume([
      award({tick:5,ordinal:0,amount:24,reason:'minionLastHit'}),
      award({tick:6,ordinal:0,amount:60,reason:'structureTeamReward'}),
      award({tick:6,ordinal:1,amount:150,reason:'structureLastHit'}),
    ],6);
    expect(receipt.read(6)).toBe('+210 gold · 多项奖励');
  });

  it('drops a replayed batch and keeps repeated reads stable',()=>{
    const receipt=createGoldReceipt(7);
    const batch=[award({tick:9,ordinal:0,amount:24,reason:'minionLastHit'}),award({tick:9,ordinal:1,amount:60,reason:'structureTeamReward'})];
    receipt.consume(batch,9);
    expect(receipt.read(9)).toBe('+84 gold · 多项奖励');
    receipt.consume(batch,9.1);
    expect(receipt.read(9.1)).toBe('+84 gold · 多项奖励');
    expect(receipt.read(10.5)).toBe('+84 gold · 多项奖励');
    expect(receipt.read(10.5)).toBe('+84 gold · 多项奖励');
    // A new real tick replaces the shown line.
    receipt.consume([award({tick:10,ordinal:0,amount:150,reason:'heroKill'})],10.6);
    expect(receipt.read(10.6)).toBe('+150 gold · 击杀');
    // An old batch delivered again must not overwrite the newer line.
    receipt.consume(batch,10.7);
    expect(receipt.read(10.7)).toBe('+150 gold · 击杀');
  });

  it('expires after two seconds of simulation time, not on repeated reads',()=>{
    const receipt=createGoldReceipt(7);
    receipt.consume([award({tick:3,ordinal:0,amount:24,reason:'minionLastHit'})],10);
    expect(GOLD_RECEIPT_LIFETIME_SECONDS).toBe(2);
    expect(receipt.read(10)).toBe('+24 gold · 补刀');
    expect(receipt.read(11.99)).toBe('+24 gold · 补刀');
    expect(receipt.read(12)).toBe('');
    expect(receipt.read(50)).toBe('');
  });

  it('keeps the terminal last batch while the simulation clock is frozen',async()=>{
    const sim=await makeSim(8),blue=hero(sim,0),red=hero(sim,1);
    place(blue,{x:0,z:0});place(red,{x:1,z:0});red.hp=1;
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);
    const receipt=createGoldReceipt(blue.id),terminalTime=sim.timeSeconds;
    const terminal=sim.snapshot().events;
    receipt.consume(terminal,terminalTime);
    expect(receipt.read(terminalTime)).toBe('+300 gold · 击杀');
    sim.state.status='timeout';sim.step([]);
    expect(sim.snapshot().events).toEqual(terminal);
    receipt.consume(sim.snapshot().events,sim.timeSeconds);
    expect(receipt.read(sim.timeSeconds)).toBe('+300 gold · 击杀');
  });

  it('reset clears the line and the tick:ordinal cursor for a new match',()=>{
    const receipt=createGoldReceipt(7);
    const batch=[award({tick:2,ordinal:0,amount:300,reason:'heroKill'})];
    receipt.consume(batch,2);
    expect(receipt.read(2)).toBe('+300 gold · 击杀');
    receipt.reset();
    expect(receipt.read(2)).toBe('');
    receipt.consume(batch,2);
    expect(receipt.read(2)).toBe('+300 gold · 击杀');
  });

  it('ignores other recipients and non-positive amounts',()=>{
    const receipt=createGoldReceipt(7);
    receipt.consume([
      award({tick:1,ordinal:0,recipientId:8,amount:300,reason:'heroKill'}),
      award({tick:1,ordinal:1,amount:0,reason:'minionLastHit'}),
      award({tick:1,ordinal:2,amount:-5,reason:'minionLastHit'}),
      award({tick:1,ordinal:3,amount:60,reason:'structureTeamReward'}),
    ],1);
    expect(receipt.read(1)).toBe('+60 gold · 团队目标');
  });
});
