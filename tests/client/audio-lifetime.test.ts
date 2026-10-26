import {it,expect,vi} from 'vitest';
import {createBattleAudio} from '../../src/audio/battle.js';

it('shares four immutable sample downloads across restart without aborting or decoding into the dead match',async()=>{
  const responses:Array<(value:Response)=>void>=[];
  const request=vi.fn((_url:string)=>new Promise<Response>(resolve=>responses.push(resolve)));
  const instances:Array<{decodeAudioData:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}>=[];
  class Context {
    state='running';destination={};
    decodeAudioData=vi.fn(async(bytes:ArrayBuffer)=>{expect(bytes.byteLength).toBe(3);structuredClone(bytes,{transfer:[bytes]});return {duration:.1};});close=vi.fn(async()=>{});
    constructor(){instances.push(this);}
    createGain(){return {gain:{value:0},connect(){}};}
    async resume(){}
  }
  vi.stubGlobal('fetch',request);vi.stubGlobal('AudioContext',Context);
  try{
    const first=createBattleAudio();const loading=first.unlock();expect(request).toHaveBeenCalledTimes(4);
    first.dispose();const restarted=createBattleAudio();const next=restarted.unlock();expect(request).toHaveBeenCalledTimes(4);
    for(const resolve of responses)resolve(new Response(new Uint8Array([1,2,3])));
    await Promise.all([loading,next]);expect(instances[0]!.decodeAudioData).not.toHaveBeenCalled();expect(instances[0]!.close).toHaveBeenCalledTimes(1);expect(instances[1]!.decodeAudioData).toHaveBeenCalledTimes(4);
    restarted.setEnabled(false);expect(restarted.enabled).toBe(false);restarted.dispose();
    const third=createBattleAudio();await third.unlock();expect(request).toHaveBeenCalledTimes(4);expect(instances[2]!.decodeAudioData).toHaveBeenCalledTimes(4);third.dispose();
    expect(request.mock.calls.every(call=>call.length===1)).toBe(true);
  }finally{vi.unstubAllGlobals();}
});
