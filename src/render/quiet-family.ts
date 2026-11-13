import * as THREE from 'three';
import layout from '../../asset-pipeline/terrain-composition/source/layout.json';
import {roadCrossSection} from './terrain-composition.js';

export type MaterialFamily='baseline'|'quiet-family-v1';
/** A cosmetic opt-in never changes gameplay, legacy, or malformed-query defaults. */
export function parseMaterialFamily(search:string):MaterialFamily{
  const values=new URLSearchParams(search).getAll('materials');
  return values.length===1&&values[0]==='quiet-family-v1'?'quiet-family-v1':'baseline';
}
export type QuietTextures={road:THREE.Texture;forest:THREE.Texture;wall:THREE.Texture;lane?:THREE.Texture|undefined;dispose():void};
/** Read actual owned resources and successful frame submission, never just the URL. */
export function inspectMaterialFamily(requested:MaterialFamily,textures:QuietTextures|undefined,frameSubmitted:boolean,contextLost:boolean){
  const configured:MaterialFamily=textures?'quiet-family-v1':'baseline';
  return {requested,configured,active:frameSubmitted&&!contextLost&&requested===configured?configured:null};
}
/** Low-frequency, large-block limestone surface. No per-pixel speckle: the
 * road reads as broad worn slabs rather than a noisy tile. */
export function createLaneSurfaceTexture():THREE.Texture|undefined{
  if(typeof document==='undefined')return undefined;
  try{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const context=canvas.getContext('2d');if(!context)return undefined;
    context.fillStyle='#c8bf98';context.fillRect(0,0,512,512);
    const palette=['#d8d0ad','#bdb38c','#aaa17c','#d1c7a1','#c3b992','#b4aa84'];
    let seed=0x9e3779b9;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<18;i++){
      const cx=random()*512,cy=random()*512,radius=58+random()*126,points=6+Math.floor(random()*4);
      const outline:Array<[number,number]>=[];
      for(let point=0;point<points;point++){
        const angle=point/points*Math.PI*2,reach=radius*(.58+random()*.5);
        outline.push([Math.cos(angle)*reach,Math.sin(angle)*reach]);
      }
      context.fillStyle=palette[Math.floor(random()*palette.length)]!;
      context.globalAlpha=.22+random()*.36;
      // Draw wrapped copies so the low-frequency slab faces do not cut at tile seams.
      for(const ox of [-512,0,512])for(const oy of [-512,0,512]){
        context.beginPath();
        outline.forEach(([dx,dy],index)=>{const x=cx+ox+dx,y=cy+oy+dy;if(index===0)context.moveTo(x,y);else context.lineTo(x,y);});
        context.closePath();context.fill();
      }
    }
    context.globalAlpha=1;
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;
    texture.needsUpdate=true;return texture;
  }catch{return undefined;}
}
export async function loadQuietFamily(mode:MaterialFamily,load:(url:string)=>Promise<THREE.Texture>=url=>new THREE.TextureLoader().loadAsync(url),signal?:AbortSignal):Promise<QuietTextures|undefined>{
  if(mode!=='quiet-family-v1'||signal?.aborted)return undefined;
  const urls=[new URL('../../asset-pipeline/quiet-family/exported/earth.webp',import.meta.url).href,new URL('../../asset-pipeline/quiet-family/exported/forest.webp',import.meta.url).href,new URL('../../asset-pipeline/quiet-family/exported/wall.webp',import.meta.url).href];
  const owned:THREE.Texture[]=[];
  try{for(const url of urls){const texture=await load(url);owned.push(texture);if(signal?.aborted)throw new Error('cancelled');texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;}
    const lane=createLaneSurfaceTexture();if(lane)owned.push(lane);
  }
  catch{for(const texture of new Set(owned))texture.dispose();return undefined;}
  let disposed=false;return {road:owned[0]!,forest:owned[1]!,wall:owned[2]!,lane:owned[3],dispose(){if(disposed)return;disposed=true;for(const texture of new Set(owned))texture.dispose();}};
}
/** Distance is positive on the road. Match the exact sampled straight mesh edge,
 * not a fresh sine curve between vertices, so the two ground meshes agree. */
export function roadDistance(x:number,z:number){
  if(x<layout.world.minX||x>layout.world.maxX)return -90;
  const left=Math.min(layout.world.maxX-layout.road.sampleMeters,Math.floor((x-layout.world.minX)/layout.road.sampleMeters)*layout.road.sampleMeters+layout.world.minX),t=(x-left)/layout.road.sampleMeters;
  const a=roadCrossSection(left),b=roadCrossSection(left+layout.road.sampleMeters);
  return Math.min(z-(a.south+(b.south-a.south)*t),a.north+(b.north-a.north)*t-z);
}
export const ROAD_SURFACE_Y=0;
export const SHOULDER_HEIGHT=0.30;
export const SHOULDER_FALLOFF=3.4;
/** A low-frequency, unequal grass shoulder. The crest and the band width only
 * ever move outward from the lane, so the 7 m walkable strip stays untouched. */
