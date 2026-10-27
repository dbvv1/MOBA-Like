import {it,expect} from 'vitest';
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
