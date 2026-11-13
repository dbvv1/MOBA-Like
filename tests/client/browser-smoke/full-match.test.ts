import {describe,it,expect,vi,afterEach} from 'vitest';
import {fullMatchOptions,installFullMatchProbe,summarizeFullMatch} from './full-match.mjs';
const initial={tick:0,timeSeconds:0,status:'running',winner:null,endReason:'',contentVersion:11};
const terminal={...initial,tick:60,timeSeconds:2,status:'redWin',winner:1,endReason:'blueBaseDestroyed',bases:[{team:0,alive:false,hp:0},{team:1,alive:true,hp:100}]};
const evidence=()=>({initial,terminal,error:null,samples:[{atMs:0,tick:1,timeSeconds:1/30,callbackMs:2,intervalMs:null},{atMs:1000,tick:30,timeSeconds:1,callbackMs:65,intervalMs:1000},{atMs:2000,tick:60,timeSeconds:2,callbackMs:3,intervalMs:1000}]});
afterEach(()=>vi.unstubAllGlobals());
describe('natural complete-match smoke contract (CPU only)',()=>{
  it('requires explicit full-match opt-in and rejects unknown/missing CLI values',()=>{
    expect(fullMatchOptions([]).enabled).toBe(false);
    expect(fullMatchOptions(['--full-match']).enabled).toBe(true);
    for(const args of [[''],['--full-match','--full-match'],['--ticks'],['--full-match=false']])expect(()=>fullMatchOptions(args)).toThrow();
  });
  it('keeps slow frames, counts all callbacks, and distinguishes native timeout',()=>{
    const result=summarizeFullMatch(evidence());
    expect(result.acceptanceReady).toBe(false);
    expect(result.callbackCpu.maxMs).toBe(65);expect(result.callbackCpu.over33ms).toBe(1);
    expect(result.frameIntervals.maxMs).toBe(1000);expect(result.frames).toBe(3);
    const timed=evidence();timed.terminal={...terminal,status:'timeout',winner:null,endReason:'maxMatchSeconds'};
    expect(()=>summarizeFullMatch(timed)).toThrow('natural rules timeout');
    timed.terminal={...timed.terminal,tick:36000,timeSeconds:1200,bases:[{team:0,alive:true,hp:100},{team:1,alive:true,hp:100}]};
    timed.samples[2]={...timed.samples[2],tick:36000,timeSeconds:1200,atMs:1200000,intervalMs:1199000};
    expect(summarizeFullMatch(timed).terminal.status).toBe('timeout');
  });
  it('retains same-frame callbacks while measuring distinct rendering intervals',()=>{
    const result=evidence();
    result.samples.splice(1,0,{...result.samples[0],callbackMs:40,intervalMs:0});
    const summary=summarizeFullMatch(result);
    expect(summary.frames).toBe(3);expect(summary.callbacks).toBe(4);
    expect(summary.sameFrameExtraCallbacks).toBe(1);
    expect(summary.callbackCpu.count).toBe(4);expect(summary.frameCallbackCpu.count).toBe(3);
    expect(summary.frameCallbackCpu.meanMs).toBe(110/3);
    expect(summary.frameIntervals.count).toBe(2);expect(summary.frameIntervals.meanMs).toBe(1000);
    expect(result.samples).toHaveLength(4);
    const invalid=evidence();invalid.samples[1]={...invalid.samples[0],intervalMs:1};
    expect(()=>summarizeFullMatch(invalid)).toThrow('Non-contiguous');
    for(const field of ['callbackMs','intervalMs','atMs'])for(const value of [-1,Infinity,undefined]){
      const bad=evidence();bad.samples[1][field]=value;expect(()=>summarizeFullMatch(bad)).toThrow();
    }
    const same=evidence();same.samples.forEach((s,i)=>{s.atMs=0;s.intervalMs=i===0?null:0;});
    expect(()=>summarizeFullMatch(same)).toThrow('Missing distinct');
    const reverse=evidence();reverse.samples[2].atMs=999;reverse.samples[2].intervalMs=-1;
    expect(()=>summarizeFullMatch(reverse)).toThrow();
  });
  it('rejects absent, partial, restarted, accelerated and corrupt evidence',()=>{
    for(const bad of [undefined,{}, {...evidence(),initial:{...initial,tick:8}}, {...evidence(),terminal:null}, {...evidence(),error:'hidden'}, {...evidence(),samples:[]}, {...evidence(),terminal:{...terminal,bases:[]}}, {...evidence(),terminal:{...terminal,endReason:'testHook'}}, {...evidence(),terminal:{...terminal,winner:0}}])expect(()=>summarizeFullMatch(bad)).toThrow();
    for(const field of ['callbackMs','intervalMs','atMs']){
      const bad=evidence();bad.samples[1][field]=NaN;expect(()=>summarizeFullMatch(bad)).toThrow();
    }
    const gap=evidence();gap.samples.splice(1,1);expect(()=>summarizeFullMatch(gap)).toThrow('Non-contiguous');
    const restarted=evidence();restarted.samples[2].tick=0;expect(()=>summarizeFullMatch(restarted)).toThrow();
    const fast=evidence();fast.samples[1].intervalMs=10;fast.samples[2].intervalMs=10;expect(()=>summarizeFullMatch(fast)).toThrow();
  });
  it('observes first and terminal callbacks without mutating snapshots or scheduling extra frames',()=>{
    let queued:Function|undefined,snapshot=initial;
    const native=vi.fn(cb=>{queued=cb;return 7;});
    const host={requestAnimationFrame:native,mobaClient:{snapshot:()=>({...snapshot,entities:(snapshot.bases??[]).map(b=>({...b,structureKind:'base'}))})}};
    vi.stubGlobal('window',host);vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),querySelector:()=>null});
    installFullMatchProbe();
    const callback=vi.fn(()=>{snapshot=terminal;});
    expect(host.requestAnimationFrame(callback)).toBe(7);queued!(500);
    expect(callback).toHaveBeenCalledWith(500);expect(native).toHaveBeenCalledTimes(1);
    expect(host.__mobaFullMatch.initial).toEqual({...initial,bases:[]});expect(host.__mobaFullMatch.terminal).toEqual(terminal);
    expect(host.__mobaFullMatch.samples).toHaveLength(1);expect(snapshot).toBe(terminal);
  });
  it('records two native callbacks sharing a timestamp without losing either',()=>{
    const queue:Function[]=[];let snapshot=initial;
    const native=vi.fn(cb=>{queue.push(cb);return queue.length;});
    const host={requestAnimationFrame:native,mobaClient:{snapshot:()=>({...snapshot,entities:(snapshot.bases??[]).map(b=>({...b,structureKind:'base'}))})}};
    vi.stubGlobal('window',host);vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),querySelector:()=>null});
    installFullMatchProbe();
    host.requestAnimationFrame(()=>{});host.requestAnimationFrame(()=>{snapshot={...initial,tick:1,timeSeconds:1/30};});
    queue[0](100);queue[1](100);
    host.requestAnimationFrame(()=>{snapshot=terminal;});queue[2](2100);
    const raw=host.__mobaFullMatch;
    expect(raw.samples.map(s=>s.intervalMs)).toEqual([null,0,2000]);
    expect(raw.samples.map(s=>s.tick)).toEqual([0,1,60]);
    const summary=summarizeFullMatch(raw);
    expect(summary.callbacks).toBe(3);expect(summary.frames).toBe(2);
    expect(native).toHaveBeenCalledTimes(3);
  });
  it('rejects an open pause dialog and a transient hide between callbacks',()=>{
    let queued:Function,visibility:Function;
    const host={requestAnimationFrame:cb=>{queued=cb;return 1;},mobaClient:{snapshot:()=>({...initial,entities:[]})}};
    const doc={hidden:false,addEventListener:(_type,cb)=>{visibility=cb;},querySelector:()=>({open:true})};
    vi.stubGlobal('window',host);vi.stubGlobal('document',doc);installFullMatchProbe();
    host.requestAnimationFrame(()=>{});queued!(0);expect(host.__mobaFullMatch.error).toContain('paused');
    host.requestAnimationFrame=cb=>{queued=cb;return 1;};installFullMatchProbe();
    doc.hidden=true;visibility!();doc.hidden=false;
    expect(host.__mobaFullMatch.error).toContain('hidden');expect(host.__mobaFullMatch.visibilityChanges).toHaveLength(1);
  });
  it('marks hidden pages as invalid rather than quietly dropping paused frames',()=>{
    let queued:Function;const host={requestAnimationFrame:cb=>{queued=cb;return 1;},mobaClient:{snapshot:()=>({...initial,entities:[]})}};
    vi.stubGlobal('window',host);vi.stubGlobal('document',{hidden:true,addEventListener:vi.fn(),querySelector:()=>null});installFullMatchProbe();
    host.requestAnimationFrame(()=>{});queued!(0);expect(host.__mobaFullMatch.error).toContain('hidden');
  });
});

it('the unmodified browser recipe reaches a real terminal with an idle player (no test hooks)',async()=>{
  const {LocalMatch}=await import('../../../src/save/match.js');
  const {getContent}=await import('../../../src/content/catalog.js');
  const {testNavigation}=await import('../../helpers.js');
  const nav=await testNavigation();
  try {
    const match=new LocalMatch({seed:1,contentVersion:11,heroIdsByTeam:[['veyra'],['veyra']],maxMatchSeconds:getContent(11).rules.maxMatchSeconds,botSeed:1002,botDifficulty:'normal'},nav,'smoke-cpu');
    while(!match.simulation.isComplete()&&match.simulation.state.tick<36001)match.step([]);
    const s=match.simulation.snapshot();
    expect(s.status).not.toBe('running');expect(s.tick).toBeGreaterThan(300);
    expect(['blueBaseDestroyed','redBaseDestroyed','mutualBaseDestruction','maxMatchSeconds']).toContain(s.endReason);
    console.log('Idle natural-match CPU outcome',s.tick,s.timeSeconds,s.status,s.endReason);
  }finally{nav.destroy();}
});
