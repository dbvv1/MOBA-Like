import {it,expect,vi} from 'vitest';
import {createForestBed,forestSamples,FOREST_MIX} from '../../src/audio/forest.js';

function device(){
  const ramps:Array<{value:number;at:number;tau?:number}>=[],sources:any[]=[],nodes:any[]=[];
  const context:any={sampleRate:8000,currentTime:10,destination:{},
    createBuffer:(_n:number,size:number)=>({copyToChannel(data:Float32Array){expect(data.length).toBe(size);}}),
    createGain(){const node={gain:{value:0,cancelScheduledValues:vi.fn(),setValueAtTime(value:number,at:number){ramps.push({value,at});},setTargetAtTime(value:number,at:number,tau:number){ramps.push({value,at,tau});}},connect:vi.fn(),disconnect:vi.fn()};nodes.push(node);return node;},
    createBufferSource(){const node={buffer:null,loop:false,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};sources.push(node);return node;}
  };return {context,ramps,sources,nodes};
}
it('generates deterministic bounded, seam-zero original wind with low output RMS',()=>{
  for(const rate of [8000,44100,48000]){
    const a=forestSamples(rate),b=forestSamples(rate);expect(a).toEqual(b);expect(a.length).toBe(rate*8);expect(a[0]).toBe(0);expect(a.at(-1)).toBe(0);
    let sum=0,peak=0;expect(a.every(Number.isFinite)).toBe(true);for(const x of a){sum+=x*x;peak=Math.max(peak,Math.abs(x));}
    expect(peak).toBeLessThan(1);expect(Math.sqrt(sum/a.length)*FOREST_MIX.idle*.32).toBeLessThan(.04);expect(peak*FOREST_MIX.idle*.32).toBeLessThan(.12);
  }
  expect(()=>forestSamples(0)).toThrow();expect(()=>forestSamples(Infinity)).toThrow();
});
it('owns one background bus and extends overlapping duck without modifying master',()=>{
 const d=device(),master={};const bed=createForestBed(d.context,master as any);
 expect(d.sources).toHaveLength(1);expect(d.sources[0].loop).toBe(true);expect(d.nodes[0].connect).toHaveBeenCalledWith(master);
 bed.duck(12);expect(d.ramps.at(-1)?.at).toBe(12.45);d.context.currentTime=10.1;bed.duck(10.1);expect(d.ramps.at(-1)?.at).toBe(12.45);
 bed.silence(true);expect(d.ramps.at(-1)?.value).toBe(0);const n=d.ramps.length;bed.duck(13);expect(d.ramps).toHaveLength(n);
 bed.silence(false);expect(d.ramps.at(-1)?.value).toBe(FOREST_MIX.idle);bed.dispose();bed.dispose();expect(d.sources[0].stop).toHaveBeenCalledTimes(1);expect(d.nodes[0].disconnect).toHaveBeenCalledTimes(1);
});
it('partial source initialization failure disconnects the allocated bus',()=>{
 const d=device();d.context.createBufferSource=()=>{throw new Error('device failed');};expect(()=>createForestBed(d.context,{} as any)).toThrow('device failed');expect(d.nodes[0].disconnect).toHaveBeenCalledOnce();
});
it('only the accepted scene enables ambience; mute/pause/terminal/reset cleanly suppress it',async()=>{
 vi.resetModules();const {createBattleAudio}=await import('../../src/audio/battle.js');
 const d=device();let state='running',listener:()=>void=()=>{};
 class Context {
   sampleRate=8000;currentTime=10;destination={};get state(){return state;}
   createBuffer=d.context.createBuffer;createGain=d.context.createGain;createBufferSource=d.context.createBufferSource;
   addEventListener(_name:string,f:()=>void){listener=f;}async resume(){state='running';listener();}async close(){state='closed';listener();}
   async decodeAudioData(){return {duration:.2};}
 }
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('fetch',async()=>new Response(new Uint8Array([1])));
 try{
  const a=createBattleAudio();await a.unlock();expect(d.sources).toHaveLength(0);
  a.setForestEnabled(true);expect(d.sources).toHaveLength(1);expect(a.inspect().forest.active).toBe(true);
  a.setPaused(true);expect(a.inspect().forest.active).toBe(false);a.setPaused(false);expect(a.inspect().forest.active).toBe(true);
  a.setEnabled(false);expect(d.ramps.at(-1)?.value).toBe(0);a.setEnabled(true);
  a.sync({status:'complete',events:[]} as any,1);expect(a.inspect().forest.active).toBe(false);a.setPaused(false);expect(d.ramps.at(-1)?.value).toBe(0);
  a.dispose();expect(d.sources[0].stop).toHaveBeenCalledOnce();
  state='running';const restored=createBattleAudio();restored.setForestEnabled(true);restored.sync({status:'complete',events:[]} as any,1);await restored.unlock();expect(restored.inspect().forest.active).toBe(false);expect(d.ramps.at(-1)?.value).toBe(0);restored.dispose();
 }finally{vi.unstubAllGlobals();}
});
