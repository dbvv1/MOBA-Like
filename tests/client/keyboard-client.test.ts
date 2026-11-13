// @vitest-environment jsdom
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {hashValue} from '../../src/sim/hash.js';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Snapshot} from '../../src/sim/types.js';
import {BINDINGS_STORAGE_KEY,DEFAULT_BINDINGS} from '../../src/input/bindings.js';

// Run the real client boot, UI, Controls and Simulation. Only rendering/audio/nav I/O and dialog
// platform methods are controlled; no browser, WebGL, layout or perceived responsiveness is claimed.
const state=vi.hoisted(()=>({inputTrace:[] as Array<{tick:number;commands:Array<{type:string;slot?:string}>;hash:string}>,releases:[] as Array<{slot:string;sample:string}>,sounds:[] as Array<{setForestEnabled?:ReturnType<typeof vi.fn>;policy:string;setPaused:ReturnType<typeof vi.fn>;dispose:ReturnType<typeof vi.fn>}>,worlds:[] as Array<{canvas:HTMLCanvasElement;targeting:string|null;disposed:boolean;locked:boolean;held:boolean}>}));
vi.mock('../../src/render/world.js',()=>({createWorld:vi.fn(async(stage:HTMLElement,_catalog:unknown,options:{cameraFollow?:string})=>{
  const canvas=document.createElement('canvas');canvas.tabIndex=0;stage.append(canvas);
  const world={canvas,targeting:null as string|null,disposed:false,locked:true,held:false};state.worlds.push(world);
  return {canvas,setTargeting:(slot:string|null)=>{world.targeting=slot;},setPointer:vi.fn(),leavePointer:vi.fn(),
    aim:()=>{const hero=client().snapshot().heroes[0]!;return {point:{x:hero.position.x+2,z:hero.position.z},entityId:null};},
    setFocusHeld:(held:boolean)=>{world.held=options.cameraFollow==='hold-follow-v1'&&held;},
    setLocked:(locked:boolean)=>{world.locked=locked;world.held=false;},sync:vi.fn(),draw:vi.fn(),dispose:()=>{world.disposed=true;canvas.remove();},
    lightingState:()=>({}),materialState:()=>({configured:'baseline',active:'baseline'}),cameraState:()=>({locked:world.locked,temporaryFollow:world.held}),effectState:()=>({}),targetingState:()=>world.targeting,motionState:()=>({})};
})}));
vi.mock('../../src/save/match.js',async importOriginal=>{const original=await importOriginal<typeof import('../../src/save/match.js')>();return {...original,LocalMatch:class extends original.LocalMatch{override step(commands:any[]=[]){const result=super.step(commands);state.inputTrace.push({tick:this.simulation.state.tick,commands:structuredClone(commands),hash:this.simulation.finalHash()});return result;}}};});
vi.mock('../../src/sim/navigation.js',()=>({createDetourNavigation:async()=>({destroy:vi.fn(),closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})})}));
vi.mock('../../src/audio/battle.js',async importOriginal=>{const original=await importOriginal<typeof import('../../src/audio/battle.js')>();return {...original,createBattleAudio:(enabled:boolean,policy:string)=>{const sound={enabled,policy,...(new URLSearchParams(location.search).get('scene')==='forest-verge-v1'?{setForestEnabled:vi.fn()}:{}),setPaused:vi.fn(),setEnabled:vi.fn(),unlock:vi.fn(),sync:vi.fn((snapshot:Snapshot,playerId:number)=>{for(const event of snapshot.events){if(event.type!=='castResolved'||event.heroId!==playerId||event.action==='basicAttack')continue;const cue=original.battleCue(event,snapshot,playerId);if(cue)state.releases.push({slot:event.slot,sample:original.sampleForCue(cue,policy as 'baseline'|'critical-v1')});}}),dispose:vi.fn()};state.sounds.push(sound);return sound;}};});
type Client={snapshot:()=>Snapshot;state:()=>{ready:boolean;tick:number;pointer:{command:{type:string}|null}|null}};
function client(){return (window as unknown as {mobaClient:Client}).mobaClient;}
const html=readFileSync('candidate.html','utf8');
let now=1000,id=0,frames=new Map<number,FrameRequestCallback>();
function advance(ms=40){now+=ms;const next=[...frames.values()];frames.clear();for(const frame of next)frame(now);}
function button(selector:string){return document.querySelector<HTMLButtonElement>(selector)!;}
function click(selector:string){const target=button(selector);target.focus();target.click();}
function key(key:string,extra:KeyboardEventInit={}){const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});document.activeElement!.dispatchEvent(event);return event;}
function canvasClick(button=0){const canvas=state.worlds.at(-1)!.canvas;canvas.dispatchEvent(new MouseEvent('pointerdown',{button,clientX:10,clientY:10,bubbles:true,cancelable:true}));}
function open(){click('#keyboard-settings');}
function capture(action:string,value:string){click(`[data-binding-action="${action}"]`);key(value);}
async function boot(){await import('../../src/client.js');await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));}
beforeEach(()=>{
  vi.stubGlobal('__MOBA_SAVE_COMPATIBILITY__','integration-test');vi.resetModules();now=1000;id=0;frames=new Map();state.worlds.length=0;state.sounds.length=0;state.releases.length=0;state.inputTrace.length=0;history.replaceState(null,'','/');localStorage.clear();Reflect.deleteProperty(window,'mobaClient');
  document.body.innerHTML=html.match(/<body>([\s\S]*?)<\/body>/)![1]!;
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;this.dispatchEvent(new Event('close'));}});
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)})));
  vi.stubGlobal('requestAnimationFrame',vi.fn((cb:FrameRequestCallback)=>{frames.set(++id,cb);return id;}));
  vi.stubGlobal('cancelAnimationFrame',vi.fn((key:number)=>frames.delete(key)));
});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});

