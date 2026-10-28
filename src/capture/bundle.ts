export interface CaptureBundle {sha256:string;files:Array<{file:string;sha256:string}>;}
export interface CaptureBuild {sourceCommit:string;sourceDirty:boolean;}
export const BUNDLE_MANIFEST='capture-bundle.json';
export async function sha256(bytes:BufferSource){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Validate relative paths before any fetch; never follow manifest URLs off-origin. */
export async function validateBundleManifest(value:unknown,build:CaptureBuild):Promise<CaptureBundle>{
  const entry=value as CaptureBuild&{format?:unknown;bundle?:CaptureBundle};
  if(!entry||entry.format!==1||entry.sourceCommit!==build.sourceCommit||entry.sourceDirty!==build.sourceDirty)throw new Error('Capture bundle source mismatch');
  const bundle=entry.bundle;
  if(!bundle||!Array.isArray(bundle.files)||!bundle.files.length||!/^[a-f0-9]{64}$/.test(bundle.sha256))throw new Error('Invalid capture bundle manifest');
  let previous='';
  for(const item of bundle.files){
    if(typeof item.file!=='string'||!item.file.split('/').every(part=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))||item.file===BUNDLE_MANIFEST||item.file<=previous||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Invalid capture bundle file');
    previous=item.file;
  }
  if(await sha256(new TextEncoder().encode(JSON.stringify(bundle.files)))!==bundle.sha256)throw new Error('Capture bundle manifest digest mismatch');
  return bundle;
}
export async function verifyBrowserBundle(base:URL,moduleUrl:string,build:CaptureBuild,signal:AbortSignal,progress:(completed:number,total:number)=>void):Promise<CaptureBundle>{
  const read=async(file:string)=>{
    const response=await fetch(new URL(file,base),{cache:'no-store',redirect:'error',signal});
    if(!response.ok)throw new Error(`Capture bundle failed: ${file} HTTP ${response.status}`);
    return response;
  };
  const bundle=await validateBundleManifest(await (await read(BUNDLE_MANIFEST)).json(),build);
  if(!bundle.files.some(entry=>new URL(entry.file,base).href===moduleUrl))throw new Error('Running capture module is absent from this bundle; use the dedicated capture build');
  progress(0,bundle.files.length);
  for(const [index,item] of bundle.files.entries()){
    if(await sha256(await (await read(item.file)).arrayBuffer())!==item.sha256)throw new Error(`Capture bundle bytes mismatch: ${item.file}`);
    signal.throwIfAborted();progress(index+1,bundle.files.length);
  }
  return bundle;
}
