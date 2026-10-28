import {createHash} from 'node:crypto';
import {deriveSeed} from '../src/sim/rng.js';
import {expect,it} from 'vitest';
import {Simulation} from '../src/sim/simulation.js';
import {runBotMatch,replayMatch} from '../src/sim/runner.js';
import type {Replay} from '../src/sim/types.js';
import {HeroBot} from '../src/sim/ai.js';
import {testNavigation} from './helpers.js';
it('preserves pre-change default and historical multiplayer hashes without the opt-in rule',async()=>{
  const navigation=await testNavigation();
  for(const [heroesPerTeam,hash] of [[1,'df459a03808dd0c5'],[3,'930dfd812fa98e87'],[5,'8eea57aba2a3ef1d']] as const){
    const result=runBotMatch({navigation,seed:17,contentVersion:10,heroesPerTeam,blueDifficulty:'normal',redDifficulty:'normal',maxMatchSeconds:10});
    expect(result.simulation.finalHash()).toBe(hash);expect(result.replay).not.toHaveProperty('laneFormation');
  }
});
it('spawns and respawns all ten heroes at separate walkable positions clear of structures',async()=>{
  const sim=new Simulation({navigation:await testNavigation(),seed:1,contentVersion:10,heroesPerTeam:5,laneFormation:'spread-v1'});
  const heroes=sim.state.entities.filter(e=>e.kind==='hero');
  const original=heroes.map(e=>({...e.position}));
  for(const a of heroes){
    const projected=sim.navigation.closestPoint(a.position)!;expect(Math.hypot(projected.x-a.position.x,projected.z-a.position.z)).toBeLessThan(.01);
    for(const b of sim.state.entities.filter(e=>e.id!==a.id&&(e.kind==='hero'||e.kind==='structure')))expect(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)).toBeGreaterThan(a.radius+b.radius);
    a.alive=false;a.hp=0;a.respawnAtTick=1;a.position={x:0,z:0};
  }
  sim.step([]);expect(heroes.map(e=>e.position)).toEqual(original);expect(heroes.every(e=>e.alive)).toBe(true);
});
it('round trips the formation through real runner export JSON and replay; malformed rules fail closed',async()=>{
  const navigation=await testNavigation();
  const result=runBotMatch({navigation,seed:21,contentVersion:10,heroesPerTeam:5,laneFormation:'spread-v1',blueDifficulty:'normal',redDifficulty:'normal',maxMatchSeconds:10});
  const replay=JSON.parse(JSON.stringify(result.replay)) as Replay;
  expect(replay.laneFormation).toBe('spread-v1');expect(replayMatch(replay,navigation).hashMatches).toBe(true);
  for(const value of ['',null,'spread-v2',1])expect(()=>replayMatch({...replay,laneFormation:value} as unknown as Replay,navigation)).toThrow();
  expect(()=>new Simulation({navigation,seed:1,contentVersion:10,heroesPerTeam:1,laneFormation:'spread-v1'})).toThrow();
});
it('new formation gives bots distinct reachable rally lanes using ordinary commands',async()=>{
  const sim=new Simulation({navigation:await testNavigation(),seed:1,contentVersion:10,heroesPerTeam:5,laneFormation:'spread-v1'});
  const destinations=[];
  for(let slot=0;slot<5;slot++){
    const commands=new HeroBot({team:0,slotIndex:slot,difficulty:'normal',seed:100}).think(sim);
    const move=commands.find(c=>c.type==='move');expect(move?.type).toBe('move');
    if(move?.type==='move'){destinations.push(move.point.z);expect(sim.navigation.findPath(sim.getHero(0,slot)!.position,move.point).success).toBe(true);}
  }
  expect(new Set(destinations).size).toBe(5);
});

it('preserves every legacy tick in a 300-tick trace for 1v1, 3v3 and 5v5',async()=>{
  // Captured from fixed parent tree 37579d044b767674aedf1733344a54a01091f5be.
  const expected=['4302b4fcbf8427ea99340d2f9a1ffee48f1b646a7ea3dfc022995c38fbbdc07b','cfc91f04559f760608db7f9cbd985680ee5019f222bd55fd7f5d210e363d13c9','426aec98fce0f54e7b721e569ee417747a17364a1e9d2e383900099aec58fb8e'];
  for(const [index,heroesPerTeam] of [1,3,5].entries()){
    const sim=new Simulation({navigation:await testNavigation(),seed:17,contentVersion:10,heroesPerTeam,maxMatchSeconds:10});
    const bots=([0,1] as const).flatMap(team=>Array.from({length:heroesPerTeam},(_,slot)=>new HeroBot({team,slotIndex:slot,difficulty:'normal',seed:deriveSeed(17,team*100+slot+1)})));
    const hash=createHash('sha256');while(!sim.isComplete()){sim.step(bots.flatMap(bot=>bot.think(sim)));hash.update(sim.finalHash()+'\n');}
    expect(hash.digest('hex')).toBe(expected[index]);
  }
});
