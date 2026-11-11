import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchOptions,pixelEvidence,failureCategory,cleanup,smokeEntry,assertSmokeEntry,assertRetiredLighting} from './options.mjs';
import {parseMaterialFamily} from '../../../src/render/quiet-family.js';
import {parseLightingStyle} from '../../../src/render/lighting-style.js';
import {entryLightingSearch} from '../../../src/ui/entry-lighting.js';
import {startServer} from './server.mjs';

describe('strict browser smoke helpers (no browser launched)',()=>{
  it('selects the real default when omitted and the existing quiet route explicitly',()=>{
    expect(smokeEntry({})).toEqual(smokeEntry({MOBA_SMOKE_VARIANT:'default'}));
    expect(smokeEntry({}).route).toBe('/');
    const quiet=smokeEntry({MOBA_SMOKE_VARIANT:'quiet'});
    expect(quiet.route).toBe('/candidate.html?materials=quiet-family-v1&lighting=forest-light-v1');
    for(const variant of ['default','quiet']){
      const entry=smokeEntry({MOBA_SMOKE_VARIANT:variant}),url=new URL(entry.route,'https://example.test');
      expect(parseMaterialFamily(url.search)).toBe(variant==='quiet'?'quiet-family-v1':'baseline');
      expect(parseLightingStyle(entryLightingSearch(url.search,variant==='default'?'forest-light-v1':undefined))).toBe(entry.lighting);
      expect(url.searchParams.has('commands')).toBe(false);
      expect(entry.contentVersion).toBe(11);
    }
    for(const variant of ['', 'baseline','stylized-diffuse','quiet-family-v1','quiet&commands=buffer-v1']){
      expect(()=>smokeEntry({MOBA_SMOKE_VARIANT:variant})).toThrow('MOBA_SMOKE_VARIANT');
    }
  });
  it('rejects missing state, material recovery, Canvas and wrong lighting for either full sequence',()=>{
    const state={ready:true,backend:'three-webgl2',fallbackReason:'',contentVersion:11,lighting:{active:'forest-light-v1'}};
    for(const variant of ['default','quiet']){
      const entry=smokeEntry({MOBA_SMOKE_VARIANT:variant});
      expect(()=>assertSmokeEntry(state,entry,new URL(entry.route,'https://example.test').href)).not.toThrow();
      for(const bad of [{},{...state,ready:false},{...state,fallbackReason:'restored default rendering'},
        {...state,backend:'canvas2d'},{...state,contentVersion:12},{...state,lighting:{active:'baseline'}}]){
        expect(()=>assertSmokeEntry(bad,entry,new URL(entry.route,'https://example.test').href)).toThrow();
      }
    }
  });
  it.each(['Morrow selection','Morrow reset','Veyra return'])('rejects transient fallback or wrong URL at the %s restart',()=>{
    const entry=smokeEntry({MOBA_SMOKE_VARIANT:'quiet'}),url=new URL(entry.route,'https://example.test').href;
    const ready={ready:true,backend:'three-webgl2',fallbackReason:'',contentVersion:11,lighting:{active:'forest-light-v1'}};
    expect(()=>assertSmokeEntry(ready,entry,url)).not.toThrow();
    // A later successful restart cannot make this intermediate failure acceptable.
    expect(()=>assertSmokeEntry({...ready,fallbackReason:'restored default rendering'},entry,url)).toThrow();
    expect(()=>assertSmokeEntry({...ready,backend:'canvas2d'},entry,url)).toThrow();
    expect(()=>assertSmokeEntry(ready,entry,'https://example.test/')).toThrow();
    expect(()=>assertSmokeEntry(ready,entry,'https://example.test/candidate.html')).toThrow();
    expect(()=>assertSmokeEntry(ready,entry,undefined)).toThrow();
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
