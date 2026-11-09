// @vitest-environment jsdom
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../src/sim/simulation.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
import {afterEach,describe,expect,it} from 'vitest';
import {createControls} from '../../src/input/controls.js';
import {battleCue} from '../../src/audio/battle.js';
import {createHud} from '../../src/ui/hud.js';
import {hero,place} from '../helpers.js';
import type {SimCommand} from '../../src/sim/types.js';

// Real baked navigation, Simulation, Controls and HUD. DOM dispatch is CPU evidence,
// not a browser, screen/layout, audio or player-feel acceptance.
const disposers:Array<()=>void>=[];
afterEach(()=>{for(const dispose of disposers.splice(0))dispose();document.body.replaceChildren();});
async function fixture(trial=true,rPoint=0){
  const navigation=await createDetourNavigation(await readFile('src/sim/nav/lane.navmesh'));
  disposers.push(()=>navigation.destroy());
  const sim=new Simulation({seed:1,contentVersion:12,navigation}),blue=hero(sim,0),red=hero(sim,1);
  place(blue,{x:0,z:0});place(red,{x:5,z:0});
  const root=document.createElement('div'),canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(root,canvas);
  const pending:SimCommand[]=[];
  const hud=createHud(root,sim.catalog,slot=>controls.skill(slot),()=>{},()=>{});
  const controls=createControls({canvas,setTargeting(){},aim:()=>({point:{x:2,z:0},entityId:null}),setPointer(){},leavePointer(){}},sim.catalog,
    ()=>({snapshot:sim.snapshot(),hero:sim.snapshot().heroes[0]!}),command=>{pending.push(command);return true},
    (text,only)=>hud.say(text,only),()=>{},undefined,undefined,trial);
  disposers.push(()=>{controls.dispose();hud.dispose();});
  const batches:ReturnType<typeof sim.snapshot>['events'][]=[];
  function step(extra:SimCommand[]=[]){
    const results=sim.step(sim.commandFrame([...pending.splice(0),...extra]));
    controls.sync();hud.update(sim.snapshot(),blue.id);
    const rejection=results.find(result=>result.command.heroId===blue.id&&!result.accepted);
    if(rejection)hud.reject(rejection.reason!);
    batches.push(sim.snapshot().events);return results;
  }
  function until(tick:number){while(sim.state.tick<tick)step();}
  function cast(key:string){canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));canvas.dispatchEvent(new MouseEvent('pointerdown',{button:0,bubbles:true}));}
  step([{type:'cast',heroId:red.id,slot:'R',targetId:null,direction:null,point:{x:rPoint,z:0}}]);
  return {sim,blue,red,controls,hud,batches,step,until,cast,message:()=>root.querySelector('[data-message]')!.textContent};
}

