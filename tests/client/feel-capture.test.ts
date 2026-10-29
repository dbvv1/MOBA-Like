import {describe,it,expect,vi} from 'vitest';
import {parseCaptureConfig} from '../../src/capture/config.js';
import {CaptureSession,type CaptureConsumer} from '../../src/capture/session.js';
import {CaptureLifetime} from '../../src/capture/lifetime.js';
import {LocalMatch} from '../../src/save/match.js';
import {getContent} from '../../src/content/catalog.js';
import {testNavigation} from '../helpers.js';
const view=():CaptureConsumer=>({sync:vi.fn(),draw:vi.fn(),renderOnly:vi.fn()});
const config=()=>parseCaptureConfig('?shot=gameplay&feel=skill-buffer')!;
describe('MOBA skill input to simulation and recording frames',()=>{
 it('requires fixed explicit gameplay tape without changing existing captures',()=>{
  expect(config()).toMatchObject({seed:1,frames:45,input:'idle',startFrame:0,feel:'skill-buffer'});
  expect(parseCaptureConfig('?shot=gameplay')!.feel).toBeUndefined();
  for(const q of ['?feel=skill-buffer','?shot=spawn&feel=skill-buffer','?shot=gameplay&feel=bad','?shot=gameplay&feel=skill-buffer&seed=2','?shot=gameplay&feel=skill-buffer&feel=skill-buffer'])expect(()=>parseCaptureConfig(q)).toThrow();
 });
 it('goes through real LocalMatch; logs ready W rejection and later W acceptance, never fake visible frames',async()=>{
  const nav=await testNavigation(),a=new CaptureSession(config(),nav),b=new CaptureSession(config(),nav),v=view();
  const control=new LocalMatch({seed:1,contentVersion:11,heroIdsByTeam:[['veyra'],['veyra']],maxMatchSeconds:getContent(11).rules.maxMatchSeconds,botSeed:1002,botDifficulty:'normal'},nav,'feel-capture-no-save');
  await a.prepare(v);await b.prepare(view());
  expect(a.metadata.simTick).toBe(0);expect(a.metadata.feel!.inputs).toHaveLength(0);
  for(let f=1;f<=44;f++){
   a.next(v,f-1);b.next(view(),f-1);expect(a.metadata.stateHash).toBe(b.metadata.stateHash);
   if(f%2===0){const input=a.metadata.feel!.inputs.filter(i=>i.targetTick===f/2).map(i=>i.command);control.step(input);expect(a.metadata.stateHash).toBe(control.simulation.finalHash());}
   expect(a.metadata.simTick).toBe(Math.floor(f/2));
  }
  const trace=a.metadata.feel!;
  expect(trace.inputs.map(i=>[i.id,i.inputFrame,i.targetTick])).toEqual([['q-start',1,1],['w-during-q',3,2],['w-after-q',23,12]]);
  expect(trace.inputs[1]!.before).toMatchObject({wCooldown:0,alive:true,castSlot:'Q'});expect(trace.inputs[1]!.before.mana).toBeGreaterThanOrEqual(30);
  const results=trace.steps.flatMap(s=>s.results.filter(r=>r.command.heroId===a.playerId).map(r=>({tick:s.tick,frame:s.recordingFrame,accepted:r.accepted,reason:r.reason,slot:r.command.type==='cast'?r.command.slot:null})));
  expect(results).toEqual([{tick:1,frame:2,accepted:true,reason:null,slot:'Q'},{tick:2,frame:4,accepted:false,reason:'alreadyCasting',slot:'W'},{tick:12,frame:24,accepted:true,reason:null,slot:'W'}]);
  const releases=trace.steps.flatMap(s=>s.events.filter(e=>e.type==='castResolved'&&e.heroId===a.playerId).map(e=>({tick:e.tick,frame:s.recordingFrame,slot:'slot'in e?e.slot:null})));
  expect(releases).toContainEqual({tick:5,frame:10,slot:'Q'});
  expect(releases.filter(e=>e.slot==='W').every(e=>e.tick>=12)).toBe(true);
  expect(trace.firstVisibleFrame).toBeNull();expect(trace.audio).toMatch(/unknown/);
  expect(a.next(v,44)).toBe(false);expect(()=>a.next(v,43)).toThrow('Stale');
 });
 it('lifetime cancellation stops commands and rendering',async()=>{
  const life=new CaptureLifetime(),session=new CaptureSession(config(),await testNavigation(),life),v=view();await session.prepare(v);life.dispose();expect(()=>session.next(v)).toThrow('cancelled');expect(session.metadata.feel!.inputs).toHaveLength(0);
 });
});
