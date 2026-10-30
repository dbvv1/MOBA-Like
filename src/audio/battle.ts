import type {PresentationEvent,Snapshot} from '../sim/types.js';
export type BattleCue={kind:'swing'|'cast'|'hit'|'shield';strength:number;pan:number};
/** Cosmetic routing only: no hit inferred from an attack or a disappearing projectile. */
export function battleCue(event:PresentationEvent,snapshot:Snapshot,playerId:number):BattleCue|null{
  if(event.type==='minionDied')return null; // no invented death sound
  const player=snapshot.heroes.find(hero=>hero.id===playerId);if(!player)return null;
  if(event.type==='heroDamaged'&&event.abilityId===null&&snapshot.events.some(hit=>hit.type==='basicAttackHit'&&hit.sourceId===event.sourceId&&hit.targetId===event.targetId))return null;
  const id=event.type==='heroDamaged'||event.type==='basicAttackHit'?event.targetId:'heroId'in event?event.heroId:event.sourceId;
  const source=event.type==='basicAttackHit'?{position:event.position,kind:snapshot.entities.find(entity=>entity.id===id)?.kind??'minion'}:snapshot.entities.find(entity=>entity.id===id);if(!source)return null;
  const distance=Math.hypot(source.position.x-player.position.x,source.position.z-player.position.z);
  if(distance>24)return null;
  const strength=Math.max(.12,1-distance/30),pan=Math.max(-.8,Math.min(.8,(source.position.x-player.position.x)/16));
  if(event.type==='castResolved'&&event.action!=='basicAttack')return {kind:'cast',strength,pan};
  if(event.type==='basicAttackHit')return {kind:event.hpDamage>0?'hit':'shield',strength:strength*(event.sourceId===playerId?.85:source.kind==='hero'?.65:.2),pan};
  if(event.type==='heroDamaged')return {kind:event.hpDamage>0?'hit':'shield',strength:strength*(event.hpDamage>0?.8:.4),pan};
  if(event.type==='basicAttack'&&source.kind==='hero')return {kind:'swing',strength:strength*.45,pan};
  return null;
}