const fullTrial='/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1';
async function bootTrial(){history.replaceState(null,'',fullTrial);await boot();}
it.each(['/', '/candidate.html?materials=quiet-family-v1&lighting=forest-light-v1', fullTrial, fullTrial+'&materials=quiet-family-v1'])('HUD skill activation returns focus to gameplay so Escape cancels at %s',async(path)=>{
 history.replaceState(null,'',path);await boot();
 const world=state.worlds[0]!;const message=()=>document.querySelector('[data-message]')!.textContent;
 for(const selector of ['[data-skills] button:nth-child(1)','[data-skills] button:nth-child(2)']){
   click(selector);expect(world.targeting).not.toBeNull();expect(message()).toContain('Esc cancels');
   expect(document.activeElement).toBe(world.canvas);
   key('Escape');expect(world.targeting).toBeNull();expect(message()).toBe('Aim cancelled.');
   canvasClick();advance();expect(state.releases).toHaveLength(0);
   expect(state.inputTrace.flatMap(frame=>frame.commands).filter(command=>command.type==='cast')).toEqual([]);
 }
 // UI navigation still owns keys until a skill is actually activated.
 button('[data-skills] button').focus();key('q');expect(world.targeting).toBeNull();
 open();key('Escape');expect(document.querySelector('dialog')!.open).toBe(false);
 expect(document.activeElement).toBe(button('#keyboard-settings'));
});

it('HUD self skill returns focus without entering aim or issuing a second cast',async()=>{
 await bootTrial();document.querySelector<HTMLSelectElement>('#hero-select')!.value='morrow';
 click('#restart');await vi.waitFor(()=>expect(state.worlds).toHaveLength(2));
 const world=state.worlds[1]!;click('[data-skills] button:nth-child(2)');
 expect(document.activeElement).toBe(world.canvas);expect(world.targeting).toBeNull();advance();
 const casts=()=>state.inputTrace.flatMap(frame=>frame.commands).filter(command=>command.type==='cast');
 expect(casts()).toHaveLength(1);expect(casts()[0]).toMatchObject({slot:'W'});
 key('Escape');canvasClick();advance();expect(casts()).toHaveLength(1);
});

