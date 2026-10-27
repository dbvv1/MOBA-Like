import {createBattleAudio} from './audio/battle.js';
import {getContent} from './content/catalog.js';
import {createHeroSelection} from './ui/hero-selection.js';
import {LocalMatch,restoreMatch,type MatchSave} from './save/match.js';
import {createSaveSlot} from './save/storage.js';
import {acquireSaveOwnership,chooseSavedMatch,createSavePanel,SAVE_COMPATIBILITY_ID} from './save/browser.js';
import {createDetourNavigation} from './sim/navigation.js';
import type {SimCommand} from './sim/types.js';
import {createWorld} from './render/world.js';
import {FixedClock} from './render/clock.js';
import {createLifetime} from './render/lifetime.js';
import {createControls} from './input/controls.js';
import {createHud} from './ui/hud.js';

function element<T extends HTMLElement>(id:string):T {const result=document.getElementById(id);if(!result)throw new Error(`Missing ${id}`);return result as T;}
const stage=element<HTMLElement>('stage'),notice=element<HTMLElement>('notice'),hudRoot=element<HTMLElement>('hud'),restart=element<HTMLButtonElement>('restart');
const contentVersion=10 as const;
const heroSelection=createHeroSelection(element<HTMLSelectElement>('hero-select'),element<HTMLElement>('hero-choice-details'),getContent(contentVersion));
let cleanup:()=>void=()=>{};let saveBeforeLeave:()=>void=()=>{};let booting=false;let bootGeneration=0;let soundEnabled=true;
restart.textContent='New match';restart.title='Start a new match and replace the local checkpoint';
async function boot(mode:'prompt'|'new'='prompt'){
  if(booting)return;booting=true;restart.disabled=true;heroSelection.setBusy(true);const release=cleanup;cleanup=()=>{};release();Reflect.deleteProperty(window,'mobaClient');notice.hidden=false;notice.textContent='Loading simulation and Three.js assets…';
  const generation=++bootGeneration,abort=new AbortController();
  const current=()=>{if(abort.signal.aborted||generation!==bootGeneration)throw new DOMException('Match loading cancelled.','AbortError');};
  const lifetime=createLifetime();const dispose=()=>{abort.abort();const errors=lifetime.dispose();if(errors.length)console.warn('Client cleanup failed',errors);};cleanup=dispose;
  try{
    const panel=createSavePanel();lifetime.defer(()=>panel.dispose());
    const releaseSave=await acquireSaveOwnership();if(releaseSave)lifetime.defer(releaseSave);
    current();
    const slot=createSaveSlot(()=>window.localStorage,SAVE_COMPATIBILITY_ID);
    let saving=releaseSave!==null,saved:MatchSave|undefined;
    if(saving){
      const read=slot.read();
      if(mode==='new'){
        if(read.status!=='empty'&&slot.clear().status!=='cleared')saving=false;
      }else if(read.status!=='empty'){
        const choice=await chooseSavedMatch(read,abort.signal);current();
        if(choice==='resume'&&read.status==='ready')saved=read.save;
        else if(choice==='preserve')saving=false;
        else if(slot.clear().status!=='cleared')saving=false;
      }
    }
    if(!saving)releaseSave?.();
    panel.say(saving?'Autosaves every 10 seconds. Only this browser keeps the checkpoint.':'Playing without saving. Any old checkpoint is kept; another tab or browser storage may own it.');
    const heroIdsByTeam=heroSelection.read();
    const response=await fetch(new URL('./sim/nav/lane.navmesh',import.meta.url),{signal:abort.signal});current();
    if(!response.ok)throw new Error(`Navigation asset failed: HTTP ${response.status}`);
    const navBytes=await response.arrayBuffer();current();
    const navigation=await createDetourNavigation(new Uint8Array(navBytes));lifetime.defer(()=>navigation.destroy());current();
    const match=saved?await restoreMatch(saved,navigation,SAVE_COMPATIBILITY_ID,async(tick,total)=>{
      current();
      notice.textContent=`Restoring saved match… ${Math.floor(tick/total*100)}%`;
      await new Promise<void>(resolve=>setTimeout(resolve,0));current();
    }):new LocalMatch({seed:1,contentVersion,heroIdsByTeam:[[heroIdsByTeam[0][0]!],[heroIdsByTeam[1][0]!]],maxMatchSeconds:getContent(contentVersion).rules.maxMatchSeconds,botSeed:1002,botDifficulty:'normal'},navigation,SAVE_COMPATIBILITY_ID);
    current();const sim=match.simulation;
    const sound=createBattleAudio(soundEnabled);lifetime.defer(()=>sound.dispose());
    const soundButton=element<HTMLButtonElement>('sound-toggle');const soundEvents=new AbortController();lifetime.defer(()=>soundEvents.abort());
    soundButton.textContent=soundEnabled?'Sound on':'Sound off';soundButton.setAttribute('aria-pressed',String(soundEnabled));
    soundButton.addEventListener('click',()=>{soundEnabled=!sound.enabled;sound.setEnabled(soundEnabled);soundButton.textContent=sound.enabled?'Sound on':'Sound off';soundButton.setAttribute('aria-pressed',String(sound.enabled));},{signal:soundEvents.signal});
    window.addEventListener('pointerdown',()=>void sound.unlock(),{signal:soundEvents.signal});
    window.addEventListener('keydown',()=>void sound.unlock(),{signal:soundEvents.signal});
    const world=await createWorld(stage,sim.catalog,abort.signal);lifetime.defer(()=>world.dispose());current();
    // Recovered historical events must not play again. Live events start with the next real tick.
    let snapshot={...sim.snapshot(),events:[] as ReturnType<typeof sim.snapshot>['events']};const playerId=snapshot.heroes.find(hero=>hero.team===0)?.id;
    if(playerId===undefined)throw new Error('No player hero in snapshot');
    const player=()=>{const hero=snapshot.heroes.find(value=>value.id===playerId);if(!hero)throw new Error('Player snapshot missing');return {snapshot,hero};};
    const commands:SimCommand[]=[];lifetime.defer(()=>{commands.length=0;});
    const enqueue=(command:SimCommand)=>{if(commands.length<32&&snapshot.status==='running')commands.push(command);};
    let controls:ReturnType<typeof createControls>;
    const hud=createHud(hudRoot,sim.catalog,slot=>controls.skill(slot),itemId=>enqueue({type:'buyItem',heroId:playerId,itemId}),locked=>world.setLocked(locked));
    hud.setLocked(saved?.view.cameraLocked??true);
    lifetime.defer(()=>hud.dispose());
    controls=createControls(world,sim.catalog,player,enqueue,text=>hud.say(text),()=>{world.setLocked(true);hud.setLocked(true);});
    lifetime.defer(()=>controls.dispose());
    const clock=new FixedClock(1/sim.tickRateHz);let previous=performance.now(),animation=0,stopped=false;
    const lifecycle=new AbortController();lifetime.defer(()=>lifecycle.abort());
    lifetime.defer(()=>{stopped=true;cancelAnimationFrame(animation);});
    let lastAttemptTick=saved?.tick??0,terminalCleared=false;
    const save=()=>{
      if(!saving)return;
      lastAttemptTick=sim.state.tick;
      try{
        const result=sim.isComplete()?slot.clear():slot.write(match.checkpoint({cameraLocked:world.cameraState().locked}));
        if(result.status==='saved'){
          panel.say(`Saved at ${Math.floor(result.tick/30/60)}:${String(Math.floor(result.tick/30)%60).padStart(2,'0')}. Safe to refresh; choose Continue to return.`);
        }else if(result.status==='cleared'){
          terminalCleared=true;panel.button.disabled=true;panel.say('Match finished. The local checkpoint has been cleared.');
        }else{
          if(result.status==='conflict'||result.status==='invalid'||result.status==='incompatible'||result.status==='limit'){saving=false;panel.button.disabled=true;}
          panel.say(`Not saved (${result.status}). The previous checkpoint is unchanged.${saving?' Use Save match to retry.':''}`);
        }
      }catch(error){saving=false;panel.button.disabled=true;panel.say(`Not saved: ${error instanceof Error?error.message:String(error)} The previous checkpoint is unchanged.`);}
    };
    saveBeforeLeave=save;lifetime.defer(()=>{saveBeforeLeave=()=>{};});
    panel.button.disabled=!saving;panel.button.addEventListener('click',save,{signal:lifecycle.signal});
    document.addEventListener('visibilitychange',()=>{clock.reset();previous=performance.now();if(document.hidden){commands.length=0;save();}},{signal:lifecycle.signal});
    // Start on the recovered hero even when the saved preference is free camera.
    // A zero-time draw uses the existing camera path without advancing gameplay.
    world.sync(snapshot,playerId);world.draw(0,1);world.setLocked(saved?.view.cameraLocked??true);
    hud.update(snapshot,playerId);notice.hidden=true;restart.disabled=false;
    const frame=(now:number)=>{
      if(stopped)return;
      try{
        const delta=Math.max(0,(now-previous)/1000);previous=now;
        // Background tabs are paused: never drain minutes of hidden simulation on return.
        if(!document.hidden){
          const alpha=clock.advance(delta,()=>{
            if(sim.isComplete())return;
            const issued=commands.splice(0);const results=match.step(issued);
            snapshot=sim.snapshot();world.sync(snapshot,playerId);hud.update(snapshot,playerId);sound.sync(snapshot,playerId);
            if((sim.isComplete()&&!terminalCleared)||(!sim.isComplete()&&snapshot.tick-lastAttemptTick>=300))save();
            const rejection=results.find(result=>result.command.heroId===playerId&&!result.accepted);
            if(rejection)hud.reject(rejection.reason??'unknown reason');
          });
          world.draw(Math.min(delta,.25),sim.isComplete()?1:alpha);
        }else clock.reset();
        animation=requestAnimationFrame(frame);
      }catch(error){stopped=true;saving=false;panel.button.disabled=true;controls.dispose();hud.disable();notice.hidden=false;notice.textContent=`Client stopped: ${error instanceof Error?error.message:String(error)}. The previous checkpoint is unchanged.`;}
    };
    animation=requestAnimationFrame(frame);

    // Explicit read-only, structured diagnostic snapshot for a future real browser smoke.
    Object.defineProperty(window,'mobaClient',{configurable:true,value:{snapshot:()=>sim.snapshot(),state:()=>({ready:!stopped,backend:'three-webgl2',camera:world.cameraState(),pointer:controls.inspectPointer(),effects:world.effectState(),targeting:world.targetingState(),motions:world.motionState(),tick:sim.snapshot().tick,status:sim.status})}});
  }catch(error){dispose();if(generation!==bootGeneration)return;stage.replaceChildren();hudRoot.replaceChildren();notice.textContent=error instanceof Error?error.message:String(error);notice.hidden=false;restart.disabled=false;}
  finally{if(generation===bootGeneration){booting=false;heroSelection.setBusy(false);}}
}
restart.addEventListener('click',()=>void boot('new'));
window.addEventListener('pagehide',()=>{saveBeforeLeave();++bootGeneration;cleanup();booting=false;});
window.addEventListener('pageshow',event=>{if(event.persisted)void boot('prompt');});
void boot();
