// @vitest-environment jsdom
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {LocalMatch} from '../../src/save/match.js';
import {FixedClock} from '../../src/render/clock.js';
import {createLifetime} from '../../src/render/lifetime.js';
import {cameraFollowPolicy} from '../../src/render/camera-follow.js';
import {entryLightingSearch} from '../../src/ui/entry-lighting.js';
import {isCombatTrial} from '../../src/combat-trial.js';
import {audioPolicyFromSearch} from '../../src/audio/battle.js';
import {createHud} from '../../src/ui/hud.js';
import {createGoldReceipt} from '../../src/ui/gold-receipt.js';
import type {SimCommand} from '../../src/sim/types.js';
import {place} from '../helpers.js';

// Executes the actual client frame owner with the real Simulation/LocalMatch, HUD and DOM.
// Rendering, audio, save ownership and input are stubs: CPU/DOM evidence, not browser or GPU.
const navigation={closestPoint:(point:{x:number;z:number})=>({...point}),findPath:(from:{x:number;z:number},to:{x:number;z:number})=>({success:true,points:[from,to],reason:null}),destroy(){}};

const fullTrial='/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1';
async function host(route=fullTrial){
  history.replaceState(null,'',route);
  document.body.innerHTML=['stage','notice','hud','restart','hero-select','hero-choice-details','sound-toggle','controls-help','keyboard-settings','keyboard-dialog','debug-state'].map(id=>`<div id="${id}"></div>`).join('');
  let hidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  let now=0;
  const frames=new Map<number,(time:number)=>void>();
  let nextFrame=0;
  let match:LocalMatch|undefined;
  let enqueue:((command:SimCommand)=>void)|undefined;
  class CapturedMatch extends LocalMatch{
    constructor(...args:ConstructorParameters<typeof LocalMatch>){super(...args);match=this;}
  }
  const world={setLocked(){},lightingState:()=>({}),leavePointer(){},cameraState:()=>({locked:true}),sync(){},draw(){},effectState:()=>({}),targetingState:()=>({}),motionState:()=>({}),dispose(){}};
  const sound={enabled:true,setEnabled(value:boolean){sound.enabled=value;},dispose(){},unlock:async()=>{},sync(){},setPaused(){}};
  const panel={button:document.createElement('button'),say(){},dispose(){}};
  const bindings={
    isCombatTrial,cameraFollowPolicy,entryLightingSearch,audioPolicyFromSearch,getContent,
    LocalMatch:CapturedMatch,restoreMatch:async()=>{throw new Error('No saved match in this test');},
    createSaveSlot:()=>({read:()=>({status:'empty'}),write:()=>({status:'unavailable'}),clear:()=>({status:'unavailable'})}),
    acquireSaveOwnership:async()=>null,chooseSavedMatch:async()=> 'new',createSavePanel:()=>panel,SAVE_COMPATIBILITY_ID:'test-rules',
    createDetourNavigation:async()=>navigation,
    createPlayableWorld:async()=>({world,backend:'three-webgl2',fallbackReason:'',cameraPolicy:'baseline'}),
    MINIMUM_ACCEPTANCE_TICKS:300,FixedClock,createLifetime,
    createControls:(_world:unknown,_catalog:unknown,_player:unknown,enqueueCommand:(command:SimCommand)=>void)=>{enqueue=enqueueCommand;return {sync(){},setEnabled(){},skill(){},dispose(){},inspectPointer(){}};},
    createHud,createGoldReceipt,KeyboardBindings:class{label(value:string){return value;}},controlsHelp:()=>'',createKeyboardSettings:()=>({dispose(){}}),
    createHeroSelection:()=>({read:()=>[['veyra'],['veyra']] as [string[],string[]],setBusy(){},refresh(){}}),
    createBattleAudio:()=>sound,window,document,location,performance:{now:()=>now},
    requestAnimationFrame:(callback:(time:number)=>void)=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame:(id:number)=>{frames.delete(id);},
    fetch:async()=>({ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(1)}),
    SOURCE_URL:'http://localhost/src/client.ts',
  };
  // The jsdom/vite environment does not expose a file: import.meta.url; npm sets cwd to the package root.
  const source=await readFile('src/client.ts','utf8');
  const executable=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url','SOURCE_URL'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  new Function(...Object.keys(bindings),executable)(...Object.values(bindings));
  const runFrame=(deltaMs:number)=>{
    now+=deltaMs;
    const entry=[...frames.entries()].at(-1);if(!entry)throw new Error('No animation frame scheduled');
    frames.delete(entry[0]);entry[1](now);
  };
  await vi.waitFor(()=>{if(!window.mobaClient)throw new Error(`boot failed: ${document.getElementById('notice')?.textContent} / ${document.getElementById('debug-state')?.textContent}`);expect(frames.size).toBe(1);});
  const setHidden=(value:boolean)=>{hidden=value;};
  return {match:()=>{if(!match)throw new Error('No match');return match;},enqueue:()=>{if(!enqueue)throw new Error('No control enqueue');return enqueue;},runFrame,setHidden,restart:()=>document.getElementById('restart')!.dispatchEvent(new Event('click')),q:(selector:string)=>document.querySelector<HTMLElement>(selector)!};
}

