import {describe,it,expect} from 'vitest';
import {replayMatch} from '../src/sim/index.js';
import {hero,makeSim,place,stepMany,testNavigation} from './helpers.js';
import type {TimedCommand} from '../src/sim/types.js';
describe('explicit attack-move order',()=>{
 it('acquires nearby enemies then resumes the original destination after they die',async()=>{
  const sim=await makeSim(2),own=hero(sim,0),enemy=hero(sim,1);
  place(own,{x:0,z:0});place(enemy,{x:4,z:0});
  const hp=enemy.hp;
  expect(sim.step([{type:'attackMove',heroId:own.id,point:{x:10,z:0}}])[0]?.accepted).toBe(true);
  expect(own.targetId).toBe(enemy.id);expect(enemy.hp).toBeLessThan(hp);
  enemy.alive=false;enemy.hp=0;stepMany(sim,90);
  expect(own.position.x).toBeCloseTo(10,1);
  expect(own.attackMoveGoal).toBeUndefined();
 });
 it('ordinary move and stop replace the order, invalid inputs do not erase it',async()=>{
  const sim=await makeSim(2),own=hero(sim,0);place(own,{x:0,z:0});
  sim.step([{type:'attackMove',heroId:own.id,point:{x:20,z:0}}]);
  expect(sim.step([{type:'attackMove',heroId:own.id,point:{x:NaN,z:0}}])[0]?.reason).toBe('invalidPoint');
  expect(own.attackMoveGoal).toBeDefined();
  sim.step([{type:'move',heroId:own.id,point:{x:-20,z:0}}]);expect(own.attackMoveGoal).toBeUndefined();
  sim.step([{type:'attackMove',heroId:own.id,point:{x:20,z:0}}]);
  sim.step([{type:'stop',heroId:own.id}]);expect(own.attackMoveGoal).toBeUndefined();
 });
 it('respects stun',async()=>{
  const sim=await makeSim(2),own=hero(sim,0);place(own,{x:0,z:0});
  own.statuses.push({kind:'stun',percent:0,expiresTick:300,sourceId:hero(sim,1).id});
  expect(sim.step([{type:'attackMove',heroId:own.id,point:{x:20,z:0}}])[0]?.reason).toBe('stunned');
  expect(own.attackMoveGoal).toBeUndefined();
 });
 it('skips friendly and invulnerable structures, and explicit attack replaces the order',async()=>{
  const sim=await makeSim(2),own=hero(sim,0),enemy=hero(sim,1);
  place(own,{x:-101,z:4});sim.step([{type:'attackMove',heroId:own.id,point:{x:-90,z:4}}]);expect(own.targetId).toBeNull();
  place(own,{x:101,z:4});place(enemy,{x:0,z:0});sim.step([{type:'attackMove',heroId:own.id,point:{x:90,z:4}}]);expect(own.targetId).toBeNull();
  place(own,{x:0,z:0});place(enemy,{x:4,z:0});sim.step([{type:'attackMove',heroId:own.id,point:{x:10,z:0}}]);
  sim.step([{type:'attack',heroId:own.id,targetId:enemy.id}]);expect(own.attackMoveGoal).toBeUndefined();
 });
 it('clears a pending order on death rather than resuming it after respawn',async()=>{
  const sim=await makeSim(2),own=hero(sim,0),enemy=hero(sim,1);place(own,{x:0,z:0});place(enemy,{x:4,z:0});
  own.hp=1;sim.step([{type:'attackMove',heroId:own.id,point:{x:10,z:0}},{type:'attack',heroId:enemy.id,targetId:own.id}]);
  expect(own.alive).toBe(false);expect(own.attackMoveGoal).toBeUndefined();
 });
 it('does not chase a fleeing target outside acquisition range',async()=>{
  const sim=await makeSim(2),own=hero(sim,0),enemy=hero(sim,1);place(own,{x:0,z:0});place(enemy,{x:4,z:0});
  sim.step([{type:'attackMove',heroId:own.id,point:{x:10,z:0}}]);place(enemy,{x:-30,z:0});stepMany(sim,20);
  expect(own.targetId).toBeNull();expect(own.position.x).toBeGreaterThan(3);
 });
 it('pauses an existing order under control then resumes after expiry',async()=>{
  const sim=await makeSim(2),own=hero(sim,0);place(own,{x:0,z:0});
  sim.step([{type:'attackMove',heroId:own.id,point:{x:10,z:0}}]);const before={...own.position};
  own.statuses.push({kind:'stun',percent:0,expiresTick:32,sourceId:hero(sim,1).id});stepMany(sim,30);
  expect(own.position).toEqual(before);expect(own.attackMoveGoal).toBeDefined();
  stepMany(sim,2);expect(own.position.x).toBeGreaterThan(before.x);
 });
 it('versions new input replays without changing legacy format-1 input',async()=>{
  const sim=await makeSim(2,42,{maxMatchSeconds:2});
  const commands:TimedCommand[]=[{tick:1,command:{type:'attackMove',heroId:hero(sim,0).id,point:{x:0,z:0}}}];
  sim.step([commands[0]!.command]);while(!sim.isComplete())sim.step([]);
  const replay=sim.createReplay(commands);expect(replay.formatVersion).toBe(2);
  expect(replayMatch(replay,await testNavigation()).hashMatches).toBe(true);
  expect(()=>replayMatch({...replay,formatVersion:1},sim.navigation)).toThrow(/format version 2/);
  const old=await makeSim(2);expect(old.createReplay([]).formatVersion).toBe(1);
 });
});