export function roadShoulderWidth(x:number){
  return 2.30+0.90*Math.sin(x*0.043+0.4)+0.42*Math.sin(x*0.121+2.2)+0.16*Math.sin(x*0.287+1.1);
}
export function shoulderBankHeight(x:number,outward:number){
  if(outward<=0)return ROAD_SURFACE_Y;
  const width=roadShoulderWidth(x);
  if(outward<width){const t=outward/width;return ROAD_SURFACE_Y+(SHOULDER_HEIGHT-ROAD_SURFACE_Y)*t*t*(3-2*t);}
  const t=Math.min(1,(outward-width)/SHOULDER_FALLOFF);
  return SHOULDER_HEIGHT*(1-t*t*(3-2*t));
}
export function groundHeightAt(x:number,z:number){
  const distance=roadDistance(x,z);
  return distance>=0?ROAD_SURFACE_Y:shoulderBankHeight(x,-distance);
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
}
float quietShoulder(float x){
 return max(0.85,${f(2.3)}+${f(0.9)}*sin(x*${f(0.043)}+${f(0.4)})+${f(0.42)}*sin(x*${f(0.121)}+${f(2.2)})+${f(0.16)}*sin(x*${f(0.287)}+${f(1.1)}));
}
float quietHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float quietNoise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(quietHash(i),quietHash(i+vec2(1.0,0.0)),f.x),
            mix(quietHash(i+vec2(0.0,1.0)),quietHash(i+vec2(1.0,1.0)),f.x),f.y);
}`;
/** Installed once on the surface's existing owned material. Textures remain
 * owned by the world; the hook does not allocate during draw. The three zones
 * and their broad mottling are evaluated in world space so separately meshed
 * road/forest/shoulder surfaces cannot expose a tile seam. */
export function bindQuietGround(material:THREE.Material,textures:QuietTextures){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms['quietRoad']={value:textures.road};shader.uniforms['quietForest']={value:textures.forest};
    shader.uniforms['quietLane']={value:textures.lane??textures.road};
    shader.uniforms['quietGrassColor']={value:new THREE.Color('#607c52')};
    shader.uniforms['quietForestColor']={value:new THREE.Color('#304a3a')};
    shader.vertexShader='varying vec2 vQuietWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvQuietWorld=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader='varying vec2 vQuietWorld;uniform sampler2D quietRoad;uniform sampler2D quietForest;uniform sampler2D quietLane;uniform vec3 quietGrassColor;uniform vec3 quietForestColor;\n'+edgeFunction+`\nvec3 quietGround(vec2 p){
 float d=quietDistance(p);
 float width=quietShoulder(p.x);
 float road=smoothstep(-0.38,0.04,d);
 float grass=smoothstep(-width-1.05,-width+0.35,d);
 float broad=quietNoise(p*0.031+vec2(3.7,8.1))*0.55+quietNoise(p*0.085+vec2(11.3,7.1))*0.30+quietNoise(p*0.21+vec2(2.4,5.9))*0.15;
 vec3 lane=texture2D(quietLane,p/23.0).rgb*0.68+texture2D(quietLane,p/41.0+vec2(0.31,0.67)).rgb*0.32;
 lane*=0.93+(quietNoise(p*0.026+vec2(9.2,1.7))-0.5)*0.18;
 vec3 shoulder=mix(quietForestColor,quietGrassColor,grass);
 vec3 color=mix(shoulder,lane,road);
 float mottle=1.0+(broad-0.5)*mix(0.24,0.10,road);
 color*=mottle;
 // The authored family still supplies a very low-amplitude tonal wash. At
 // 1% it cannot reintroduce the old high-frequency flecks.
 float quietEdge=smoothstep(-0.4,0.4,quietDistance(vQuietWorld));
 vec4 quietEarth=texture2D(quietRoad,vQuietWorld/${f(layout.road.tileMeters)});
 vec4 quietGreen=texture2D(quietForest,vQuietWorld/${f(layout.forest.tileMeters)});
 color*=1.0+(mix(quietGreen.g,quietEarth.r,quietEdge)-0.5)*0.012;
 return color;
}`+'\n'+shader.fragmentShader;
    // Override after color_fragment so vertex-coloured shoulder inlays also use
    // the shared zone palette instead of multiplying in a second ground colour.
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb=quietGround(vQuietWorld);');
  };
  material.customProgramCacheKey=()=>key.call(material)+'|quiet-ground-v3';material.needsUpdate=true;
}
