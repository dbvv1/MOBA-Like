import {parseStructureStyle} from '../render/structure-style.js';
import {parseLightingStyle} from '../render/lighting-style.js';
import {createWorld} from '../render/world.js';
import {createDetourNavigation} from '../sim/navigation.js';
import {CAPTURE_SIZE,CAMERAS} from './cameras.js';
import {parseCaptureConfig} from './config.js';
import {CaptureLifetime} from './lifetime.js';
import {CaptureSession} from './session.js';
import {rendererEvidence} from './renderer.js';
import {verifyBrowserBundle,type CaptureBuild} from './bundle.js';
import {advanceCaptureFrames,yieldCaptureTask,type FrameAcknowledgment} from './tasks.js';
import {snapshotCapture,captureDownload} from './snapshot.js';
declare const __MOBA_CAPTURE_BUILD__:CaptureBuild;

const host=window as unknown as {__shot?:Record<string,unknown>;__shotNext?:(frame?:number)=>boolean};
const element=<T extends HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
const stage=element('capture-stage'),notice=element('capture-notice'),errorNotice=element('capture-error');
const progress=element<HTMLProgressElement>('capture-progress'),identity=element('capture-identity'),metadataView=element('capture-metadata');
const nextButton=element<HTMLButtonElement>('capture-next'),next15Button=element<HTMLButtonElement>('capture-next-15'),saveButton=element<HTMLButtonElement>('capture-save');
const downloads=element('capture-downloads'),downloadLabel=element('capture-download-label'),pngLink=element<HTMLAnchorElement>('capture-png'),jsonLink=element<HTMLAnchorElement>('capture-json');
const lifetime=new CaptureLifetime(),abort=lifetime.own(new AbortController(),value=>value.abort(new Error('Capture cancelled')));
const urls=new Set<string>();
const clearDownloads=()=>{downloads.hidden=true;for(const url of urls)URL.revokeObjectURL(url);urls.clear();pngLink.removeAttribute('href');jsonLink.removeAttribute('href');};
lifetime.own(null,clearDownloads);
let busy:false|'advance'|'save'=false,sequence=0;
let runId='';
const updateButtons=()=>{
  const ready=host.__shot?.ready===true&&!lifetime.cancelled;
  nextButton.disabled=next15Button.disabled=!ready||!!busy||host.__shot?.complete===true;
  saveButton.disabled=!ready||!!busy;
};
const phase=(name:string,completed?:number,total?:number)=>{
  lifetime.assertActive();notice.textContent=name;
  progress.hidden=false;
  if(completed===undefined||total===undefined)progress.removeAttribute('value');
  else{progress.max=Math.max(total,1);progress.value=total===0?1:completed;}
  host.__shot={ready:false,...__MOBA_CAPTURE_BUILD__,phase:name,progress:{completed,total}};
};
const fail=(error:unknown)=>{
  delete host.__shotNext;host.__shot={...host.__shot,ready:false,error:String(error)};
  notice.textContent='拍摄已停止';errorNotice.hidden=false;errorNotice.textContent=String(error);progress.hidden=true;
  const errors=lifetime.dispose();updateButtons();if(errors.length)console.error('Capture cleanup failed',errors);
};
window.addEventListener('pagehide',()=>fail('Capture cancelled'),{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('keydown',event=>{if(event.key==='Escape')location.assign(new URL('./',location.href).href);});
const action=async(kind:'advance'|'save',work:()=>Promise<void>)=>{
  if(busy||host.__shot?.ready!==true||lifetime.cancelled)return;
  busy=kind;updateButtons();errorNotice.hidden=true;
  try{await work();lifetime.assertActive();}
  catch(error){if(!lifetime.cancelled){errorNotice.hidden=false;errorNotice.textContent=String(error);}}
  finally{busy=false;updateButtons();}
};

try {
  if(!globalThis.crypto?.subtle||typeof crypto.randomUUID!=='function')throw new Error('Capture requires HTTPS or localhost with Web Crypto support');
  runId=crypto.randomUUID();
  phase('检查拍摄参数');
  const config=parseCaptureConfig(location.search),lighting=parseLightingStyle(location.search);
  if(!config)throw new Error(`Choose ?shot=${Object.keys(CAMERAS).join(' | ')}&seed=1&t=10&input=march&frames=120`);
  phase('核对构建文件');
  const bundle=await verifyBrowserBundle(new URL('./',location.href),import.meta.url,__MOBA_CAPTURE_BUILD__,abort.signal,(done,total)=>phase(`核对构建文件 ${done}/${total}`,done,total));
  phase('加载导航数据');
  const response=await fetch(new URL('../sim/nav/lane.navmesh',import.meta.url),{signal:abort.signal});
  if(!response.ok)throw new Error(`Navigation asset failed: HTTP ${response.status}`);
  phase('初始化导航');
  const navigation=lifetime.own(await createDetourNavigation(new Uint8Array(await response.arrayBuffer())),value=>value.destroy());
  const session=new CaptureSession(config,navigation,lifetime);
  phase('创建 WebGL 场景与加载模型/纹理');
  await yieldCaptureTask(abort.signal);
  const world=lifetime.own(await createWorld(stage,session.sim.catalog,{lighting,structures:parseStructureStyle(location.search)}),value=>value.dispose());
  world.setCaptureView({...CAPTURE_SIZE,pixelRatio:1,pose:CAMERAS[config.shot].pose});
  const gl=world.captureContext(),evidence=rendererEvidence(gl);
  const contextLost=(event:Event)=>{event.preventDefault();fail('WebGL context lost');};
  world.canvas.addEventListener('webglcontextlost',contextLost);
  lifetime.own(null,()=>world.canvas.removeEventListener('webglcontextlost',contextLost));
  const publish=()=>{
    lifetime.assertActive();if(gl.isContextLost())throw new Error('WebGL context lost');gl.finish();
    host.__shot=Object.freeze({ready:true,...__MOBA_CAPTURE_BUILD__,bundleSha256:bundle.sha256,bundle,...session.metadata,...evidence,...world.captureState(),backend:'three-webgl2',audio:'not-captured',hud:'world-bars-only',expectedViewport:CAPTURE_SIZE});
    const frame=session.metadata;
    notice.textContent=`${frame.complete?'已到末帧（done）':'准备就绪'} · 帧 ${frame.frame}/${frame.frames-1} · 虚拟时间 ${frame.t.toFixed(4)} s · tick ${frame.simTick}${frame.frames===1?' · frames=1，推进需在 URL 指定 frames>1':''}`;
    identity.textContent=`${evidence.rendererClass}: ${evidence.renderer} | source ${__MOBA_CAPTURE_BUILD__.sourceCommit}${__MOBA_CAPTURE_BUILD__.sourceDirty?' (dirty)':''} | bundle ${bundle.sha256}`;
    metadataView.textContent=JSON.stringify(host.__shot,null,2);progress.hidden=true;updateButtons();
    return host.__shot;
  };
  await session.prepare(world,()=>yieldCaptureTask(abort.signal),value=>{
    const label=value.phase==='preroll'?`虚拟预推进 ${value.completed}/${value.total} 帧（${(value.virtualFrame/60).toFixed(2)} s）`:`渲染预热 ${value.completed}/${value.total}（虚拟帧 ${value.virtualFrame} 不推进）`;
    phase(label,value.completed,value.total);
  });
  lifetime.assertActive();publish();
  host.__shotNext=(frame?:number)=>{
    if(busy==='save')throw new Error('Capture export in progress; frame acknowledgment is locked');
    const advanced=session.next(world,frame);if(advanced)publish();return advanced;
  };
  const advance=(count:1|15)=>action('advance',async()=>{
    await advanceCaptureFrames(()=>host.__shot as unknown as FrameAcknowledgment,frame=>host.__shotNext!(frame),count,()=>yieldCaptureTask(abort.signal));
  });
  nextButton.addEventListener('click',()=>void advance(1));
  next15Button.addEventListener('click',()=>void advance(15));
  saveButton.addEventListener('click',()=>void action('save',async()=>{
    // No await between renderOnly, the metadata read, and canvas bitmap copy.
    const packet=await snapshotCapture(world,publish,abort.signal);
    const result=await captureDownload(packet,runId,sequence++);
    lifetime.assertActive();clearDownloads();
    for(const [link,blob,extension] of [[pngLink,result.png,'png'],[jsonLink,result.json,'json']] as const){
      const url=URL.createObjectURL(blob);urls.add(url);link.href=url;link.download=`${result.name}.${extension}`;
    }
    downloadLabel.textContent=`已生成帧 ${packet.metadata.frame}（t=${packet.metadata.t}）的 PNG + JSON；若浏览器拦截自动下载，请分别点击：`;
    downloads.hidden=false;pngLink.click();jsonLink.click();
  }));
} catch(error){fail(error);}
