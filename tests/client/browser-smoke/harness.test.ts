import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchOptions,pixelEvidence,failureCategory,cleanup,smokeEntry,assertSmokeEntry,assertRetiredLighting,freshMorrowZoneReceipt} from './options.mjs';
import {parseMaterialFamily} from '../../../src/render/quiet-family.js';
import {parseLightingStyle} from '../../../src/render/lighting-style.js';
import {parseSceneDressing} from '../../../src/render/scene-dressing.js';
import {entryLightingSearch} from '../../../src/ui/entry-lighting.js';
import {startServer} from './server.mjs';
import {runInNewContext} from 'node:vm';
import {hero,makeSim,perform,place,stepMany} from '../../helpers.js';

describe('strict browser smoke helpers (no browser launched)',()=>{
  const variants=[
    {variant:'default',route:'/',scene:{requested:'forest-lane-v1',active:'forest-lane-v1'}},
    {variant:'quiet',route:'/candidate.html?materials=quiet-family-v1&lighting=forest-light-v1',scene:{requested:'baseline',active:null}},
    {variant:'forest-lane',route:'/candidate.html?materials=quiet-family-v1&lighting=forest-light-v1&scene=forest-lane-v1',scene:{requested:'forest-lane-v1',active:'forest-lane-v1'}},
  ];
  const ready={ready:true,backend:'three-webgl2',fallbackReason:'',contentVersion:11,lighting:{active:'forest-light-v1'},materials:{configured:'quiet-family-v1',active:'quiet-family-v1'}};
  it('selects only the three existing routes and matches their production parsers',()=>{
    expect(smokeEntry({})).toEqual(smokeEntry({MOBA_SMOKE_VARIANT:'default'}));
    for(const {variant,route,scene} of variants){
      const entry=smokeEntry({MOBA_SMOKE_VARIANT:variant}),url=new URL(entry.route,'https://example.test');
      expect(entry.route).toBe(route);
      expect(parseMaterialFamily(entryLightingSearch(url.search,undefined,variant==='default'?'quiet-family-v1':undefined))).toBe('quiet-family-v1');
      expect(parseSceneDressing(entryLightingSearch(url.search,undefined,undefined,variant==='default'?'forest-lane-v1':undefined))).toBe(scene.requested);
      expect(parseLightingStyle(entryLightingSearch(url.search,variant==='default'?'forest-light-v1':undefined))).toBe(entry.lighting);
      expect(url.searchParams.has('commands')).toBe(false);
      expect(entry.contentVersion).toBe(11);
    }
    for(const variant of ['', 'baseline','stylized-diffuse','quiet-family-v1','quiet&commands=buffer-v1']){
      expect(()=>smokeEntry({MOBA_SMOKE_VARIANT:variant})).toThrow('MOBA_SMOKE_VARIANT');
    }
  });
  it.each(variants)('rejects material recovery, Canvas and wrong lighting for $variant',({variant,scene})=>{
    const entry=smokeEntry({MOBA_SMOKE_VARIANT:variant}),url=new URL(entry.route,'https://example.test').href;
    const state={...ready,scene};
    expect(()=>assertSmokeEntry(state,entry,url)).not.toThrow();
    for(const bad of [{},{...state,ready:false},{...state,fallbackReason:'restored default rendering'},
      {...state,materials:undefined},{...state,materials:{configured:'baseline',active:null}},{...state,materials:{configured:'quiet-family-v1',active:'baseline'}},{...state,backend:'canvas2d'},{...state,contentVersion:12},{...state,lighting:{active:'baseline'}}]){
      expect(()=>assertSmokeEntry(bad,entry,url)).toThrow();
    }
  });
  it.each(variants)('requires both requested and active scene diagnostics for $variant',({variant,scene})=>{
    const entry=smokeEntry({MOBA_SMOKE_VARIANT:variant}),url=new URL(entry.route,'https://example.test').href;
    expect(()=>assertSmokeEntry({...ready,scene},entry,url)).not.toThrow();
    expect(()=>assertSmokeEntry({...ready,scene:{...scene,requested:variant==='quiet'?'forest-lane-v1':'baseline'}},entry,url)).toThrow('Requested scene');
    expect(()=>assertSmokeEntry({...ready,scene:{active:scene.active}},entry,url)).toThrow('Requested scene');
    expect(()=>assertSmokeEntry(ready,entry,url)).toThrow('Requested scene');
    expect(()=>assertSmokeEntry({...ready,scene:null},entry,url)).toThrow('Requested scene');
    expect(()=>assertSmokeEntry({...ready,scene:{requested:scene.requested}},entry,url)).toThrow('Active scene');
    expect(()=>assertSmokeEntry({...ready,scene:{...scene,active:variant==='quiet'?'forest-lane-v1':null}},entry,url)).toThrow('Active scene');
  });
  it.each(['Morrow selection','Morrow reset','Veyra return'])('rejects transient fallback or wrong URL at the %s restart',()=>{
    const entry=smokeEntry({MOBA_SMOKE_VARIANT:'quiet'}),url=new URL(entry.route,'https://example.test').href;
    const state={...ready,scene:{requested:'baseline',active:null}};
    expect(()=>assertSmokeEntry(state,entry,url)).not.toThrow();
    // A later successful restart cannot make this intermediate failure acceptable.
    expect(()=>assertSmokeEntry({...state,fallbackReason:'restored default rendering'},entry,url)).toThrow();
    expect(()=>assertSmokeEntry({...state,backend:'canvas2d'},entry,url)).toThrow();
    expect(()=>assertSmokeEntry(state,entry,'https://example.test/')).toThrow();
    expect(()=>assertSmokeEntry(state,entry,'https://example.test/candidate.html')).toThrow();
    expect(()=>assertSmokeEntry(state,entry,undefined)).toThrow();
  });
  it('serializes the Morrow E poll and rejects prior, enemy, unrelated and expired zones',()=>{
    const snapshot={tick:100,zones:[
      {id:1,team:0,abilityId:'morrow.e',expiresTick:120},
      {id:2,team:1,abilityId:'morrow.e',expiresTick:120},
      {id:3,team:0,abilityId:'veyra.e',expiresTick:120},
      {id:4,team:0,abilityId:'morrow.e',expiresTick:99},
    ]};
    const poll=runInNewContext(`(${freshMorrowZoneReceipt})`,{window:{mobaClient:{snapshot:()=>snapshot}}});
    expect(poll([1])).toBe(false);
    snapshot.zones.push({id:5,team:0,abilityId:'morrow.e',expiresTick:100});
    expect(poll([1])).toEqual({id:5,tick:100,expiresTick:100});
    snapshot.tick++;
    expect(poll([1])).toBe(false);
  });
  it('observes the real Morrow E zone after windup but not after its lifetime',async()=>{
    const sim=await makeSim(11,17,{blueHero:'morrow'}),morrow=hero(sim,0);
    place(morrow,{x:-4,z:0});
    expect(perform(sim,{type:'cast',heroId:morrow.id,slot:'E',targetId:null,direction:null,point:{x:-1,z:0}}).accepted).toBe(true);
    expect(sim.snapshot().stats.abilities['morrow.e']?.casts).toBe(1);
    expect(freshMorrowZoneReceipt([],sim.snapshot())).toBe(false);
    stepMany(sim,10);
    const sampled=sim.snapshot(),zone=sampled.zones.find(z=>z.team===0&&z.abilityId==='morrow.e');
    expect(zone).toBeDefined();
    expect(freshMorrowZoneReceipt([],sampled)).toEqual({id:zone!.id,tick:sampled.tick,expiresTick:zone!.expiresTick});
    stepMany(sim,zone!.expiresTick-sampled.tick);
    expect(freshMorrowZoneReceipt([],sim.snapshot())).toEqual({id:zone!.id,tick:zone!.expiresTick,expiresTick:zone!.expiresTick});
    sim.step([]);
    expect(freshMorrowZoneReceipt([],sim.snapshot())).toBe(false);
  });
  it('treats retired stylized lighting as visible recovery, never an active variant',()=>{
    expect(()=>parseLightingStyle('?lighting=stylized-diffuse')).toThrow('retired');
    const state={ready:true,backend:'three-webgl2',lighting:{active:'forest-light-v1'},fallbackReason:'Candidate renderer unavailable; restored default rendering. The stylized-diffuse trial is retired; use the quiet material trial.'};
    expect(()=>assertRetiredLighting(state,true)).not.toThrow();
    expect(()=>assertRetiredLighting(state,false)).toThrow();
    for(const bad of [{},{...state,backend:'canvas2d'},{...state,fallbackReason:''},{...state,lighting:{active:'stylized-diffuse'}}]){
      expect(()=>assertRetiredLighting(bad,true)).toThrow();
    }
  });
  it('defaults to sandbox; explicit binary/sandbox options never silently fall back',()=>{
    expect(launchOptions({}).chromiumSandbox).toBe(true);
    expect(launchOptions({}).ignoreDefaultArgs).toEqual(['--enable-unsafe-swiftshader']);
    expect(launchOptions({}).args).toEqual([]);
    expect(launchOptions({MOBA_SMOKE_RENDERER:'software'}).args).toEqual(['--use-angle=swiftshader']);
    expect(launchOptions({MOBA_SMOKE_CHROMIUM:'/example/chromium'}).executablePath).toBe('/example/chromium');
    expect(()=>launchOptions({MOBA_SMOKE_CLOUD_NO_SANDBOX:'1'})).toThrow('not permitted');
    expect(()=>launchOptions({MOBA_SMOKE_CHROMIUM:'chromium'})).toThrow('absolute');
    expect(()=>launchOptions({MOBA_SMOKE_CLOUD_NO_SANDBOX:'0'})).toThrow('not permitted');
  });
  it('rejects blank/near-blank canvas and accepts varied pixels without claiming WebGL',()=>{
    const data=new Uint8Array(100*100*4).fill(255);
    expect(pixelEvidence({width:100,height:100,data}).nonBackground).toBe(false);
    for(let i=0;i<40;i++){data[i*4]=i*6;data[i*4+1]=i*3;}
    expect(pixelEvidence({width:100,height:100,data}).nonBackground).toBe(false);
    for(let i=0;i<10000;i++){data[i*4]=i%256;data[i*4+1]=Math.floor(i/16)%256;}
    expect(pixelEvidence({width:100,height:100,data}).nonBackground).toBe(true);
    expect(()=>pixelEvidence({width:1,height:1,data})).toThrow('Invalid');
  });
  it('categorizes startup, WebGL, input, and pixels separately',()=>{
    expect(failureCategory('launch','socket error')).toBe('browser-launch');
    expect(failureCategory('initialize','WebGL 2 is unavailable')).toBe('webgl-unavailable');
    expect(failureCategory('input')).toBe('input-or-simulation');
    expect(failureCategory('pixels')).toBe('render-pixels');
  });
  it('closes server even if browser cleanup throws',async()=>{
    const calls=[];const errors=await cleanup({browser:{async close(){calls.push('browser');throw Error('crashed');}},server:{async close(){calls.push('server');}}});
    expect(calls).toEqual(['browser','server']);expect(errors).toEqual(['browser: crashed']);expect(await cleanup({})).toEqual([]);
  });
  it('serves actual built files on loopback and closes its listener',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'moba-smoke-'));let server;
    try{
      await writeFile(join(directory,'index.html'),'<!doctype html><h1>fixture</h1>');await writeFile(join(directory,'asset.bin'),'fixture-asset');
      server=await startServer(directory);expect(new URL(server.origin).hostname).toBe('127.0.0.1');
      expect(await(await fetch(server.origin)).text()).toContain('fixture');
      expect(await(await fetch(server.origin+'/asset.bin')).text()).toBe('fixture-asset');
      await server.close();await expect(fetch(server.origin)).rejects.toThrow();server=undefined;
    }finally{if(server)await server.close();await rm(directory,{recursive:true,force:true});}
  });
});
