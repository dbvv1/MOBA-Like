import {describe,it,expect} from 'vitest';
import {LocalMatch,decodeMatchSave,restoreMatch,type MatchRecipe} from '../../src/save/match.js';
import {Simulation} from '../../src/sim/simulation.js';
import {HeroBot} from '../../src/sim/ai.js';
import type {SimCommand} from '../../src/sim/types.js';
import {testNavigation} from '../helpers.js';
import oldSave from './fixtures/v1-match.json';

const ID='test-rules';
const recipe:MatchRecipe={seed:1,contentVersion:10,heroIdsByTeam:[['morrow'],['veyra']],maxMatchSeconds:1200,botSeed:1002,botDifficulty:'normal'};
const inputs=(tick:number,id:number):SimCommand[]=>tick===1?[{type:'move',heroId:id,point:{x:0,z:0}}]:tick===100?[{type:'stop',heroId:id},{type:'attackMove',heroId:id,point:{x:35,z:0}}]:tick%90===0?[{type:'cast',heroId:id,slot:'Q',targetId:null,direction:{x:1,z:0},point:{x:8,z:0}}]:[];

describe('local match replay checkpoint',()=>{
  it('loads real v1 bytes after v2 adds camera lock, while preserving an explicit unlocked v2 camera',async()=>{
    const bytes=JSON.stringify(oldSave),save=decodeMatchSave(bytes,ID);
    expect(save.formatVersion).toBe(2);expect(save.view.cameraLocked).toBe(true);
    const restored=await restoreMatch(save,await testNavigation(),ID);
    expect(restored.simulation.finalHash()).toBe(oldSave.stateHash);
    const v2=restored.checkpoint({cameraLocked:false});
    expect(decodeMatchSave(JSON.stringify(v2),ID).view.cameraLocked).toBe(false);
    expect(JSON.stringify(oldSave)).toBe(bytes);
    expect(()=>decodeMatchSave(JSON.stringify({...v2,view:{}}),ID)).toThrow(/invalid data/);
  });
  it('preserves the existing client ordering and reconstructs private bot state before continuing',async()=>{
    const nav=await testNavigation();
    const match=new LocalMatch(recipe,nav,ID);
    const original=new Simulation({...recipe,navigation:nav,heroesPerTeam:1});
    const bot=new HeroBot({team:1,slotIndex:0,difficulty:'normal',seed:1002});
    for(let tick=1;tick<=1200;tick++){
      const issued=inputs(tick,match.playerId);
      match.step(issued);original.step([...issued,...bot.think(original)]);
    }
    expect(match.simulation.finalHash()).toBe(original.finalHash());
    const save=decodeMatchSave(JSON.stringify(match.checkpoint()),ID);
    const restored=await restoreMatch(save,nav,ID);
    expect(restored.simulation.finalHash()).toBe(match.simulation.finalHash());
    expect(restored.simulation.getHero(0)!.definitionId).toBe('morrow');
    for(let tick=1201;tick<=3000;tick++){
      const issued=inputs(tick,match.playerId);
      match.step(issued);restored.step(issued);
      if(tick%60===0)expect(restored.simulation.finalHash()).toBe(match.simulation.finalHash());
    }
    expect(restored.checkpoint()).toEqual(match.checkpoint());
  });
  it('copies commands, preserves same-tick order and does not apply pending inputs',async()=>{
    const match=new LocalMatch(recipe,await testNavigation(),ID);
    const move:SimCommand={type:'move',heroId:match.playerId,point:{x:1,z:2}};
    match.step([move,{type:'stop',heroId:match.playerId}]);move.point.x=999;
    const saved=match.checkpoint();
    expect(saved.inputs[0]!.commands[0]).toEqual({type:'move',heroId:match.playerId,point:{x:1,z:2}});
    saved.inputs.length=0;
    expect(match.checkpoint().inputs).toHaveLength(1);
  });
  it('checks the rules identity, field types, finite vectors, limits and strictly ordered ticks',async()=>{
    const match=new LocalMatch(recipe,await testNavigation(),ID);match.step(inputs(1,match.playerId));
    const save=match.checkpoint();
    expect(()=>decodeMatchSave(JSON.stringify(save),'new-rules')).toThrow(/another rules version/);
    expect(()=>decodeMatchSave('{',ID)).toThrow(/JSON/);
    for(const change of [
      {tick:-1},{tick:36001},{formatVersion:88},{recipe:{...recipe,heroIdsByTeam:[['missing'],['veyra']]}},
      {recipe:{...recipe,botDifficulty:['high']}},
      {inputs:[save.inputs[0],save.inputs[0]]},{inputs:[{tick:2,commands:save.inputs[0]!.commands}]},
      {inputs:[{tick:1,commands:[{type:'move',heroId:match.playerId,point:{x:null,z:0}}]}]},
      {inputs:[{tick:1,commands:[{type:'stop',heroId:match.playerId,mana:999}]}]},
      {inputs:[{tick:1,commands:[{type:'cast',heroId:match.playerId,slot:['Q'],targetId:null,direction:{x:1,z:0},point:null}]}]},
    ])expect(()=>decodeMatchSave(JSON.stringify({...save,...change}),ID)).toThrow();
  });
  it('rejects a false endpoint or forged player command without releasing a partial match',async()=>{
    const nav=await testNavigation(),match=new LocalMatch(recipe,nav,ID);match.step();
    await expect(restoreMatch({...match.checkpoint(),stateHash:'0000000000000000'},nav,ID)).rejects.toThrow(/reproduce/);
    const save=match.checkpoint();save.inputs=[{tick:1,commands:[{type:'stop',heroId:999}]}];
    await expect(restoreMatch(save,nav,ID)).rejects.toThrow(/this player/);
  });
  it('restores across natural player death/respawn and continues to the identical terminal result',async()=>{
    const nav=await testNavigation(),match=new LocalMatch({...recipe,maxMatchSeconds:180},nav,ID);
    // Walking into the enemy base uses real damage/death rules, not a mutated snapshot.
    match.step([{type:'move',heroId:match.playerId,point:{x:51,z:0}}]);
    while(match.simulation.getHero(0)!.alive&&match.simulation.state.tick<4000)match.step();
    expect(match.simulation.getHero(0)!.alive).toBe(false);
    const restored=await restoreMatch(match.checkpoint(),nav,ID);
    while(!match.simulation.isComplete()){match.step();restored.step();}
    expect(restored.simulation.finalHash()).toBe(match.simulation.finalHash());
    expect(()=>match.checkpoint()).toThrow(/Finished/);
  });
  it('yields during recovery without adding simulation ticks or inputs',async()=>{
    const nav=await testNavigation(),match=new LocalMatch(recipe,nav,ID);
    for(let i=0;i<250;i++)match.step();
    const progress:number[]=[];
    const restored=await restoreMatch(match.checkpoint(),nav,ID,async tick=>{progress.push(tick);});
    expect(progress).toEqual([120,240]);expect(restored.checkpoint()).toEqual(match.checkpoint());
  });
});
