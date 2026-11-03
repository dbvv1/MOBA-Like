import * as THREE from 'three';
import type {BattleAssets} from './battle-assets.js';
import type {QuietTextures} from './quiet-family.js';
import {prepareQuietStone} from './quiet-stone.js';
/** Keep atlas and its UVs. Only explicit source stone triangles receive albedo. */
export function bindQuietStone(material:THREE.Material,wall:THREE.Texture){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);shader.uniforms['quietWall']={value:wall};
    shader.vertexShader='attribute float quietStoneMask;attribute vec3 quietStonePosition;attribute vec3 quietStoneNormal;varying float vQuietStone;varying vec3 vQuietStonePosition;varying vec3 vQuietStoneNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvQuietStone=quietStoneMask;vQuietStonePosition=quietStonePosition/4.0;vQuietStoneNormal=quietStoneNormal;');
    shader.fragmentShader='uniform sampler2D quietWall;varying float vQuietStone;varying vec3 vQuietStonePosition;varying vec3 vQuietStoneNormal;\n'+shader.fragmentShader;
    // map_fragment is retained for every original atlas pixel. Source diffuse
    // multiplier is preserved; replacing the sampled texel avoids double tint.
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
 vec4 sampledDiffuseColor = texture2D( map, vMapUv );
 #ifdef DECODE_VIDEO_TEXTURE
 sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
 #endif
 vec3 quietWeights=pow(abs(vQuietStoneNormal),vec3(4.0));
 quietWeights/=max(dot(quietWeights,vec3(1.0)),0.0001);
 vec4 quietStoneColor=texture2D(quietWall,vQuietStonePosition.yz)*quietWeights.x+texture2D(quietWall,vQuietStonePosition.xz)*quietWeights.y+texture2D(quietWall,vQuietStonePosition.xy)*quietWeights.z;
 diffuseColor *= mix(sampledDiffuseColor,quietStoneColor,step(0.999,vQuietStone));
 #endif`);
  };
  material.customProgramCacheKey=()=>key.call(material)+'|quiet-stone-v1';material.needsUpdate=true;
}
export function applyQuietBuildings(assets:BattleAssets,textures:QuietTextures){
  const releases:Array<()=>void>=[],materials:THREE.Material[]=[],coverage:unknown[]=[];
  try{for(const kind of ['tower','barracks','base'])for(const team of ['teal','rust']){
    const id=`${kind}-${team}`,model=assets.models[id];if(!model)throw new Error(`Missing quiet-family building ${id}`);
    const prepared=prepareQuietStone(model.scene,id);releases.push(()=>prepared.dispose());if(!prepared.meshes.length||!prepared.coverage.length||prepared.coverage.some(c=>c.stoneTriangles===0))throw new Error(`Missing explicit stone coverage ${id}`);coverage.push(...prepared.coverage);
    for(const mesh of prepared.meshes){
      const source=mesh.material;
      const convert=(original:THREE.Material)=>{const material=original.clone();materials.push(material);material.onBeforeCompile=original.onBeforeCompile;material.customProgramCacheKey=original.customProgramCacheKey;bindQuietStone(material,textures.wall);return material;};
      mesh.material=Array.isArray(source)?source.map(convert):convert(source);
      releases.push(()=>{mesh.material=source;});
    }
  }}catch(error){for(const release of releases.reverse())release();for(const material of materials)material.dispose();throw error;}
  let disposed=false;return {coverage,dispose(){if(disposed)return;disposed=true;for(const release of releases.reverse())release();for(const material of materials)material.dispose();}};
}
