import {CAPTURE_SIZE} from './cameras.js';
import {sha256} from './bundle.js';
export interface CaptureSnapshotSource {
  canvas:Pick<HTMLCanvasElement,'width'|'height'|'toBlob'>;
  renderOnly():void;
}
/** renderOnly + metadata + toBlob are synchronous before the first await.
 * HTML toBlob copies the bitmap before asynchronous encoding; a non-preserved
 * WebGL drawing buffer must not be read after returning to the event loop. */
export function snapshotCapture(source:CaptureSnapshotSource,metadata:()=>Record<string,unknown>,signal:AbortSignal){
  signal.throwIfAborted();
  if(source.canvas.width!==CAPTURE_SIZE.width||source.canvas.height!==CAPTURE_SIZE.height)throw new Error('Capture buffer must be exactly 1280 × 720');
  source.renderOnly();
  const frame=JSON.parse(JSON.stringify(metadata())) as Record<string,unknown>;
  return new Promise<{png:Blob;metadata:Record<string,unknown>}>((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    try{source.canvas.toBlob(blob=>{
      signal.removeEventListener('abort',abort);
      if(signal.aborted){reject(signal.reason);return;}
      if(!blob||blob.type!=='image/png'||!blob.size){reject(new Error('Canvas PNG encoding failed'));return;}
      resolve({png:blob,metadata:frame});
    },'image/png');}catch(error){signal.removeEventListener('abort',abort);reject(error);}
  });
}
export async function captureDownload(packet:Awaited<ReturnType<typeof snapshotCapture>>,runId:string,sequence:number){
  const metadata=packet.metadata;
  const rendererHash=await sha256(new TextEncoder().encode(String(metadata.renderer)));
  const safe=(value:unknown)=>String(value).replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,44);
  const name=`moba-${safe(metadata.shot)}-${safe(metadata.rendererClass)}-${safe(metadata.renderer)}-${rendererHash.slice(0,8)}-seed${safe(metadata.seed)}-${safe(metadata.input)}-vf${safe(metadata.virtualFrame)}-f${safe(metadata.frame)}-${safe(metadata.sourceCommit).slice(0,12)}-${safe(runId)}-${sequence}`;
  const pngSha256=await sha256(await packet.png.arrayBuffer());
  const entry={...metadata,runId,file:`${name}.png`,pngSha256,captureMethod:'webgl-canvas-toBlob-after-renderOnly',image:{width:CAPTURE_SIZE.width,height:CAPTURE_SIZE.height},repeatComparison:'not performed'};
  return {name,png:packet.png,json:new Blob([JSON.stringify(entry,null,2)+'\n'],{type:'application/json'}),metadata:entry};
}
