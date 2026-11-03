import * as THREE from 'three';
import layout from '../../asset-pipeline/terrain-composition/source/layout.json';
import {roadCrossSection} from './terrain-composition.js';

export type MaterialFamily='baseline'|'quiet-family-v1';
/** A cosmetic opt-in never changes gameplay, legacy, or malformed-query defaults. */
export function parseMaterialFamily(search:string):MaterialFamily{
  const values=new URLSearchParams(search).getAll('materials');
  return values.length===1&&values[0]==='quiet-family-v1'?'quiet-family-v1':'baseline';
}
export type QuietTextures={road:THREE.Texture;forest:THREE.Texture;wall:THREE.Texture;dispose():void};
export async function loadQuietFamily(mode:MaterialFamily,load:(url:string)=>Promise<THREE.Texture>=url=>new THREE.TextureLoader().loadAsync(url),signal?:AbortSignal):Promise<QuietTextures|undefined>{
  if(mode!=='quiet-family-v1'||signal?.aborted)return undefined;
  const urls=[new URL('../../asset-pipeline/quiet-family/exported/earth.webp',import.meta.url).href,new URL('../../asset-pipeline/quiet-family/exported/forest.webp',import.meta.url).href,new URL('../../asset-pipeline/quiet-family/exported/wall.webp',import.meta.url).href];
  const owned:THREE.Texture[]=[];
  try{for(const url of urls){const texture=await load(url);owned.push(texture);if(signal?.aborted)throw new Error('cancelled');texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;}}
  catch{for(const texture of new Set(owned))texture.dispose();return undefined;}
  let disposed=false;return {road:owned[0]!,forest:owned[1]!,wall:owned[2]!,dispose(){if(disposed)return;disposed=true;for(const texture of new Set(owned))texture.dispose();}};
}
/** Distance is positive on the road. Match the exact sampled straight mesh edge,
 * not a fresh sine curve between vertices, so the two ground meshes agree. */
export function roadDistance(x:number,z:number){
  if(x<layout.world.minX||x>layout.world.maxX)return -90;
  const left=Math.min(layout.world.maxX-layout.road.sampleMeters,Math.floor((x-layout.world.minX)/layout.road.sampleMeters)*layout.road.sampleMeters+layout.world.minX),t=(x-left)/layout.road.sampleMeters;
  const a=roadCrossSection(left),b=roadCrossSection(left+layout.road.sampleMeters);
  return Math.min(z-(a.south+(b.south-a.south)*t),a.north+(b.north-a.north)*t-z);
}
const f=(n:number)=>Number.isInteger(n)?`${n}.0`:String(n);
const edgeFunction=`vec2 quietEdge(float x){
 float center=0.35*sin(x*0.07);
 float south=center-${f(layout.road.halfWidth)}-0.22*sin(x*0.39);
 float north=center+${f(layout.road.halfWidth)}+0.27*sin(x*0.31+1.0);
 ${layout.clearings.map(c=>`{float dx=x-(${f(c.x)});if(abs(dx)<${f(c.radius)}){float r=sqrt(max(0.0,${f(c.radius*c.radius)}-dx*dx));south=min(south,-r);north=max(north,r);}}`).join('\n')}
 float cap=clamp((110.0-abs(x))/2.0,0.0,1.0);return vec2(south,north)*cap;
}
float quietDistance(vec2 p){
 if(p.x < -110.0 || p.x > 110.0)return -90.0;
 float x=min(109.0,floor(p.x));vec2 e=mix(quietEdge(x),quietEdge(x+1.0),p.x-x);
 return min(p.y-e.x,e.y-p.y);
}`;
/** Installed once on the surface's existing owned material. Textures remain
 * owned by the world; the hook does not allocate during draw. */
export function bindQuietGround(material:THREE.Material,textures:QuietTextures){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms['quietRoad']={value:textures.road};shader.uniforms['quietForest']={value:textures.forest};
    shader.vertexShader='varying vec2 vQuietWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvQuietWorld=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader='varying vec2 vQuietWorld;uniform sampler2D quietRoad;uniform sampler2D quietForest;\n'+edgeFunction+'\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec4 quietEarth=texture2D(quietRoad,vQuietWorld/${f(layout.road.tileMeters)});
 vec4 quietGreen=texture2D(quietForest,vQuietWorld/${f(layout.forest.tileMeters)});
 diffuseColor *= mix(quietGreen,quietEarth,smoothstep(-0.4,0.4,quietDistance(vQuietWorld)));`);
  };
  material.customProgramCacheKey=()=>key.call(material)+'|quiet-ground-v1';material.needsUpdate=true;
}
