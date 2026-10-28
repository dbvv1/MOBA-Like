import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import * as THREE from 'three';
import {environmentSources,environmentDecodeOptions,loadBoundedEnvironmentTexture,mipStorageBytes} from '../../src/render/environment-materials-loader.js';
import {loadEnvironmentFamily} from '../../src/render/environment-materials.js';
const file='lane-stone-albedo.png',url=`https://assets.invalid/${file}`;
async function fixture(){
 const bytes=await readFile(new URL(`../../assets/environment-materials/${file}`,import.meta.url));
 const close=vi.fn(),bitmap={width:1024,height:1024,close} as unknown as ImageBitmap;
 const fetch=vi.fn(async()=>new Response(new Uint8Array(bytes)));
 const decode=vi.fn(async()=>bitmap) as unknown as typeof createImageBitmap;
 return {bytes,bitmap,close,deps:{fetch:fetch as typeof globalThis.fetch,decode,digest:webcrypto.subtle.digest.bind(webcrypto.subtle) as typeof crypto.subtle.digest}};
}
describe('bounded environment import (CPU contract only, not browser resize evidence)',()=>{
 it('keeps every original byte hash and 1254-square IHDR identity',async()=>{
  for(const [name,identity] of Object.entries(environmentSources)){
   const bytes=await readFile(new URL(`../../assets/environment-materials/${name}`,import.meta.url));
   expect(bytes.length).toBe(identity.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(identity.sha256);expect(bytes.readUInt32BE(16)).toBe(1254);expect(bytes.readUInt32BE(20)).toBe(1254);
  }
 });
 it('passes decode policy, reports distinct source/actual bitmap identity, owns close until disposal',async()=>{
  const f=await fixture(),texture=await loadBoundedEnvironmentTexture(url,undefined,f.deps);
  expect(f.deps.decode).toHaveBeenCalledWith(expect.any(Blob),environmentDecodeOptions);
  expect(texture.image).toBe(f.bitmap);expect(texture.flipY).toBe(false);expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(texture.userData.environmentDecode).toMatchObject({sourceSha256:environmentSources[file].sha256,sourceWidth:1254,decodedWidth:1024,estimatedRgba8MipBytes:5592404});
  expect(f.close).not.toHaveBeenCalled();texture.dispose();texture.dispose();expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('resolves hashed production URL via unchanged source-name fragment',async()=>{
  const f=await fixture(),t=await loadBoundedEnvironmentTexture(`https://assets.invalid/lane-stone-albedo-abc.png#${file}`,undefined,f.deps);t.dispose();expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('rejects ignored resize or malformed returned dimensions and closes once',async()=>{
  for(const width of [1254,0,1023,NaN]){const f=await fixture();Object.assign(f.bitmap,{width});await expect(loadBoundedEnvironmentTexture(url,undefined,f.deps)).rejects.toThrow('dimensions');expect(f.close).toHaveBeenCalledTimes(1);}
 });
 it('rejects bytes/hash/IHDR mismatch before decode',async()=>{
  for(const offset of [0,19,100]){const f=await fixture();f.bytes[offset]^=1;f.deps.fetch=vi.fn(async()=>new Response(new Uint8Array(f.bytes)));await expect(loadBoundedEnvironmentTexture(url,undefined,f.deps)).rejects.toThrow('mismatch');expect(f.deps.decode).not.toHaveBeenCalled();}
 });
 it('closes bitmap arriving after abort and never returns it',async()=>{
  const f=await fixture(),c=new AbortController();f.deps.decode=vi.fn(async()=>{c.abort();return f.bitmap;}) as typeof createImageBitmap;
  await expect(loadBoundedEnvironmentTexture(url,c.signal,f.deps)).rejects.toThrow('cancelled');expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('does not fetch after pre-abort; rejects HTTP and decode failures',async()=>{
  const f=await fixture(),c=new AbortController();c.abort();await expect(loadBoundedEnvironmentTexture(url,c.signal,f.deps)).rejects.toThrow('cancelled');expect(f.deps.fetch).not.toHaveBeenCalled();
  f.deps.fetch=vi.fn(async()=>new Response('',{status:404}));await expect(loadBoundedEnvironmentTexture(url,undefined,f.deps)).rejects.toThrow('HTTP');expect(f.deps.decode).not.toHaveBeenCalled();
  const g=await fixture();g.deps.decode=vi.fn(async()=>{throw new Error('unsupported resize');});await expect(loadBoundedEnvironmentTexture(url,undefined,g.deps)).rejects.toThrow('unsupported');expect(g.close).not.toHaveBeenCalled();
 });
 it('disposes late successful textures/bitmaps exactly once on family failure',async()=>{
  const f=await fixture();const t=await loadBoundedEnvironmentTexture(url,undefined,f.deps),dispose=vi.spyOn(t,'dispose');let n=0;
  await expect(loadEnvironmentFamily(undefined,async()=>{if(n++===1)throw new Error('failure');await Promise.resolve();return t;})).rejects.toThrow('failure');expect(dispose).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('rejects unavailable API without fetching or unbounded fallback',async()=>{
  vi.stubGlobal('createImageBitmap',undefined);try{await expect(loadBoundedEnvironmentTexture(url)).rejects.toThrow('unavailable');}finally{vi.unstubAllGlobals();}
 });
 it('family cancellation disposes returned texture and closes bitmap once',async()=>{
  const f=await fixture(),t=await loadBoundedEnvironmentTexture(url,undefined,f.deps),dispose=vi.spyOn(t,'dispose'),c=new AbortController();
  await expect(loadEnvironmentFamily(c.signal,async()=>{c.abort();return t;})).rejects.toThrow('cancelled');expect(dispose).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('rejects wrong height even when width matches',async()=>{
  const f=await fixture();Object.assign(f.bitmap,{height:1254});await expect(loadBoundedEnvironmentTexture(url,undefined,f.deps)).rejects.toThrow('dimensions');expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('cleans all textures/bitmaps and prior materials when family configuration throws',async()=>{
  const fixtures=await Promise.all([fixture(),fixture(),fixture()]);
  const textures=await Promise.all(fixtures.map(f=>loadBoundedEnvironmentTexture(url,undefined,f.deps)));
  const disposes=textures.map(t=>vi.spyOn(t,'dispose'));Object.defineProperty(textures[1],'colorSpace',{set(){throw new Error('configure failed');}});
  const materialDispose=vi.spyOn(THREE.Material.prototype,'dispose');let n=0;
  try{await expect(loadEnvironmentFamily(undefined,async()=>textures[n++]!)).rejects.toThrow('configure failed');for(const spy of disposes)expect(spy).toHaveBeenCalledTimes(1);for(const f of fixtures)expect(f.close).toHaveBeenCalledTimes(1);expect(materialDispose).toHaveBeenCalledTimes(1);}finally{materialDispose.mockRestore();}
 });
 it('cleans a constructed texture if listener setup throws',async()=>{
  const f=await fixture(),dispose=vi.spyOn(THREE.Texture.prototype,'dispose'),attach=vi.spyOn(THREE.Texture.prototype,'addEventListener').mockImplementation(()=>{throw new Error('attach failed');});
  try{await expect(loadBoundedEnvironmentTexture(url,undefined,f.deps)).rejects.toThrow('attach failed');expect(dispose).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);}finally{dispose.mockRestore();attach.mockRestore();}
 });
 it('absorbs synchronous loader failure and disposes late successful resources',async()=>{
  const f=await fixture(),t=await loadBoundedEnvironmentTexture(url,undefined,f.deps),dispose=vi.spyOn(t,'dispose');let n=0;
  await expect(loadEnvironmentFamily(undefined,()=>{if(n++===1)throw new Error('sync load');return Promise.resolve().then(()=>t);})).rejects.toThrow('sync load');expect(dispose).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('does not let a hashed URL fragment bypass source identity',async()=>{
  const f=await fixture();await expect(loadBoundedEnvironmentTexture('https://assets.invalid/asset-abc.png#structure-stone-albedo.png',undefined,f.deps)).rejects.toThrow('mismatch');expect(f.deps.decode).not.toHaveBeenCalled();
 });
 it('only establishes mathematical RGBA8 mip storage budget',()=>{expect(3*mipStorageBytes(1024,1024)).toBe(16777212);expect(3*mipStorageBytes(1024,1024)).toBeLessThan(16*1024*1024);});
});
