import {describe,it,expect} from 'vitest';
import {HeroBot,replayMatch,runBotMatch} from '../src/sim/index.js';
import type {Simulation} from '../src/sim/simulation.js';
import type {HeroEntity} from '../src/sim/types.js';
import type {Vec2} from '../src/content/types.js';
import {hero,makeSim,structure,testNavigation} from './helpers.js';
function anchor(sim:Simulation,team:0|1){const bot=new HeroBot({team,slotIndex:0,difficulty:'normal',seed:1});return (bot as unknown as {safePushPoint(sim:Simulation,hero:HeroEntity):Vec2}).safePushPoint(sim,hero(sim,team));}
describe('versioned live tower anchors',()=>{
  for(const team of [0,1] as const)it(`team ${team}: living tower remains eligible; dead or absent tower uses existing fallback`,async()=>{
    const sim=await makeSim(7),prefix=team===0?'blue':'red',tower=structure(sim,`${prefix}-outer-tower`),base=structure(sim,`${prefix}-base`);
    const towerGoal={x:tower.position.x+(team===0?-3:3),z:tower.position.z};
    const baseGoal={x:base.position.x+(team===0?12:-12),z:base.position.z};
    expect(anchor(sim,team)).toEqual(towerGoal);
    tower.hp=0;tower.alive=false;expect(anchor(sim,team)).toEqual(baseGoal);
    sim.state.entities=sim.state.entities.filter(e=>e.id!==tower.id);expect(anchor(sim,team)).toEqual(baseGoal);
  });
  it('retains old v1/v2 dead-tower selection and never changes their catalog rules',async()=>{
    for(const version of [1,2] as const){const sim=await makeSim(version),tower=structure(sim,'blue-outer-tower');tower.hp=0;tower.alive=false;expect(anchor(sim,0)).toEqual({x:tower.position.x-3,z:0});expect(sim.catalog.rules.liveTowerAnchors).toBeUndefined();}
  });
  it('uses existing no-base fallback, not a destroyed tower or invented safe location',async()=>{
    const sim=await makeSim(7);sim.state.entities=sim.state.entities.filter(e=>e.kind!=='structure'||e.team!==0);expect(anchor(sim,0)).toEqual({x:-85,z:0});
  });
  it('preserves the fixed full-match v1/v2 seed-1 state hashes',async()=>{
    const navigation=await testNavigation();
    for(const [version,hash] of [[1,'53b05c06dda5f33f'],[2,'ec3ae9e56a6b148f']] as const){
      const match=runBotMatch({seed:1,contentVersion:version,navigation,blueDifficulty:'normal',redDifficulty:'normal'});
      expect(match.simulation.finalHash()).toBe(hash);
      expect(replayMatch(match.replay,navigation).hashMatches).toBe(true);
    }
  });
  it('records explicit v7 inputs and replays without running the new AI again',async()=>{
    const navigation=await testNavigation(),match=runBotMatch({seed:61,contentVersion:7,navigation,blueDifficulty:'high',redDifficulty:'low',maxMatchSeconds:30});
    expect(match.replay.contentVersion).toBe(7);expect(match.replay.formatVersion).toBe(1);expect(replayMatch(match.replay,navigation).hashMatches).toBe(true);
  });
});