describe('keyboard settings in the actual client lifecycle',()=>{
  it('blocks and clears queued gameplay while editing, then sends the saved key through the real cast and refreshes every key hint',async()=>{
    await boot();const world=state.worlds[0]!;world.canvas.focus();key('q');expect(world.targeting).toBe('Q');canvasClick();
    open();expect(world.targeting).toBeNull();const before=client().snapshot();
    capture('Q','f');key('s');canvasClick(2);click('[data-skills] button');click('[data-shop] button');advance(5000);
    expect(client().snapshot()).toEqual(before);expect(world.targeting).toBeNull();
    click('[data-binding-save]');expect(button('[data-skills] button').textContent).toMatch(/^F /);expect(document.querySelector('#controls-help')!.textContent).toContain('F/W/E/R');expect(document.querySelector('select')!.title).toContain('F:');
    advance();expect(client().snapshot().tick-before.tick).toBeLessThanOrEqual(2);expect(client().snapshot().heroes[0]!.mana).toBe(before.heroes[0]!.mana);
    world.canvas.focus();key('q');canvasClick();advance();expect(client().snapshot().heroes[0]!.mana).toBe(before.heroes[0]!.mana);
    key('f');expect(world.targeting).toBe('Q');canvasClick();advance();expect(client().snapshot().heroes[0]!.mana).toBeLessThan(before.heroes[0]!.mana);
  });
  it('remaps movement/stop/camera without changing right-click movement and restores default input on save',async()=>{
    await boot();open();capture('attackMove','d');capture('stop','x');capture('focusCamera','c');click('[data-binding-save]');
    const world=state.worlds[0]!;world.canvas.focus();key('d');canvasClick();advance();expect(client().state().pointer?.command?.type).toBe('attackMove');expect(client().snapshot().heroes[0]!.moveGoal).not.toBeNull();
    key('x');advance();expect(client().snapshot().heroes[0]!.moveGoal).toBeNull();
    world.locked=false;key(' ');expect(world.locked).toBe(false);key('c');expect(world.locked).toBe(true);
    canvasClick(2);advance();expect(client().snapshot().heroes[0]!.moveGoal).not.toBeNull();
    open();click('[data-binding-defaults]');click('[data-binding-save]');expect(localStorage.getItem(BINDINGS_STORAGE_KEY)).toBeNull();
    world.canvas.focus();key('x');advance();expect(client().snapshot().heroes[0]!.moveGoal).not.toBeNull();key('s');advance();expect(client().snapshot().heroes[0]!.moveGoal).toBeNull();
  });
  it('keeps old controls/HUD on save failure and leaves the editor ready for retry or cancel',async()=>{
    await boot();const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    open();capture('Q','f');click('[data-binding-save]');expect(document.querySelector('dialog')!.open).toBe(true);expect(button('[data-skills] button').textContent).toMatch(/^Q /);expect(document.querySelector('#controls-help')!.textContent).toContain('Q/W/E/R');
    click('[data-binding-cancel]');const world=state.worlds[0]!;world.canvas.focus();key('f');expect(world.targeting).toBeNull();key('q');expect(world.targeting).toBe('Q');
    set.mockRestore();open();capture('Q','f');click('[data-binding-save]');expect(button('[data-skills] button').textContent).toMatch(/^F /);
  });
  it('retains saved bindings through restart and selected hero changes, but cancels unsaved drafts and old listeners',async()=>{
    await boot();open();capture('Q','f');click('[data-binding-save]');
    const select=document.querySelector<HTMLSelectElement>('#hero-select')!;select.value='morrow';select.dispatchEvent(new Event('change'));
    const old=state.worlds[0]!;open();capture('Q','g');click('#restart');await vi.waitFor(()=>expect(state.worlds).toHaveLength(2));await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));
    expect(old.disposed).toBe(true);expect(client().snapshot().heroes[0]!.definitionId).toBe('morrow');expect(client().snapshot().tick).toBe(0);expect(document.querySelector('dialog')!.open).toBe(false);expect(button('[data-skills] button').textContent).toMatch(/^F /);
    const world=state.worlds[1]!;world.canvas.focus();key('g');expect(world.targeting).toBeNull();key('f');expect(world.targeting).toBe('Q');canvasClick();advance();expect(client().snapshot().heroes[0]!.cooldowns.Q).toBeGreaterThan(0);
    const before=client().snapshot();old.canvas.dispatchEvent(new MouseEvent('pointerdown',{button:2}));advance();expect(client().snapshot().heroes[0]!.moveGoal).toEqual(before.heroes[0]!.moveGoal);
    open();expect(document.querySelector('[data-binding-rows]')!.textContent).toContain('Barkguard');expect(button('[data-binding-action="Q"]').textContent).toBe('F');
  });
  it('cancels and refreshes key capture on visibility loss even when no blur event arrives',async()=>{
    await boot();open();capture('W','g');click('[data-binding-action="Q"]');expect(button('[data-binding-action="Q"]').textContent).toBe('Press a key…');
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    expect(button('[data-binding-action="Q"]').textContent).toBe('Q');expect(button('[data-binding-action="Q"]').getAttribute('aria-pressed')).toBe('false');expect(button('[data-binding-action="W"]').textContent).toBe('G');
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));key('f');expect(button('[data-binding-action="Q"]').textContent).toBe('Q');
    capture('Q','f');click('[data-binding-save]');expect(button('[data-skills] button').textContent).toMatch(/^F /);
  });
  it('loads persisted keys on page boot and keeps settings unavailable during a failed load until a clean retry',async()=>{
    localStorage.setItem(BINDINGS_STORAGE_KEY,JSON.stringify({version:1,bindings:{...DEFAULT_BINDINGS,Q:'F'}}));
    vi.mocked(fetch).mockRejectedValueOnce(new Error('load interrupted'));
    await import('../../src/client.js');await vi.waitFor(()=>expect(document.querySelector('#notice')!.textContent).toBe('load interrupted'));
    expect(button('#keyboard-settings').disabled).toBe(true);expect(state.worlds).toHaveLength(0);
    click('#restart');await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));
    expect(button('#keyboard-settings').disabled).toBe(false);expect(button('[data-skills] button').textContent).toMatch(/^F /);
    state.worlds[0]!.canvas.focus();key('q');expect(state.worlds[0]!.targeting).toBeNull();key('f');expect(state.worlds[0]!.targeting).toBe('Q');
  });
  it('does not interpret text input as gameplay, and visibility/blur discard queued actions without reviving old aim',async()=>{
    await boot();const world=state.worlds[0]!;const input=document.createElement('input');document.body.append(input);input.focus();key('q');key('s');expect(world.targeting).toBeNull();
    for(const selector of ['#keyboard-settings','footer summary','[data-skills] button']){const target=document.querySelector<HTMLElement>(selector)!;target.focus();expect(key(' ').defaultPrevented).toBe(false);key('q');expect(world.targeting).toBeNull();}
    const editable=document.createElement('div');editable.tabIndex=0;Object.defineProperty(editable,'isContentEditable',{value:true});document.body.append(editable);editable.focus();key('q');expect(world.targeting).toBeNull();
    world.canvas.focus();key('q');canvasClick();const mana=client().snapshot().heroes[0]!.mana;window.dispatchEvent(new Event('blur'));advance();expect(client().snapshot().heroes[0]!.mana).toBe(mana);
    key('q');expect(world.targeting).toBe('Q');Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));expect(world.targeting).toBeNull();
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));canvasClick();advance();expect(client().snapshot().heroes[0]!.mana).toBe(mana);
  });
});

