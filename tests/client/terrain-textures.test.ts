import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {loadTerrainTexturePair} from '../../src/render/terrain-textures.js';
it('uses one world-owned repeat/sRGB pair and releases it once',async()=>{
  const source=[new THREE.Texture(),new THREE.Texture()];let count=0,i=0;source.forEach(t=>t.addEventListener('dispose',()=>count++));
  const textures=await loadTerrainTexturePair({road:'road',forest:'forest'},async()=>source[i++]!);
  expect(textures?.road.colorSpace).toBe(THREE.SRGBColorSpace);expect(textures?.forest.wrapS).toBe(THREE.RepeatWrapping);textures!.dispose();textures!.dispose();expect(count).toBe(2);
});
it('releases the first texture on second load failure and leaves old terrain available',async()=>{
  const texture=new THREE.Texture();let disposed=0;texture.addEventListener('dispose',()=>disposed++);
  expect(await loadTerrainTexturePair({road:'road',forest:'forest'},async url=>{if(url==='forest')throw Error('network');return texture;})).toBeUndefined();expect(disposed).toBe(1);
});

it('does not request a pair for an already cancelled world',async()=>{
  const controller=new AbortController();controller.abort();const load=vi.fn();
  expect(await loadTerrainTexturePair({road:'road',forest:'forest'},load,controller.signal)).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});
it.each([1,2])('releases late results when cancelled during texture %s and permits a fresh pair',async count=>{
  const controller=new AbortController(),sources:THREE.Texture[]=[];
  const load=vi.fn(async()=>{const texture=new THREE.Texture();vi.spyOn(texture,'dispose');sources.push(texture);if(sources.length===count)controller.abort();return texture;});
  expect(await loadTerrainTexturePair({road:'road',forest:'forest'},load,controller.signal)).toBeUndefined();
  expect(load).toHaveBeenCalledTimes(count);
  for(const source of sources)expect(source.dispose).toHaveBeenCalledTimes(1);
  const next=await loadTerrainTexturePair({road:'road',forest:'forest'},load,new AbortController().signal);
  expect(next).toBeDefined();next!.dispose();next!.dispose();
  for(const source of sources)expect(source.dispose).toHaveBeenCalledTimes(1);
});
