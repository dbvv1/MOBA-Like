import type {PresentationEvent,Snapshot} from '../sim/types.js';
export type BattleCue={kind:'swing'|'cast'|'hit'|'shield';strength:number;pan:number};
/** Cosmetic routing only: no hit inferred from an attack or a disappearing projectile. */
export function battleCue(event:PresentationEvent,snapshot:Snapshot,playerId:number):BattleCue|null{
  const player=snapshot.heroes.find(hero=>hero.id===playerId);if(!player)return null;
  const id=event.type==='heroDamaged'?event.targetId:'heroId'in event?event.heroId:event.sourceId;
  const source=snapshot.entities.find(entity=>entity.id===id);if(!source)return null;
  const distance=Math.hypot(source.position.x-player.position.x,source.position.z-player.position.z);
  if(distance>24)return null;
  const strength=Math.max(.12,1-distance/30),pan=Math.max(-.8,Math.min(.8,(source.position.x-player.position.x)/16));
  if(event.type==='castResolved')return {kind:'cast',strength,pan};
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
/** Licensed sample palette. Audio unlock is gesture-only; it cannot stop the game. */
export function createBattleAudio(initiallyEnabled=true){
  let context:AudioContext|null=null,master:GainNode|null=null;
  let enabled=initiallyEnabled,disposed=false,lastTick=-1,lastOrdinal=-1,lastSound=-Infinity;
  let loading:Promise<void>|null=null;const abort=new AbortController();
  const buffers=new Map<BattleCue['kind'],AudioBuffer>(),voices=new Set<AudioBufferSourceNode>();
  async function unlock(){
    if(disposed||!enabled)return;
    try{
      context??=new AudioContext();const ctx=context;
      if(!master){master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);}
      if(ctx.state==='suspended')await ctx.resume();
      if(disposed)return;
      loading??=Promise.all(Object.entries(soundUrls).map(async([key,url])=>{
        const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw new Error('Battle audio unavailable');
        const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
        if(!disposed)buffers.set(key as BattleCue['kind'],buffer);
      })).then(()=>{}).catch(()=>{});
      await loading;
    }catch{/* A failed or unsupported audio device does not interrupt play. */}
  }
  function play(cue:BattleCue){
    if(!enabled||!context||!master||context.state!=='running'||voices.size>=8)return;
    const buffer=buffers.get(cue.kind);if(!buffer)return;
    const now=context.currentTime;if(now-lastSound<.025)return;lastSound=now;
    const gain=context.createGain(),pan=context.createStereoPanner(),source=context.createBufferSource();
    source.buffer=buffer;pan.pan.value=cue.pan;
    const duration=Math.min(buffer.duration,.6);gain.gain.setValueAtTime(cue.strength,now);
    gain.gain.setValueAtTime(cue.strength,now+Math.max(0,duration-.04));gain.gain.linearRampToValueAtTime(0,now+duration);
    source.connect(gain);gain.connect(pan);pan.connect(master);voices.add(source);
    source.onended=()=>{voices.delete(source);source.disconnect();gain.disconnect();pan.disconnect();};
    source.start(now);source.stop(now+duration);
  }
  return {unlock,get enabled(){return enabled;},setEnabled(value:boolean){enabled=value;if(master)master.gain.value=value?.32:0;if(value)void unlock();},
    sync(snapshot:Snapshot,playerId:number){let foreground:BattleCue|null=null;const priority={hit:4,shield:3,cast:2,swing:1};for(const event of snapshot.events){
      if(event.tick<lastTick||(event.tick===lastTick&&event.ordinal<=lastOrdinal))continue;
      lastTick=event.tick;lastOrdinal=event.ordinal;const cue=battleCue(event,snapshot,playerId);
      if(cue&&(!foreground||priority[cue.kind]*cue.strength>priority[foreground.kind]*foreground.strength))foreground=cue;
    }if(foreground)play(foreground);},
    dispose(){if(disposed)return;disposed=true;enabled=false;abort.abort();if(master)master.gain.value=0;for(const voice of voices){try{voice.stop();}catch{}}voices.clear();void context?.close().catch(()=>{});context=null;master=null;buffers.clear();}
  };
}