it('opt-in audio pause wiring clears plans on settings/hidden and creates a fresh owner on restart',async()=>{
 history.replaceState(null,'','/?audio=critical-v1&commands=buffer-v1');await boot();const first=state.sounds[0]!;expect(first.policy).toBe('critical-v1');
 open();expect(first.setPaused).toHaveBeenLastCalledWith(true);click('[data-binding-cancel]');expect(first.setPaused).toHaveBeenLastCalledWith(false);
 Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));expect(first.setPaused).toHaveBeenLastCalledWith(true);
 open();click('[data-binding-cancel]');expect(first.setPaused).toHaveBeenLastCalledWith(true);
 Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));expect(first.setPaused).toHaveBeenLastCalledWith(false);
 click('#restart');await vi.waitFor(()=>expect(state.sounds).toHaveLength(2));expect(first.dispose).toHaveBeenCalledTimes(1);expect(state.sounds[1]!.policy).toBe('critical-v1');
});
it('default audio policy preserves the old client pause contract',async()=>{await boot();expect(state.sounds[0]!.policy).toBe('baseline');open();click('[data-binding-cancel]');expect(state.sounds[0]!.setPaused).not.toHaveBeenCalled();});

function keyUp(value:string,extra:KeyboardEventInit={}){document.activeElement!.dispatchEvent(new KeyboardEvent('keyup',{key:value,bubbles:true,...extra}));}
function permanentLock(value:boolean){const input=document.querySelector<HTMLInputElement>('[data-lock]')!;input.checked=value;input.dispatchEvent(new Event('change'));}
it('hold-follow uses the live binding without changing persistent lock; keyup and HUD ownership release it',async()=>{
 history.replaceState(null,'','/candidate.html?camera=hold-follow-v1');await boot();const world=state.worlds[0]!;
 permanentLock(false);world.canvas.focus();key(' ',{code:'Space'});expect(world.held).toBe(true);expect(world.locked).toBe(false);
 keyUp('x',{code:'KeyX'});expect(world.held).toBe(true);
 const detachedFocusInput=document.createElement('input');document.body.append(detachedFocusInput);detachedFocusInput.dispatchEvent(new KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true}));expect(world.held).toBe(false);key(' ',{code:'Space'});expect(world.held).toBe(true);
 // Keyup is matched by physical key even when modifiers change logical case.
 keyUp(' ',{code:'Space',ctrlKey:true});expect(world.held).toBe(false);expect(world.locked).toBe(false);
 key(' ',{code:'Space'});permanentLock(true);expect(world.held).toBe(false);key(' ',{code:'Space',repeat:true});expect(world.held).toBe(false);
 keyUp(' ',{code:'Space'});expect(world.locked).toBe(true);
 permanentLock(false);key(' ',{code:'Space'});expect(world.held).toBe(true);
 const input=document.createElement('input');document.body.append(input);input.focus();expect(world.held).toBe(false);
 keyUp(' ',{code:'Space'});expect(world.held).toBe(false);key(' ');expect(world.held).toBe(false);
 expect(document.querySelector('#controls-help')!.textContent).toContain('hold to follow');
});
it('pause, blur, visibility, rebinding and restart discard temporary ownership in the real client',async()=>{
 history.replaceState(null,'','/candidate.html?camera=hold-follow-v1');await boot();const world=state.worlds[0]!;permanentLock(false);world.canvas.focus();key(' ');expect(world.held).toBe(true);
 window.dispatchEvent(new Event('blur'));expect(world.held).toBe(false);key(' ',{repeat:true});expect(world.held).toBe(false);keyUp(' ');
 key(' ');Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));expect(world.held).toBe(false);
 Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));key(' ',{repeat:true});expect(world.held).toBe(false);keyUp(' ');
 key(' ');open();expect(world.held).toBe(false);capture('focusCamera','c');click('[data-binding-save]');world.canvas.focus();key(' ');expect(world.held).toBe(false);key('c',{code:'KeyC'});expect(world.held).toBe(true);keyUp('C',{code:'KeyC',shiftKey:true});expect(world.held).toBe(false);
 key('c',{code:'KeyC'});click('#restart');await vi.waitFor(()=>expect(state.worlds).toHaveLength(2));await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));expect(world.held).toBe(false);expect(world.disposed).toBe(true);const next=state.worlds[1]!;expect(next.held).toBe(false);permanentLock(false);next.canvas.focus();key('c',{code:'KeyC',repeat:true});expect(next.held).toBe(false);keyUp('c',{code:'KeyC'});key('c',{code:'KeyC'});expect(next.held).toBe(true);expect(next.locked).toBe(false);
});

