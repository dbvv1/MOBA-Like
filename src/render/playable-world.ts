import {parseForestScene} from './forest-scene.js';
import {parseMaterialFamily} from './quiet-family.js';
import {createWorld} from './world.js';
import {createCanvasWorld} from './canvas-world.js';
import {parseLightingStyle} from './lighting-style.js';
import type {ContentCatalog} from '../content/types.js';
import type {CameraFollowPolicy} from './camera-follow.js';

/** Initialization only: aborts never trigger a replacement owner. */
export async function createPlayableWorld(host:HTMLElement,catalog:ContentCatalog,options:{search:string;defaultLightingSearch:string;cameraFollow:CameraFollowPolicy;signal:AbortSignal},factories={webgl:createWorld,canvas:createCanvasWorld}){
  const alive=()=>{if(options.signal.aborted)throw new DOMException('World loading cancelled.','AbortError');};
  alive();let reason='';
  const forced=new URLSearchParams(options.search).get('renderer')==='canvas2d';
  if(!forced){
    try{const world=await factories.webgl(host,catalog,{lighting:parseLightingStyle(options.search),materials:parseMaterialFamily(options.search),sceneStyle:parseForestScene(options.search),cameraFollow:options.cameraFollow,signal:options.signal});if(options.signal.aborted){world.dispose();alive();}return {world,backend:'three-webgl2',fallbackReason:'',sceneStyle:parseForestScene(options.search),cameraPolicy:options.cameraFollow};}
    catch(error){alive();reason=error instanceof Error?error.message:String(error);}
    try{const world=await factories.webgl(host,catalog,{lighting:parseLightingStyle(options.defaultLightingSearch),cameraFollow:'baseline',signal:options.signal});if(options.signal.aborted){world.dispose();alive();}return {world,backend:'three-webgl2',fallbackReason:`Candidate renderer unavailable; restored default rendering. ${reason}`,sceneStyle:'baseline' as const,cameraPolicy:'baseline' as const};}
    catch(error){alive();reason+=`; default renderer: ${error instanceof Error?error.message:String(error)}`;}
  }else reason='Canvas2D explicitly selected';
  alive();const world=factories.canvas(host,catalog);
  return {world,backend:'canvas2d',fallbackReason:`Using default Canvas2D recovery rendering; 3D effects and temporary camera follow are unavailable. ${reason}`,sceneStyle:'baseline' as const,cameraPolicy:'baseline' as const};
}
export const MINIMUM_ACCEPTANCE_TICKS=300;
