import {describe,it,expect} from 'vitest';
import {makeSim,hero,place,testNavigation} from './helpers.js';
import {LocalMatch,restoreMatch,decodeMatchSave} from '../src/save/match.js';
import type {SimCommand} from '../src/sim/types.js';
const cast=(id:number,slot:'Q'|'W'|'E'='Q'):SimCommand=>({type:'cast',heroId:id,slot,targetId:null,direction:{x:1,z:0},point:{x:3,z:0}});
describe('v12 single next-command buffer',()=>{
 it('accepts ready W once and starts on the Q release tick, old v11 rejects',async()=>{
  for(const v of [11,12] as const){const s=await makeSim(v);const h=hero(s,0);place(h,{x:0,z:0});s.step([cast(h.id)]);const r=s.step([cast(h.id,'W')]);expect(r[0].accepted).toBe(v===12);while(s.state.tick<5)s.step([]);const events=s.snapshot().events;expect(events.some(e=>e.type==='castResolved'&&e.slot==='Q')).toBe(true);expect(events.some(e=>e.type==='castStarted'&&e.slot==='W')).toBe(v===12);expect(h.queuedCommand).toBeUndefined();}
 });
 it('queues during attack windup and consumes on its release tick without cancellation',async()=>{
  const s=await makeSim(12),h=hero(s,0),enemy=hero(s,1);place(h,{x:0,z:0});place(enemy,{x:5,z:0});s.step([{type:'attack',heroId:h.id,targetId:enemy.id}]);const release=h.basicAttack!.commitTick;s.step([cast(h.id)]);expect(h.basicAttack).toBeDefined();while(s.state.tick<release)s.step([]);expect(s.snapshot().events.some(e=>e.type==='basicAttack'&&e.sourceId===h.id)).toBe(true);expect(s.snapshot().events.some(e=>e.type==='castStarted'&&e.slot==='Q')).toBe(true);
  const remaining=h.cast!.remainingTicks;expect(remaining).toBe(5);
  while(s.state.tick<release+remaining-1){s.step([]);expect(s.snapshot().events.some(e=>e.type==='castResolved'&&e.slot==='Q')).toBe(false);}
  s.step([]);expect(s.snapshot().events.filter(e=>e.type==='castResolved'&&e.slot==='Q')).toHaveLength(1);
 });
 it('last valid input wins; invalid input cannot erase queue; caller cannot mutate it',async()=>{
  const s=await makeSim(12),h=hero(s,0);place(h,{x:0,z:0});s.step([cast(h.id)]);const w=cast(h.id,'W');s.step([w]);(w as any).slot='R';s.step([{type:'move',heroId:h.id,point:{x:4,z:0}}]);s.step([{type:'attack',heroId:h.id,targetId:99999}]);expect(h.queuedCommand?.type).toBe('move');s.step([]);expect(h.queuedCommand).toBeUndefined();expect(h.position.x).toBeGreaterThan(0);
 });
 it('revalidates mana once; no retry; death and stun discard queued intent',async()=>{
  for(const condition of ['mana','dead','stun']){const s=await makeSim(12),h=hero(s,0);s.step([cast(h.id)]);s.step([cast(h.id,'W')]);if(condition==='mana')h.mana=0;if(condition==='dead'){h.alive=false;h.hp=0;}if(condition==='stun')h.statuses.push({kind:'stun',percent:0,expiresTick:99,sourceId:h.id});for(let i=0;i<7;i++)s.step([]);expect(h.queuedCommand).toBeUndefined();expect(h.cooldowns.W).toBe(0);}
 });
 it('stop cancels queue immediately and does not defer accidental movement',async()=>{const s=await makeSim(12),h=hero(s,0);s.step([cast(h.id)]);s.step([cast(h.id,'W')]);s.step([{type:'stop',heroId:h.id}]);expect(h.queuedCommand).toBeUndefined();while(s.state.tick<7)s.step([]);expect(h.cooldowns.W).toBe(0);});
 it('queued state survives actual LocalMatch checkpoint replay and same continuation',async()=>{const nav=await testNavigation(),recipe={seed:1,contentVersion:12 as const,heroIdsByTeam:[['veyra'],['veyra']] as const,maxMatchSeconds:600,botSeed:1002,botDifficulty:'normal' as const};const a=new LocalMatch(recipe,nav,'test');a.step([cast(a.playerId)]);a.step([cast(a.playerId,'W')]);expect(a.simulation.getHero(0)!.queuedCommand).toBeDefined();const b=await restoreMatch(decodeMatchSave(JSON.stringify(a.checkpoint()),'test'),nav,'test');expect(b.simulation.finalHash()).toBe(a.simulation.finalHash());for(let i=0;i<50;i++){a.step();b.step();expect(a.simulation.finalHash()).toBe(b.simulation.finalHash());}});
 it('queued move starts on attack release, not a tick later',async()=>{const s=await makeSim(12),h=hero(s,0),e=hero(s,1);place(h,{x:0,z:0});place(e,{x:5,z:0});s.step([{type:'attack',heroId:h.id,targetId:e.id}]);const release=h.basicAttack!.commitTick;s.step([{type:'move',heroId:h.id,point:{x:-5,z:0}}]);while(s.state.tick<release-1)s.step([]);const before=h.position.x;s.step([]);expect(s.snapshot().events.some(e=>e.type==='basicAttack'&&e.sourceId===h.id)).toBe(true);expect(h.position.x).toBeLessThan(before);expect(Math.abs(h.position.x-before)).toBeLessThanOrEqual(h.stats.moveSpeed/30+1e-6);});
 it('target death at consumption discards buffered attack; cooldown loss discards skill',async()=>{for(const type of ['attack','cast']){const s=await makeSim(12),h=hero(s,0),e=hero(s,1);place(h,{x:0,z:0});place(e,{x:5,z:0});s.step([cast(h.id)]);s.step([type==='attack'?{type:'attack',heroId:h.id,targetId:e.id}:cast(h.id,'W')]);if(type==='attack'){e.alive=false;e.hp=0;e.respawnAtTick=9999;}else h.cooldowns.W=100;while(s.state.tick<5)s.step([]);expect(h.queuedCommand).toBeUndefined();expect(s.snapshot().events.some(e=>e.type==='castStarted'&&e.slot==='W')).toBe(false);expect(s.state.diagnostics.rejectionReasons[type==='attack'?'targetDead':'cooldown']).toBe(1);}});

 it('cancelled windup cannot chase old target then consume a second move budget',async()=>{for(const invalid of ['range','dead']){const s=await makeSim(12),h=hero(s,0),e=hero(s,1);place(h,{x:0,z:0});place(e,{x:5,z:0});s.step([{type:'attack',heroId:h.id,targetId:e.id}]);s.step([{type:'move',heroId:h.id,point:{x:0,z:5}}]);if(invalid==='range')place(e,{x:20,z:0});else{e.alive=false;e.hp=0;e.respawnAtTick=9999;}s.step([]);expect(h.position.x).toBeCloseTo(0,8);expect(h.position.z).toBeCloseTo(h.stats.moveSpeed/30,8);expect(h.queuedCommand).toBeUndefined();}});

});
