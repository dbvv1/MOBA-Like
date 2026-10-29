import {boundedCandidate} from './candidate-load.js';
import type {Standards} from './standards.js';
import * as THREE from 'three';
import type {TerrainTextures} from './terrain-composition.js';
export type OwnedTerrainTextures=TerrainTextures&{standardRoad?:'candidate'|'fallback'|'baseline';dispose():void};
/** A cosmetic pair is atomic: partial failure returns the original flat-ground fallback. */
export async function loadTerrainTexturePair(urls:{road:string;forest:string},load:(url:string)=>Promise<THREE.Texture>=url=>new THREE.TextureLoader().loadAsync(url)):Promise<OwnedTerrainTextures|undefined>{
  const loaded:THREE.Texture[]=[];
  try{
    for(const url of [urls.road,urls.forest]){
      const texture=await load(url);loaded.push(texture);
      texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;
    }
  }catch{for(const texture of loaded)texture.dispose();return undefined;}
  let disposed=false;return {road:loaded[0]!,forest:loaded[1]!,dispose(){if(disposed)return;disposed=true;for(const texture of loaded)texture.dispose();}};
}

const terrainUrls={
  road:new URL('../../asset-pipeline/terrain-composition/exported/earth-albedo.webp',import.meta.url).href,
  forest:new URL('../../asset-pipeline/terrain-composition/exported/forest-albedo.webp',import.meta.url).href,
};
export async function loadTerrainTextures(standards:Standards='baseline',load:(url:string)=>Promise<THREE.Texture>=url=>new THREE.TextureLoader().loadAsync(url)){
 if(standards==='tower-standards'){
  // Bound the complete optional pair, including a stalled forest texture.
  let candidate:OwnedTerrainTextures|undefined;
  try{candidate=await loadTerrainTexturePair({...terrainUrls,road:new URL('../../asset-pipeline/tower-standards/exported/road-albedo.png',import.meta.url).href},url=>boundedCandidate(()=>load(url),texture=>texture.dispose()));}catch{/* pair already owns cleanup */}
  if(candidate){candidate.standardRoad='candidate';return candidate;}
 }
 const fallback=await loadTerrainTexturePair(terrainUrls,load);
 if(fallback)fallback.standardRoad=standards==='baseline'?'baseline':'fallback';
 return fallback;
}
