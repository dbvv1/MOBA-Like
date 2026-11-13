/** Original procedural wind/leaf bed; no downloaded samples or simulation RNG.
 * Eight seconds with a smooth loop seam, band-limited by two one-pole stages. */
export function forestSamples(sampleRate:number){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Unsupported forest sample rate');
  const count=Math.round(sampleRate*8),data=new Float32Array(count);
  let seed=0x73d125a1,slow=0,fast=0;
  const a=1-Math.exp(-2*Math.PI*480/sampleRate),b=1-Math.exp(-2*Math.PI*1600/sampleRate);
  for(let i=0;i<count;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=seed/2147483648-1;slow+=a*(noise-slow);fast+=b*(noise-fast);
    const phase=i/(count-1),edge=Math.min(1,i/(sampleRate*.12),(count-1-i)/(sampleRate*.12));
    const envelope=.5-.5*Math.cos(Math.PI*edge);
    const gust=.65+.2*Math.sin(phase*Math.PI*2)+.15*Math.sin(phase*Math.PI*6);
    data[i]=(slow*.7+(fast-slow)*.18)*gust*envelope;
  }
  data[0]=0;data[count-1]=0;return data;
}
export const FOREST_MIX={idle:.38,combat:.055,attack:.025,hold:.45,release:.7} as const;
/** Owns one loop and its environment bus, never the shared context/master.
 * Combat keeps its original path and gain. Only the background is ducked. */
export function createForestBed(context:AudioContext,destination:AudioNode){
  let source:AudioBufferSourceNode|null=null,bus:GainNode|null=null,disposed=false,inactive=false,duckUntil=-Infinity;
  try{
    const data=forestSamples(context.sampleRate),buffer=context.createBuffer(1,data.length,context.sampleRate);
    buffer.copyToChannel(data,0);bus=context.createGain();bus.gain.value=0;bus.connect(destination);
    source=context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(bus);source.start();
    bus.gain.setTargetAtTime(FOREST_MIX.idle,context.currentTime,.5);
  }catch(error){try{source?.stop();}catch{}source?.disconnect();bus?.disconnect();throw error;}
  const parameter=()=>bus!.gain;
  function silence(value:boolean){
    if(disposed)return;inactive=value;duckUntil=-Infinity;const gain=parameter(),now=context.currentTime;
    gain.cancelScheduledValues(now);if(value)gain.setValueAtTime(0,now);else gain.setTargetAtTime(FOREST_MIX.idle,now,.35);
  }
  return {
    silence,
    duck(at:number){
      if(disposed||inactive)return;
      const gain=parameter(),now=context.currentTime;
      duckUntil=Math.max(duckUntil,Math.max(now,at)+FOREST_MIX.hold);
      gain.cancelScheduledValues(now);gain.setTargetAtTime(FOREST_MIX.combat,now,FOREST_MIX.attack);
      gain.setTargetAtTime(FOREST_MIX.idle,duckUntil,FOREST_MIX.release);
    },
    dispose(){if(disposed)return;disposed=true;try{source?.stop();}catch{}source?.disconnect();bus?.disconnect();source=null;bus=null;}
  };
}
