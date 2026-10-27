import {createWorld} from '../render/world.js';
import {createDetourNavigation} from '../sim/navigation.js';
import {CAPTURE_SIZE,CAMERAS} from './cameras.js';
import {parseCaptureConfig} from './config.js';
import {CaptureLifetime} from './lifetime.js';
import {CaptureSession} from './session.js';
import {rendererEvidence} from './renderer.js';
declare const __MOBA_CAPTURE_BUILD__:{sourceCommit:string;sourceDirty:boolean};

const host=window as unknown as {__shot?:Record<string,unknown>;__shotNext?:(frame?:number)=>boolean};
const stage=document.querySelector<HTMLElement>('#capture-stage')!,notice=document.querySelector<HTMLElement>('#capture-notice')!;
const lifetime=new CaptureLifetime();
const fail=(error:unknown)=>{delete host.__shotNext;host.__shot={ready:false,error:String(error)};notice.hidden=false;notice.textContent=String(error);const errors=lifetime.dispose();if(errors.length)console.error('Capture cleanup failed',errors);};
window.addEventListener('pagehide',()=>fail('Capture cancelled'),{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('keydown',event=>{if(event.key==='Escape')location.assign(new URL('./',location.href).href);});

try {
  host.__shot={ready:false};
  const config=parseCaptureConfig(location.search);
  if(!config)throw new Error(`Choose ?shot=${Object.keys(CAMERAS).join(' | ')}&seed=1&t=10&input=march`);
  const response=await fetch(new URL('../sim/nav/lane.navmesh',import.meta.url));
  if(!response.ok)throw new Error(`Navigation asset failed: HTTP ${response.status}`);
  const navigation=lifetime.own(await createDetourNavigation(new Uint8Array(await response.arrayBuffer())),value=>value.destroy());
  const session=new CaptureSession(config,navigation,lifetime);
  const world=lifetime.own(await createWorld(stage,session.sim.catalog),value=>value.dispose());
  world.setCaptureView({...CAPTURE_SIZE,pixelRatio:1,pose:CAMERAS[config.shot].pose});
  const gl=world.captureContext(),evidence=rendererEvidence(gl);
  world.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fail('WebGL context lost');});
  const publish=()=>{
    lifetime.assertActive();if(gl.isContextLost())throw new Error('WebGL context lost');gl.finish();
    host.__shot=Object.freeze({ready:true,...__MOBA_CAPTURE_BUILD__,...session.metadata,...evidence,...world.captureState(),backend:'three-webgl2',audio:'not-captured',hud:'world-bars-only',expectedViewport:CAPTURE_SIZE});
  };
  await session.prepare(world,()=>new Promise(resolve=>setTimeout(resolve,0)));
  lifetime.assertActive();notice.hidden=true;publish();
  host.__shotNext=(frame?:number)=>{const advanced=session.next(world,frame);if(advanced)publish();return advanced;};
} catch(error){fail(error);}
