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
    type Variant=NonNullable<Parameters<typeof createWorld>[2]>;
    const fallbackLighting=()=>parseLightingStyle(options.defaultLightingSearch);
    let keepQuiet=false;
    const attempts=[
      {variant:():Variant=>{
        const lighting=parseLightingStyle(options.search);
        const materials=parseMaterialFamily(options.search),sceneStyle=parseForestScene(options.search);
        keepQuiet=sceneStyle==='forest-verge-v1'&&materials==='quiet-family-v1';
        return {lighting,materials,sceneStyle,cameraFollow:options.cameraFollow};
      },notice:'',failurePrefix:''},
      // A forest-only failure should not silently discard the present quiet materials.
      {enabled:()=>keepQuiet,variant:():Variant=>({lighting:fallbackLighting(),materials:'quiet-family-v1',cameraFollow:'baseline'}),
        notice:'Forest scene unavailable; restored default scene with quiet materials. ',failurePrefix:'; quiet renderer without forest: '},
      {variant:():Variant=>({lighting:fallbackLighting(),cameraFollow:'baseline'}),
        notice:'Candidate renderer unavailable; restored default rendering. ',failurePrefix:'; default renderer: '},
    ];
    for(const attempt of attempts){
      alive();
      if(attempt.enabled&&!attempt.enabled())continue;
      try{
        const variant=attempt.variant();
        const world=await factories.webgl(host,catalog,{...variant,signal:options.signal});
        if(options.signal.aborted){world.dispose();alive();}
        return {world,backend:'three-webgl2',fallbackReason:attempt.notice?attempt.notice+reason:'',sceneStyle:variant.sceneStyle??'baseline',cameraPolicy:variant.cameraFollow??'baseline'};
      }catch(error){alive();reason+=attempt.failurePrefix+(error instanceof Error?error.message:String(error));}
    }
  }else reason='Canvas2D explicitly selected';
  alive();const world=factories.canvas(host,catalog);
  return {world,backend:'canvas2d',fallbackReason:`Using default Canvas2D recovery rendering; 3D effects and temporary camera follow are unavailable. ${reason}`,sceneStyle:'baseline' as const,cameraPolicy:'baseline' as const};
}
export const MINIMUM_ACCEPTANCE_TICKS=300;