describe('actual stunned buffer discard withdraws only its own receipt',()=>{
  it('withdraws W only when real R cancels the buffer, and stays clear after recovery',async()=>{
    const f=await fixture();f.until(25);f.cast('q');f.step();f.cast('w');
    expect(f.step()[0]).toMatchObject({accepted:true,queued:true});
    expect(f.blue.queuedCommand).toMatchObject({type:'cast',slot:'W'});expect(f.message()).toBe('Command queued.');
    f.step();expect(f.sim.snapshot().heroes[0]!.stunned).toBe(true);expect(f.blue.queuedCommand).toBeUndefined();expect(f.message()).toBe('');
    const events=f.sim.snapshot().events;expect(events.filter(event=>event.type==='commandBufferDiscarded')).toEqual([
      expect.objectContaining({reason:'stunned',command:expect.objectContaining({heroId:f.blue.id,type:'cast',slot:'W'})}),
    ]);
    expect(battleCue(events.find(event=>event.type==='commandBufferDiscarded')!,f.sim.snapshot(),f.blue.id)).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({type:'castCancelled',slot:'Q',reason:'stunned'}));
    f.until(80);expect(f.sim.snapshot().heroes[0]!.stunned).toBe(false);expect(f.message()).toBe('');expect(f.blue.cooldowns.W).toBe(0);
    // Independently measured on unchanged 935e8a24 with this exact input/fixture.
    expect(f.sim.finalHash()).toBe('5278d90046e0b73e');
    expect(f.batches.flat().filter(event=>event.type==='commandBufferDiscarded')).toHaveLength(1);
    expect(f.batches.flat().some(event=>event.type==='castResolved'&&event.heroId===f.blue.id&&event.slot==='W')).toBe(false);
  });
  it('preserves a W released on the same tick before R stuns its landing position',async()=>{
    const f=await fixture(true,7);f.until(23);f.cast('q');f.step();f.cast('w');
    expect(f.step()[0]).toMatchObject({accepted:true,queued:true});f.until(27);
    expect(f.blue.queuedCommand).toMatchObject({slot:'W'});expect(f.message()).toBe('Command queued.');
    f.step();const snapshot=f.sim.snapshot();expect(snapshot.heroes[0]!.stunned).toBe(true);expect(f.blue.queuedCommand).toBeUndefined();
    expect(snapshot.events).toContainEqual(expect.objectContaining({type:'castResolved',heroId:f.blue.id,slot:'W'}));
    expect(snapshot.events.some(event=>event.type==='commandBufferDiscarded')).toBe(false);expect(f.message()).toBe('Command queued.');
  });
  it('preserves the newer real cooldown rejection when the older W is discarded',async()=>{
    const f=await fixture();f.until(25);f.cast('q');f.step();f.cast('w');f.cast('q');
    const results=f.step();expect(results[0]).toMatchObject({accepted:true,queued:true});expect(results[1]).toMatchObject({accepted:false,reason:'cooldown'});
    expect(f.message()).toBe('Command rejected: cooldown');f.step();expect(f.blue.queuedCommand).toBeUndefined();expect(f.message()).toBe('Command rejected: cooldown');
  });
  it('does not fabricate a discard without a buffer, or retract an earlier movement receipt',async()=>{
    const f=await fixture();const canvas=document.querySelector('canvas')!;canvas.dispatchEvent(new MouseEvent('pointerdown',{button:2,bubbles:true}));f.step();
    f.until(28);expect(f.sim.snapshot().heroes[0]!.stunned).toBe(true);expect(f.message()).toBe('Command queued.');
    expect(f.batches.flat().some(event=>event.type==='commandBufferDiscarded')).toBe(false);
  });
  it('does not clear a different submitted receipt when another command is discarded',async()=>{
    const f=await fixture();f.until(25);f.cast('q');f.step();
    f.step([{type:'cast',heroId:f.blue.id,slot:'W',targetId:null,point:null,direction:{x:1,z:0}}]);
    f.step();expect(f.blue.queuedCommand).toBeUndefined();
    expect(f.sim.snapshot().events.some(event=>event.type==='commandBufferDiscarded')).toBe(true);
    // The Controls receipt belongs to Q, not to the independently supplied W.
    expect(f.message()).toBe('Command queued.');
  });
  it('keeps the non-combat-trial consumer unchanged',async()=>{
    const f=await fixture(false);f.until(25);f.cast('q');f.step();f.cast('w');f.step();f.step();
    expect(f.blue.queuedCommand).toBeUndefined();expect(f.sim.snapshot().heroes[0]!.stunned).toBe(true);expect(f.message()).toBe('Command queued.');
  });
  it('copies nested discarded commands on snapshot reads without changing the state hash',async()=>{
    const f=await fixture();f.until(25);f.cast('q');f.step();f.cast('w');f.step();f.step();
    const hash=f.sim.finalHash(),before=f.sim.snapshot().events;
    const event=f.sim.snapshot().events.find(event=>event.type==='commandBufferDiscarded')!;
    if(event.type!=='commandBufferDiscarded'||event.command.type!=='cast')throw new Error('Missing discarded cast');
    event.command.direction!.x=999;
    expect(f.sim.snapshot().events).toEqual(before);expect(f.sim.finalHash()).toBe(hash);
  });
});
