import {it,expect} from 'vitest';
import {battleCue,sampleForCue} from '../../src/audio/battle.js';
import {makeSim,hero} from '../helpers.js';

it('Q/W slots choose distinct release samples only under the existing critical policy',async()=>{
  const sim=await makeSim(12),p=hero(sim,0),snapshot=sim.snapshot();
  for(const slot of ['Q','W','E','R'] as const){
    const cue=battleCue({type:'castResolved',heroId:p.id,castId:1,abilityId:'test.'+slot,slot,tick:1,ordinal:0},snapshot,p.id)!;
    expect(cue.kind).toBe('cast');
    expect(sampleForCue(cue,'baseline')).toBe('cast');
    expect(sampleForCue(cue,'critical-v1')).toBe(slot==='Q'?'skill-q':slot==='W'?'skill-w':'cast');
    expect(battleCue({type:'castStarted',heroId:p.id,castId:1,abilityId:'test.'+slot,slot,tick:1,ordinal:0},snapshot,p.id)).toBeNull();
  }
  for(const kind of ['hit','shield','swing'] as const)expect(sampleForCue({kind,strength:1,pan:0},'critical-v1')).toBe(kind);
});

it('critical palette failure falls back to cast and a disposed owner ignores late download completion',async()=>{
  const {vi}=await import('vitest');
  vi.resetModules();
  const {createBattleAudio}=await import('../../src/audio/battle.js');
  const requests:string[]=[],started:string[]=[],instances:any[]=[];
  let finishW:((value:ArrayBuffer)=>void)|undefined;
  class Context {
    state='running';destination={};currentTime=0;
    constructor(){instances.push(this);}
    addEventListener(){} async resume(){} async close(){this.state='closed';}
    async decodeAudioData(bytes:ArrayBuffer){return {duration:.2,label:new TextDecoder().decode(bytes)};}
    createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createStereoPanner(){return {pan:{value:0},connect(){},disconnect(){}};}
    createBufferSource(){const s:any={buffer:null,connect(){},disconnect(){},start(){started.push(s.buffer.label);},stop(){},onended:null};return s;}
  }
  vi.stubGlobal('AudioContext',Context);
  vi.stubGlobal('fetch',async(url:string)=>{
    const name=String(url).split('/').at(-1)!;requests.push(name);
    if(name==='skill-q.ogg')return new Response('',{status:404});
    if(name==='skill-w.ogg')return {ok:true,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>finishW=resolve)};
    return new Response(name);
  });
  try{
    const a=createBattleAudio(true,'critical-v1');await a.unlock();
    expect(requests).toHaveLength(6);
    const sim=await makeSim(12),p=hero(sim,0),snapshot=sim.snapshot();
    const release={...snapshot,tick:1,events:[{type:'castResolved' as const,heroId:p.id,castId:1,abilityId:'veyra.q',slot:'Q' as const,tick:1,ordinal:0}]};
    a.sync(release,p.id);
    expect(started).toEqual(['cast.ogg']);expect(a.inspect().decisions.at(-1)?.sample).toBe('cast');
    a.dispose();finishW!(new TextEncoder().encode('skill-w.ogg').buffer);
    await Promise.resolve();await Promise.resolve();
    a.sync({...release,tick:2,events:release.events.map(e=>({...e,tick:2}))},p.id);
    expect(started).toHaveLength(1);expect(instances[0].state).toBe('closed');
  }finally{vi.unstubAllGlobals();}
});
