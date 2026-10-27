import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';

export interface CaptureRun {readonly directory:string;readonly runId:string;readonly sourceCommit:string;readonly input:string;}
export function verifyCaptureSource(actual:{sourceCommit?:unknown;sourceDirty?:unknown},expected:{sourceCommit:string;sourceDirty:boolean}){
  if(actual.sourceCommit!==expected.sourceCommit||actual.sourceDirty!==expected.sourceDirty)throw new Error('Capture source does not match this checkout; rebuild or check out the intended fixed source before capture');
}
export function repeatCheckDescription(shot:string,repeat:number,frames:string){
  return `${shot}: ${repeat} runs × ${frames} frames; ${repeat>1?'exact RGBA/state/camera repeat comparison':'single run only; repeat comparison not performed'}`;
}
/** Atomic allocation: even simultaneous identical captures never reuse a root. */
export async function createCaptureRun(outputRoot:string,sourceCommit:string,input:string):Promise<CaptureRun>{
  if(!/^[a-f0-9]{40}$/.test(sourceCommit)||!/^[a-z0-9-]+$/.test(input))throw new Error('Invalid capture run identity');
  await mkdir(outputRoot,{recursive:true});
  const directory=await mkdtemp(join(outputRoot,`run-${sourceCommit.slice(0,12)}-${input}-`));
  return Object.freeze({directory,runId:basename(directory),sourceCommit,input});
}

/** Write-once evidence, including within a run. A duplicate frame is a failure. */
export async function writeCaptureFrame(run:CaptureRun,directory:string,frame:number,png:Uint8Array,metadata:Record<string,unknown>){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(directory)||!Number.isSafeInteger(frame)||frame<0)throw new Error('Invalid capture frame path');
  await mkdir(join(run.directory,directory),{recursive:true});
  const name=String(frame).padStart(5,'0'),file=`${directory}/${name}.png`;
  const entry={...metadata,file,runId:run.runId,runnerSourceCommit:run.sourceCommit,input:run.input};
  await writeFile(join(run.directory,file),png,{flag:'wx'});
  await writeFile(join(run.directory,directory,`${name}.json`),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
  return entry;
}

export async function writeCaptureReport(run:CaptureRun,report:Record<string,unknown>){
  const entry={...report,runId:run.runId,runnerSourceCommit:run.sourceCommit,input:run.input};
  await writeFile(join(run.directory,'report.json'),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
  return entry;
}

/** Fingerprint the actual local static bundle, not only a claimed Git label. */
export async function captureBundleIdentity(directory:string){
  const files:Array<{file:string;sha256:string}>=[];
  const visit=async(relative:string)=>{
    const entries=await readdir(join(directory,relative),{withFileTypes:true});
    for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=relative?`${relative}/${entry.name}`:entry.name;
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile())files.push({file,sha256:createHash('sha256').update(await readFile(join(directory,file))).digest('hex')});
      else throw new Error(`Unsupported capture bundle entry: ${file}`);
    }
  };
  await visit('');
  return {sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}

/** The browser report alone cannot attest a remote build. Compare served bytes
 * against the fixed local artifact before accepting an external capture. */
export async function verifyServedCaptureBundle(bundle:Awaited<ReturnType<typeof captureBundleIdentity>>,read:(file:string)=>Promise<Uint8Array>){
  if(bundle.files.length===0)throw new Error('Capture bundle is empty');
  for(const entry of bundle.files){
    const actual=createHash('sha256').update(await read(entry.file)).digest('hex');
    if(actual!==entry.sha256)throw new Error(`Served capture bundle mismatch: ${entry.file}`);
  }
  return bundle.sha256;
}
