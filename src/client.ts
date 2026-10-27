import {createBattleAudio} from './audio/battle.js';
import {getContent} from './content/catalog.js';
import {createHeroSelection} from './ui/hero-selection.js';
import {Simulation} from './sim/simulation.js';
import {HeroBot} from './sim/ai.js';
import {createDetourNavigation} from './sim/navigation.js';
import type {SimCommand} from './sim/types.js';
import {createWorld} from './render/world.js';
import {FixedClock} from './render/clock.js';
import {createLifetime} from './render/lifetime.js';
import {createControls} from './input/controls.js';
import {createHud} from './ui/hud.js';
import {KeyboardBindings} from './input/bindings.js';
import {controlsHelp,createKeyboardSettings} from './ui/keyboard-settings.js';

function element<T extends HTMLElement>(id:string):T {const result=document.getElementById(id);if(!result)throw new Error(`Missing ${id}`);return result as T;}
const stage=element<HTMLElement>('stage'),notice=element<HTMLElement>('notice'),hudRoot=element<HTMLElement>('hud'),restart=element<HTMLButtonElement>('restart');
const contentVersion=10 as const;
const bindings=new KeyboardBindings(()=>window.localStorage);
const heroSelection=createHeroSelection(element<HTMLSelectElement>('hero-select'),element<HTMLElement>('hero-choice-details'),getContent(contentVersion),slot=>bindings.label(slot));
const help=element<HTMLElement>('controls-help'),settingsTrigger=element<HTMLButtonElement>('keyboard-settings');
const refreshHelp=()=>{help.textContent=controlsHelp(bindings);heroSelection.refresh();};refreshHelp();
let cleanup:()=>void=()=>{};let booting=false;let soundEnabled=true;
async function boot(){
  if(booting)return;booting=true;restart.disabled=true;settingsTrigger.disabled=true;heroSelection.setBusy(true);const release=cleanup;cleanup=()=>{};release();Reflect.deleteProperty(window,'mobaClient');notice.hidden=false;notice.textContent='Loading simulation and Three.js assets…';
  const lifetime=createLifetime();cleanup=()=>{const errors=lifetime.dispose();if(errors.length)console.warn('Client cleanup failed',errors);};
  try{
    const heroIdsByTeam=heroSelection.read();
    const response=await fetch(new URL('./sim/nav/lane.navmesh',import.meta.url));
    if(!response.ok)throw new Error(`Navigation asset failed: HTTP ${response.status}`);
    const navigation=await createDetourNavigation(new Uint8Array(await response.arrayBuffer()));lifetime.defer(()=>navigation.destroy());
    const sim=new Simulation({seed:1,contentVersion,navigation,heroesPerTeam:1,heroIdsByTeam});
    const sound=createBattleAudio(soundEnabled);lifetime.defer(()=>sound.dispose());
    const soundButton=element<HTMLButtonElement>('sound-toggle');const soundEvents=new AbortController();lifetime.defer(()=>soundEvents.abort());
    soundButton.textContent=soundEnabled?'Sound on':'Sound off';soundButton.setAttribute('aria-pressed',String(soundEnabled));
    soundButton.addEventListener('click',()=>{soundEnabled=!sound.enabled;sound.setEnabled(soundEnabled);soundButton.textContent=sound.enabled?'Sound on':'Sound off';soundButton.setAttribute('aria-pressed',String(sound.enabled));},{signal:soundEvents.signal});
    window.addEventListener('pointerdown',()=>void sound.unlock(),{signal:soundEvents.signal});
    window.addEventListener('keydown',()=>void sound.unlock(),{signal:soundEvents.signal});
    const bot=new HeroBot({team:1,slotIndex:0,difficulty:'normal',seed:1002});
    const world=await createWorld(stage,sim.catalog);lifetime.defer(()=>world.dispose());
    let snapshot=sim.snapshot();const playerId=snapshot.heroes.find(hero=>hero.team===0)?.id;
    if(playerId===undefined)throw new Error('No player hero in snapshot');
    const player=()=>{const hero=snapshot.heroes.find(value=>value.id===playerId);if(!hero)throw new Error('Player snapshot missing');return {snapshot,hero};};
    const commands:SimCommand[]=[];lifetime.defer(()=>{commands.length=0;});
    let settingsOpen=false;
    const enqueue=(command:SimCommand)=>{if(!settingsOpen&&commands.length<32&&snapshot.status==='running')commands.push(command);};
    let controls:ReturnType<typeof createControls>;
    const hud=createHud(hudRoot,sim.catalog,slot=>controls.skill(slot),itemId=>enqueue({type:'buyItem',heroId:playerId,itemId}),locked=>{if(!settingsOpen)world.setLocked(locked);},bindings);
    lifetime.defer(()=>hud.dispose());
    controls=createControls(world,sim.catalog,player,enqueue,text=>hud.say(text),()=>{world.setLocked(true);hud.setLocked(true);},bindings);
    lifetime.defer(()=>controls.dispose());
    const clock=new FixedClock(1/sim.tickRateHz);let previous=performance.now(),animation=0,stopped=false;
    const definition=sim.catalog.heroes[player().hero.definitionId]!;
    const settings=createKeyboardSettings(element<HTMLDialogElement>('keyboard-dialog'),settingsTrigger,bindings,{
      Q:`Skill 1 · ${sim.catalog.abilities[definition.abilities.Q]!.name}`,
      W:`Skill 2 · ${sim.catalog.abilities[definition.abilities.W]!.name}`,
      E:`Skill 3 · ${sim.catalog.abilities[definition.abilities.E]!.name}`,
      R:`Ultimate · ${sim.catalog.abilities[definition.abilities.R]!.name}`,
      attackMove:'Attack-move',stop:'Stop',focusCamera:'Lock camera',
    },open=>{
      settingsOpen=open;commands.length=0;controls.setEnabled(!open&&!document.hidden&&!stopped&&snapshot.status==='running');
      world.leavePointer();clock.reset();previous=performance.now();
    },()=>{refreshHelp();hud.update(snapshot,playerId);});
    lifetime.defer(()=>settings.dispose());
    const lifecycle=new AbortController();lifetime.defer(()=>lifecycle.abort());
    lifetime.defer(()=>{stopped=true;cancelAnimationFrame(animation);});
    document.addEventListener('visibilitychange',()=>{clock.reset();previous=performance.now();if(document.hidden){commands.length=0;controls.setEnabled(false);}else controls.setEnabled(!settingsOpen&&!stopped&&snapshot.status==='running');},{signal:lifecycle.signal});
    window.addEventListener('blur',()=>{commands.length=0;},{signal:lifecycle.signal});
    world.sync(snapshot,playerId);hud.update(snapshot,playerId);notice.hidden=true;restart.disabled=false;
    const frame=(now:number)=>{
      if(stopped)return;
      try{
        const delta=Math.max(0,(now-previous)/1000);previous=now;
        // Background tabs are paused: never drain minutes of hidden simulation on return.
        if(!document.hidden&&!settingsOpen){
          const alpha=clock.advance(delta,()=>{
            if(sim.isComplete())return;
            const issued=commands.splice(0);const results=sim.step([...issued,...bot.think(sim)]);
            snapshot=sim.snapshot();world.sync(snapshot,playerId);hud.update(snapshot,playerId);sound.sync(snapshot,playerId);
            const rejection=results.find(result=>result.command.heroId===playerId&&!result.accepted);
            if(rejection)hud.reject(rejection.reason??'unknown reason');
          });
          world.draw(Math.min(delta,.25),sim.isComplete()?1:alpha);
        }else clock.reset();
        animation=requestAnimationFrame(frame);
      }catch(error){stopped=true;settings.dispose();controls.dispose();hud.disable();notice.hidden=false;notice.textContent=`Client stopped: ${error instanceof Error?error.message:String(error)}`;}
    };
    animation=requestAnimationFrame(frame);

    // Explicit read-only, structured diagnostic snapshot for a future real browser smoke.
    Object.defineProperty(window,'mobaClient',{configurable:true,value:{snapshot:()=>sim.snapshot(),state:()=>({ready:!stopped,backend:'three-webgl2',camera:world.cameraState(),pointer:controls.inspectPointer(),effects:world.effectState(),targeting:world.targetingState(),motions:world.motionState(),tick:sim.snapshot().tick,status:sim.status})}});
  }catch(error){cleanup();stage.replaceChildren();hudRoot.replaceChildren();notice.textContent=error instanceof Error?error.message:String(error);notice.hidden=false;restart.disabled=false;}
  finally{booting=false;heroSelection.setBusy(false);}
}
restart.addEventListener('click',()=>void boot());
window.addEventListener('pagehide',()=>cleanup(),{once:true});
void boot();
