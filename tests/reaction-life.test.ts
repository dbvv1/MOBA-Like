import {describe,it,expect} from 'vitest';
import {HeroBot,replayMatch,runBotMatch} from '../src/sim/index.js';
import type {ContentVersion,Difficulty} from '../src/content/types.js';
import {hero,makeSim,place,testNavigation} from './helpers.js';
async function fixture(version:ContentVersion,difficulty:Difficulty='low'){
  const sim=await makeSim(version),own=hero(sim,0),enemy=hero(sim,1);place(own,{x:0,z:0});place(enemy,{x:10,z:0});
  const bot=new HeroBot({team:0,slotIndex:0,difficulty,seed:1});
  const view=bot as unknown as {firstSeen:Map<number,number>;nextDecisionTick:number;isReactionReady(id:number,tick:number):boolean};
  view.nextDecisionTick=Infinity;bot.think(sim);expect(view.firstSeen.get(enemy.id)).toBe(0);
  return {sim,own,enemy,bot,view};
}
describe('per-life reaction memory',()=>{
  for(const difficulty of ['low','normal','high'] as const)it(`${difficulty}: near respawn must wait its full existing reaction interval`,async()=>{
    const {sim,enemy,bot,view}=await fixture(8,difficulty);sim.state.tick=120;enemy.alive=false;bot.think(sim);expect(view.firstSeen.has(enemy.id)).toBe(false);
    sim.state.tick=121;enemy.alive=true;bot.think(sim);const delay=sim.catalog.difficulty[difficulty].reactionTicks;
    expect(view.firstSeen.get(enemy.id)).toBe(121);expect(view.isReactionReady(enemy.id,121+delay-1)).toBe(false);expect(view.isReactionReady(enemy.id,121+delay)).toBe(true);
    sim.state.tick=122;bot.think(sim);expect(view.firstSeen.get(enemy.id)).toBe(121);
  });
  it('own death clears reaction memory so its new life reacquires visible enemies',async()=>{
    const {sim,own,enemy,bot,view}=await fixture(8);sim.state.tick=120;own.alive=false;expect(bot.think(sim)).toEqual([]);expect(view.firstSeen.size).toBe(0);
    own.alive=true;sim.state.tick=121;bot.think(sim);expect(view.firstSeen.get(enemy.id)).toBe(121);expect(view.isReactionReady(enemy.id,121)).toBe(false);
  });
  it('prunes dead or removed enemies even while the observer is stunned or casting',async()=>{
    for(const kind of ['stun','cast','removed'] as const){const {sim,own,enemy,bot,view}=await fixture(8);sim.state.tick=120;
      if(kind==='cast')own.cast={id:999,slot:'Q',abilityId:'veyra.q',remainingTicks:10,targetId:null,direction:{x:1,z:0},point:null};
      else own.statuses.push({kind:'stun',percent:0,expiresTick:150,sourceId:enemy.id});
      if(kind==='removed')sim.state.entities=sim.state.entities.filter(e=>e.id!==enemy.id);else enemy.alive=false;
      bot.think(sim);expect(view.firstSeen.has(enemy.id)).toBe(false);
    }
  });
  it('preserves old per-life behavior for v1/v2/v7 and unchanged far-return behavior',async()=>{
    for(const version of [1,2,7] as const){const {sim,enemy,bot,view}=await fixture(version);sim.state.tick=120;enemy.alive=false;bot.think(sim);enemy.alive=true;sim.state.tick=121;bot.think(sim);expect(view.isReactionReady(enemy.id,121)).toBe(true);}
    const {sim,enemy,bot,view}=await fixture(8);enemy.position={x:80,z:0};sim.state.tick=120;bot.think(sim);enemy.position={x:10,z:0};sim.state.tick=121;bot.think(sim);expect(view.firstSeen.get(enemy.id)).toBe(121);
  });
  it('preserves the full v7 seed-61 input-driven replay hash',async()=>{
    const navigation=await testNavigation(),match=runBotMatch({seed:61,contentVersion:7,navigation,blueDifficulty:'high',redDifficulty:'low'});
    expect(match.simulation.finalHash()).toBe('31a6eaa8aa216987');expect(replayMatch(match.replay,navigation).hashMatches).toBe(true);
  });
  it('records v8 and replays input commands without invoking bot perception',async()=>{
    const navigation=await testNavigation(),match=runBotMatch({seed:61,contentVersion:8,navigation,blueDifficulty:'high',redDifficulty:'low',maxMatchSeconds:30});expect(match.replay.contentVersion).toBe(8);expect(replayMatch(match.replay,navigation).hashMatches).toBe(true);
  });
});
