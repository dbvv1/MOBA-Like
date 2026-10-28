import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchOptions,pixelEvidence,failureCategory,cleanup} from './options.mjs';
import {startServer} from './server.mjs';

describe('strict browser smoke helpers (no browser launched)',()=>{
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
