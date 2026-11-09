// @vitest-environment jsdom
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../src/sim/simulation.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
import {afterEach,describe,expect,it} from 'vitest';
import {createControls} from '../../src/input/controls.js';
import {createHud} from '../../src/ui/hud.js';
import {hero,place} from '../helpers.js';
import type {SimCommand} from '../../src/sim/types.js';

// CPU consumer reproduction with real navigation, simulation, input and HUD.
const cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.splice(0).forEach(dispose=>dispose());document.body.replaceChildren();});
async function fixture({trial=true,lethal=true}={}){
  const navigation=await createDetourNavigation(await readFile('src/sim/nav/lane.navmesh'));
  cleanup.push(()=>navigation.destroy());
  const sim=new Simulation({seed:1,contentVersion:12,navigation}),blue=hero(sim,0),red=hero(sim,1);
  place(blue,{x:0,z:0});place(red,{x:5,z:0});if(lethal)red.hp=1;
  const canvas=document.createElement('canvas'),root=document.createElement('div');canvas.tabIndex=0;document.body.append(canvas,root);
  const pending:SimCommand[]=[];
  const hud=createHud(root,sim.catalog,slot=>controls.skill(slot),()=>{},()=>{});
  const controls=createControls({canvas,setTargeting(){},aim:()=>({point:{x:5,z:0},entityId:red.id}),setPointer(){},leavePointer(){}},sim.catalog,
    ()=>({snapshot:sim.snapshot(),hero:sim.snapshot().heroes[0]!}),command=>{pending.push(command);return true},
    (text,only)=>hud.say(text,only),()=>{},undefined,undefined,trial);
  cleanup.push(()=>{controls.dispose();hud.dispose();});
  const batches:ReturnType<typeof sim.snapshot>['events'][]=[];
  function step(extra:SimCommand[]=[]){
    const issued=[...pending.splice(0),...extra];
    const results=sim.step(sim.commandFrame(issued));
    controls.sync(issued);hud.update(sim.snapshot(),blue.id);
    const rejected=results.find(result=>result.command.heroId===blue.id&&!result.accepted);
    if(rejected)hud.reject(rejected.reason!);
    batches.push(sim.snapshot().events);return results;
  }
  function until(tick:number){while(sim.state.tick<tick)step();}
  function key(key:string){canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));}
  function click(button=0){canvas.dispatchEvent(new MouseEvent('pointerdown',{button,bubbles:true}));}
  function cast(){key('q');click();}
  click(2);step();until(13);cast();step();
  return {sim,blue,red,hud,controls,batches,step,until,key,click,cast,message:()=>root.querySelector('[data-message]')!.textContent};
}

