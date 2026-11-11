import * as THREE from 'three';
import type {TerrainTextures} from './terrain-composition.js';
export type OwnedTerrainTextures=TerrainTextures&{dispose():void};
/** A cosmetic pair is atomic: partial failure returns the original flat-ground fallback. */
export async function loadTerrainTexturePair(urls:{road:string;forest:string},load:(url:string)=>Promise<THREE.Texture>=url=>new THREE.TextureLoader().loadAsync(url),signal?:AbortSignal):Promise<OwnedTerrainTextures|undefined>{
  if(signal?.aborted)return undefined;
  const loaded:THREE.Texture[]=[];
  try{
    for(const url of [urls.road,urls.forest]){
      const texture=await load(url);loaded.push(texture);
      // Own a late result before observing cancellation, then stop the pair
      // without issuing another request for an obsolete world.
      if(signal?.aborted)throw new Error('Terrain loading cancelled.');
      texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;
    }
  }catch{for(const texture of loaded)texture.dispose();return undefined;}
  let disposed=false;return {road:loaded[0]!,forest:loaded[1]!,dispose(){if(disposed)return;disposed=true;for(const texture of loaded)texture.dispose();}};
}

export function loadTerrainTextures(signal?:AbortSignal){return loadTerrainTexturePair({
  road:new URL('../../asset-pipeline/terrain-composition/exported/earth-albedo.webp',import.meta.url).href,
  forest:new URL('../../asset-pipeline/terrain-composition/exported/forest-albedo.webp',import.meta.url).href,
},undefined,signal);}