let matrixFingerprint:string|undefined;
const matrixTraces:unknown[]=[];
// Cross-feature acceptance at the real client boundary; device/render output remains doubled.
it.each([[false,false],[true,false],[false,true],[true,true]])('integrated v12 camera=%s audio=%s preserves move/cast after focus release',async(camera,audio)=>{
 history.replaceState(null,'','/candidate.html?commands=buffer-v1'+(camera?'&camera=hold-follow-v1':'')+(audio?'&audio=critical-v1':''));
 await boot();const world=state.worlds[0]!;permanentLock(false);world.canvas.focus();
 key(' ',{code:'Space'});expect(world.held).toBe(camera);expect(world.locked).toBe(!camera);
 keyUp(' ',{code:'Space'});expect(world.held).toBe(false);expect(world.locked).toBe(!camera);
 canvasClick(2);advance();expect(client().snapshot().heroes[0]!.moveGoal).not.toBeNull();
 key('q');canvasClick();advance();expect(client().snapshot().heroes[0]!.castSlot).toBe('Q');
 key('w');canvasClick();advance();expect(client().snapshot().heroes[0]!.castSlot).toBe('Q');
 for(let i=0;i<12;i++)advance();
 expect(state.releases.filter(e=>e.slot==='Q'||e.slot==='W')).toEqual([{slot:'Q',sample:audio?'skill-q':'cast'},{slot:'W',sample:audio?'skill-w':'cast'}]);
 const fingerprint=hashValue(state.inputTrace);matrixFingerprint??=fingerprint;expect(fingerprint).toBe(matrixFingerprint);matrixTraces.push({camera,audio,fingerprint,trace:structuredClone(state.inputTrace)});mkdirSync('outputs/side-release',{recursive:true});writeFileSync('outputs/side-release/client-input-fingerprints.json',JSON.stringify({scope:'real client Controls and LocalMatch input frames/state hashes; renderer/audio/nav doubled',matrix:matrixTraces},null,2)+'\n');
 expect(world.held).toBe(false);expect(world.locked).toBe(!camera);
 open();expect(world.held).toBe(false);click('[data-binding-cancel]');
 click('#restart');await vi.waitFor(()=>expect(state.worlds).toHaveLength(2));await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));expect(world.disposed).toBe(true);expect(state.worlds[1]!.held).toBe(false);
});