describe('buffer release revalidation feedback through real consumers',()=>{
  it('withdraws the attack receipt when its target really dies before release',async()=>{
    const f=await fixture();f.click(2);expect(f.step()[0]).toMatchObject({accepted:true,queued:true});
    expect(f.message()).toBe('Command queued.');f.step();expect(f.red.alive).toBe(false);
    expect(f.blue.queuedCommand).toMatchObject({type:'attack'});expect(f.message()).toBe('Command queued.');
    f.until(18);expect(f.blue.queuedCommand).toBeUndefined();expect(f.sim.state.diagnostics.rejectionReasons.targetDead).toBe(1);
    expect(f.message()).toBe('');const events=f.sim.snapshot().events;
    expect(events).toContainEqual(expect.objectContaining({type:'commandBufferDiscarded',reason:'rejected',command:{type:'attack',heroId:f.blue.id,targetId:f.red.id}}));
    expect(events.map(event=>event.ordinal)).toEqual(events.map((_,index)=>index));
    expect(events.findIndex(event=>event.type==='castResolved')).toBeLessThan(events.findIndex(event=>event.type==='commandBufferDiscarded'));
    f.until(80);expect(f.message()).toBe('');
    // Independently measured against unchanged 4751337 with this real input sequence.
    expect(f.sim.finalHash()).toBe('89f20b3eadb19a97');
    expect(f.batches.flat().filter(event=>event.type==='commandBufferDiscarded')).toHaveLength(1);
  });
  it('preserves a successfully released attack when the target survives',async()=>{
    const f=await fixture({lethal:false});f.click(2);expect(f.step()[0]).toMatchObject({accepted:true,queued:true});f.until(30);
    expect(f.red.alive).toBe(true);expect(f.blue.queuedCommand).toBeUndefined();expect(f.blue.targetId).toBe(f.red.id);
    expect(f.batches.flat().some(event=>event.type==='commandBufferDiscarded')).toBe(false);expect(f.message()).toBe('Command queued.');
  });
  it('does not invent a discard without buffered input',async()=>{
    const f=await fixture();f.until(30);expect(f.red.alive).toBe(false);
    expect(f.batches.flat().some(event=>event.type==='commandBufferDiscarded')).toBe(false);expect(f.message()).toBe('Command queued.');
  });
  it('preserves a newer cooldown rejection after failed buffered attack release',async()=>{
    const f=await fixture();f.click(2);f.step();f.cast();expect(f.step()[0]).toMatchObject({accepted:false,reason:'cooldown'});
    f.until(18);expect(f.message()).toBe('Command rejected: cooldown');
  });
  it('preserves a different receipt when the failed attack came from another producer',async()=>{
    const f=await fixture();f.step([{type:'attack',heroId:f.blue.id,targetId:f.red.id}]);f.until(18);
    expect(f.sim.state.diagnostics.rejectionReasons.targetDead).toBe(1);expect(f.message()).toBe('Command queued.');
  });
  it('lets a newer valid W replace the old attack without a false discard',async()=>{
    const f=await fixture();f.click(2);f.step();f.key('w');f.click();expect(f.step()[0]).toMatchObject({accepted:true,queued:true});f.until(18);
    expect(f.blue.cooldowns.W).toBeGreaterThan(0);expect(f.message()).toBe('Command queued.');
    expect(f.batches.flat().some(event=>event.type==='commandBufferDiscarded')).toBe(false);
  });
  it('withdraws a buffered attack only after Stop actually drops it',async()=>{
    const f=await fixture({lethal:false});f.click(2);f.step();f.key('s');
    expect(f.message()).toBe('Command queued.');expect(f.step()[0]).toMatchObject({accepted:true});
    expect(f.blue.queuedCommand).toBeUndefined();expect(f.message()).toBe('');
    expect(f.sim.snapshot().events).toContainEqual(expect.objectContaining({type:'commandBufferDiscarded',reason:'stop'}));
  });
  it('does not emit a discard for a rejected Stop or one without a buffer',async()=>{
    const f=await fixture();f.until(16);expect(f.step([{type:'stop',heroId:f.red.id}])[0]).toMatchObject({accepted:false,reason:'heroDead'});
    f.key('s');expect(f.step()[0]).toMatchObject({accepted:true});
    expect(f.batches.flat().some(event=>event.type==='commandBufferDiscarded')).toBe(false);
  });
  it('preserves the newer W receipt after Stop discards the older attack in one tick',async()=>{
    const f=await fixture({lethal:false});f.click(2);f.step();f.key('s');f.key('w');f.click();
    const results=f.step();expect(results[0]).toMatchObject({accepted:true});expect(results[1]).toMatchObject({accepted:true,queued:true});
    expect(f.message()).toBe('Command queued.');expect(f.blue.queuedCommand).toMatchObject({type:'cast',slot:'W'});
  });
  it('preserves the newer identical attack after Stop, even when it releases in that tick',async()=>{
    for(const stopTick of [16,18]){
      const f=await fixture({lethal:false});f.click(2);f.step();f.until(stopTick-1);f.key('s');f.click(2);f.step();
      expect(f.message()).toBe('Command queued.');
      expect(f.sim.snapshot().events).toContainEqual(expect.objectContaining({type:'commandBufferDiscarded',reason:'stop'}));
      f.until(19);expect(f.blue.queuedCommand).toBeUndefined();expect(f.blue.targetId).toBe(f.red.id);expect(f.message()).toBe('Command queued.');
    }
  });
  it('clears the latest identical receipt if a second Stop follows it in the same tick',async()=>{
    const f=await fixture({lethal:false});f.click(2);f.step();f.key('s');f.click(2);f.key('s');f.step();
    expect(f.message()).toBe('');expect(f.blue.queuedCommand).toBeUndefined();
    expect(f.sim.snapshot().events.filter(event=>event.type==='commandBufferDiscarded')).toHaveLength(2);
  });
  it('preserves a same-tick cooldown rejection when the older buffer fails revalidation',async()=>{
    const f=await fixture();f.click(2);f.step();f.until(17);f.cast();
    expect(f.step()[0]).toMatchObject({accepted:false,reason:'cooldown'});
    expect(f.sim.snapshot().events).toContainEqual(expect.objectContaining({type:'commandBufferDiscarded',reason:'rejected'}));
    expect(f.message()).toBe('Command rejected: cooldown');
  });
  it('does not let Stop ownership protection hide the new attack failing later',async()=>{
    const f=await fixture();f.click(2);f.step();f.key('s');f.click(2);f.step();
    expect(f.red.alive).toBe(false);expect(f.message()).toBe('Command queued.');
    f.until(18);expect(f.message()).toBe('');
    expect(f.sim.snapshot().events).toContainEqual(expect.objectContaining({type:'commandBufferDiscarded',reason:'rejected'}));
  });
  it('retains the non-trial consumer behavior',async()=>{
    const f=await fixture({trial:false});f.click(2);f.step();f.until(18);
    expect(f.sim.state.diagnostics.rejectionReasons.targetDead).toBe(1);expect(f.message()).toBe('Command queued.');
  });
});