/** Kill the enemy hero with the player's real attack; the commit lands at tick 8. */
function armKill(app:Awaited<ReturnType<typeof host>>){
  const sim=app.match().simulation,player=sim.getHero(0,0)!,enemy=sim.getHero(1,0)!;
  place(player,{x:0,z:0});place(enemy,{x:1,z:0});enemy.hp=1;
  // Keep the real bot in place so the windup cannot be outrun; the kill and award remain authoritative.
  enemy.stats={...enemy.stats,moveSpeed:0,manaRegen:0};enemy.mana=0;
  app.enqueue()({type:'attack',heroId:player.id,targetId:enemy.id});
  return {sim,player,enemy};
}

afterEach(()=>{window.dispatchEvent(new Event('pagehide'));document.body.replaceChildren();history.replaceState(null,'','/');});

describe('client gold receipt follows real steps, not one rendered frame',()=>{
  it('keeps a tick-8 award readable when the frame ends on a no-award batch',async()=>{
    const app=await host(),{sim,enemy}=armKill(app);
    app.runFrame(250);app.runFrame(250);
    const snapshot=sim.snapshot();
    expect(enemy.alive).toBe(false);
    expect(snapshot.tick).toBeGreaterThan(7);
    // The final batch of this frame has no gold: the line can only come from per-step consumption.
    expect(snapshot.events.some(event=>event.type==='goldAwarded')).toBe(false);
    expect(app.q('[data-gold-receipt]').textContent).toBe('+300 gold · 击杀');
    // Separate element, next to the total, and not the command-rejection live region.
    expect(app.q('[data-gold]').textContent).toContain('◆');
    expect(app.q('[data-gold-receipt]')).not.toBe(app.q('[data-gold]'));
    expect(app.q('[data-gold-receipt]').closest('[role="status"]')).toBeNull();
    expect(app.q('[data-gold-receipt]').hasAttribute('aria-live')).toBe(false);
    expect(app.q('[data-message]').textContent).toBe('');
  });

  it('freezes the lifetime while the tab is hidden and expires only with simulation time',async()=>{
    const app=await host();armKill(app);
    app.runFrame(250);app.runFrame(250);
    expect(app.q('[data-gold-receipt]').textContent).toBe('+300 gold · 击杀');
    const tickBefore=app.match().simulation.snapshot().tick;
    app.setHidden(true);app.runFrame(5000);
    expect(app.match().simulation.snapshot().tick).toBe(tickBefore);
    expect(app.q('[data-gold-receipt]').textContent).toBe('+300 gold · 击杀');
    app.setHidden(false);app.runFrame(250);
    expect(app.q('[data-gold-receipt]').textContent).toBe('+300 gold · 击杀');
    for(let frame=0;frame<10;frame++)app.runFrame(250);
    expect(app.q('[data-gold-receipt]').textContent).toBe('');
  });

  it('clears the shown award when a new match replaces the simulation',async()=>{
    const app=await host(),{sim:oldSim}=armKill(app);
    app.runFrame(250);app.runFrame(250);
    expect(app.q('[data-gold-receipt]').textContent).toBe('+300 gold · 击杀');
    app.restart();
    await vi.waitFor(()=>{expect(app.match().simulation).not.toBe(oldSim);expect(window.mobaClient).toBeDefined();});
    expect(app.q('[data-gold-receipt]').textContent).toBe('');
    app.runFrame(250);
    expect(app.q('[data-gold-receipt]').textContent).toBe('');
  });
});


it.each([
 '/',
 '/?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1',
 '/candidate.html',
 '/candidate.html?commands=buffer-v1',
 fullTrial+'&materials=quiet-family-v1',
 fullTrial+'&commands=buffer-v1',
 fullTrial+'&camera=baseline',
])('closed trial preserves the original gold HUD at %s',async route=>{
  const app=await host(route),{sim,player,enemy}=armKill(app);
  app.runFrame(250);app.runFrame(250);
  expect(enemy.alive).toBe(false);expect(player.gold).toBeGreaterThanOrEqual(300);
  expect(app.q('[data-gold]').textContent).toContain('gold');
  expect(document.querySelector('[data-gold-receipt]')).toBeNull();
  expect(sim.snapshot().tick).toBeGreaterThan(7);
});