it('read-only DOM diagnostics mirror the live minimum gate and restart resets it',async()=>{
 await boot();const read=()=>JSON.parse(document.querySelector('#debug-state')!.textContent!);
 expect(read()).toMatchObject({ready:true,backend:'three-webgl2',acceptance:{requiredTicks:300,advancedTicks:0,reached:false}});
 for(let i=0;i<260;i++)advance();
 expect(read().acceptance.advancedTicks).toBe(client().snapshot().tick);expect(read().acceptance.reached).toBe(true);expect(read().ready).toBe(true);
 click('#restart');await vi.waitFor(()=>expect(state.worlds).toHaveLength(2));await vi.waitFor(()=>expect(client()?.state().ready).toBe(true));
 expect(read()).toMatchObject({ready:true,acceptance:{advancedTicks:0,reached:false}});
});

it('forest scene alone opts into environment and pause lifecycle, but renderer fallback does not',async()=>{
 history.replaceState(null,'','/?scene=forest-verge-v1');await boot();const sound=state.sounds[0]!;
 expect(sound.setForestEnabled).toHaveBeenCalledExactlyOnceWith(true);expect(sound.setPaused).toHaveBeenLastCalledWith(false);
 open();expect(sound.setPaused).toHaveBeenLastCalledWith(true);click('[data-binding-cancel]');expect(sound.setPaused).toHaveBeenLastCalledWith(false);
 const {createWorld}=await import('../../src/render/world.js');vi.mocked(createWorld).mockRejectedValueOnce(new Error('scene rejected'));
 click('#restart');await vi.waitFor(()=>expect(state.sounds).toHaveLength(2));await vi.waitFor(()=>expect(client().state().ready).toBe(true));
 expect(state.sounds[1]!.setForestEnabled).not.toHaveBeenCalled();expect(sound.dispose).toHaveBeenCalledOnce();
});