const soundUrls={
  swing:new URL('../../assets/audio/battle/swing.ogg',import.meta.url).href,
  cast:new URL('../../assets/audio/battle/cast.ogg',import.meta.url).href,
  hit:new URL('../../assets/audio/battle/hit.ogg',import.meta.url).href,
  shield:new URL('../../assets/audio/battle/shield.ogg',import.meta.url).href,
};
// Four immutable page-owned downloads survive match restarts. A match owns its
// AudioContext/voices, not the shared HTTP transport. No abandoned-request errors
// are manufactured when Restart is clicked during the first audio gesture.
const sampleBytes=new Map<BattleCue['kind'],Promise<ArrayBuffer>>();
function readSample(kind:BattleCue['kind'],url:string){
  let pending=sampleBytes.get(kind);
  if(!pending){pending=fetch(url).then(response=>{if(!response.ok)throw new Error('Battle audio unavailable');return response.arrayBuffer();}).catch(error=>{sampleBytes.delete(kind);throw error;});sampleBytes.set(kind,pending);}
  return pending;
}
export type AudioPolicy='baseline'|'critical-v1';
export function audioPolicyFromSearch(search:string):AudioPolicy {
  const values=new URLSearchParams(search).getAll('audio');
  return values.length===1&&values[0]==='critical-v1'?'critical-v1':'baseline';
}
export const CRITICAL_AUDIO_LIMITS={gap:.025,maxAhead:.1,maxPending:4,maxVoices:8,maxEventAgeTicks:3} as const;
export interface AudioDecision {key:string;kind:BattleCue['kind'];critical:boolean;receivedAt:number|null;plannedAt:number|null;reason:string;}
const priority={hit:4,shield:3,cast:2,swing:1};
function criticalEvent(event:PresentationEvent,playerId:number){
  return event.type==='castResolved'?event.action!=='basicAttack'&&event.heroId===playerId:
    (event.type==='basicAttackHit'||event.type==='heroDamaged')&&(event.sourceId===playerId||event.targetId===playerId);
}
/** Licensed sample palette. Audio unlock is gesture-only; it cannot stop the game. */
export function createBattleAudio(initiallyEnabled=true,policy:AudioPolicy='baseline'){
  let context:AudioContext|null=null,master:GainNode|null=null;
  let enabled=initiallyEnabled,disposed=false,lastTick=-1,lastOrdinal=-1,lastSound=-Infinity;
  let paused=false;
  const decisions:AudioDecision[]=[],scheduled=new Map<AudioBufferSourceNode,{at:number;decision:AudioDecision}>();
  function record(decision:AudioDecision){decisions.push(decision);if(decisions.length>64)decisions.shift();}
  function cancel(reason:string){
    for(const [voice,entry] of scheduled){
      if(entry.at>(context?.currentTime??Infinity))record({...entry.decision,reason,plannedAt:entry.at});
      try{voice.stop();}catch{/* already ended */}
    }
    scheduled.clear();lastSound=-Infinity;
  }
  let loading:Promise<void>|null=null;
  const buffers=new Map<BattleCue['kind'],AudioBuffer>(),voices=new Set<AudioBufferSourceNode>();
  async function unlock(){
    if(disposed||!enabled)return;
    try{
      if(!context){context=new AudioContext();if(policy==='critical-v1')context.addEventListener('statechange',()=>{if(context?.state!=='running')cancel('device-reset');});}const ctx=context;
      if(!master){master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);}
      if(ctx.state==='suspended')await ctx.resume();
      if(disposed)return;
      loading??=Promise.all(Object.entries(soundUrls).map(async([key,url])=>{
        const bytes=await readSample(key as BattleCue['kind'],url);if(disposed)return;
        const buffer=await ctx.decodeAudioData(bytes.slice(0));
        if(!disposed)buffers.set(key as BattleCue['kind'],buffer);
      })).then(()=>{}).catch(()=>{});
      await loading;
    }catch{/* A failed or unsupported audio device does not interrupt play. */}
  }
  function play(cue:BattleCue,decision?:AudioDecision){
    const drop=(reason:string)=>{if(decision)record({...decision,reason});};
    if(!enabled||disposed||paused){drop('inactive');return;}
    if(!context||!master||context.state!=='running'){drop('device-unavailable');return;}
    const buffer=buffers.get(cue.kind);if(!buffer){drop('sample-unavailable');return;}
    if(voices.size>=8){drop('voice-limit');return;}
    const now=context.currentTime;
    let at=now;
    if(decision?.critical){
      at=Math.max(now,lastSound+.025);
      if(at-now>CRITICAL_AUDIO_LIMITS.maxAhead+1e-9){drop('deadline');return;}
      if(at>now&&[...scheduled.values()].filter(v=>v.at>now).length>=CRITICAL_AUDIO_LIMITS.maxPending){drop('pending-limit');return;}
    }else if(now-lastSound<.025){drop('density');return;}
    lastSound=at;
    const gain=context.createGain(),pan=context.createStereoPanner(),source=context.createBufferSource();
    source.buffer=buffer;pan.pan.value=cue.pan;
    const duration=Math.min(buffer.duration,.6);gain.gain.setValueAtTime(cue.strength,at);
    gain.gain.setValueAtTime(cue.strength,at+Math.max(0,duration-.04));gain.gain.linearRampToValueAtTime(0,at+duration);
    source.connect(gain);gain.connect(pan);pan.connect(master);voices.add(source);
    source.onended=()=>{scheduled.delete(source);voices.delete(source);source.disconnect();gain.disconnect();pan.disconnect();};
    if(decision){const accepted={...decision,plannedAt:at,reason:'scheduled'};scheduled.set(source,{at,decision:accepted});record(accepted);}
    source.start(at);source.stop(at+duration);
  }
  return {unlock,inspect:()=>({policy,paused,voices:voices.size,pending:[...scheduled.values()].filter(v=>v.at>(context?.currentTime??Infinity)).length,decisions:decisions.map(d=>({...d}))}),setPaused(value:boolean){if(policy==='critical-v1'){paused=value;if(value)cancel('pause-reset');}},get enabled(){return enabled;},setEnabled(value:boolean){enabled=value;if(!value&&policy==='critical-v1')cancel('mute-reset');if(master)master.gain.value=value?.32:0;if(value)void unlock();},
    sync(snapshot:Snapshot,playerId:number){
      const entries:Array<{cue:BattleCue;decision:AudioDecision}>=[];
      for(const event of snapshot.events){
        if(event.tick<lastTick||(event.tick===lastTick&&event.ordinal<=lastOrdinal))continue;
        lastTick=event.tick;lastOrdinal=event.ordinal;const cue=battleCue(event,snapshot,playerId);if(!cue)continue;
        const decision:AudioDecision={key:`${event.tick}:${event.ordinal}`,kind:cue.kind,critical:criticalEvent(event,playerId),receivedAt:context?.currentTime??null,plannedAt:null,reason:'candidate'};
        if(policy==='critical-v1'&&(event.tick>snapshot.tick||snapshot.tick-event.tick>CRITICAL_AUDIO_LIMITS.maxEventAgeTicks)){record({...decision,reason:'event-age'});continue;}
        entries.push({cue,decision});
      }
      // Stable weighted ranking preserves ties in event order. Baseline still picks one.
      entries.sort((a,b)=>priority[b.cue.kind]*b.cue.strength-priority[a.cue.kind]*a.cue.strength);
      if(policy==='baseline'){if(entries[0])play(entries[0].cue);return;}
      const retained=entries.filter((e,index)=>e.decision.critical||index===0);
      for(const entry of entries)if(!retained.includes(entry))record({...entry.decision,reason:'coalesced'});
      for(const entry of retained)play(entry.cue,entry.decision);
    },
    dispose(){if(disposed)return;disposed=true;enabled=false;if(policy==='critical-v1')cancel('dispose-reset');if(master)master.gain.value=0;for(const voice of voices){try{voice.stop();}catch{}}voices.clear();void context?.close().catch(()=>{});context=null;master=null;buffers.clear();}
  };
}
