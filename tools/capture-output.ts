import {createHash,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,writeFile,rmdir,unlink,lstat} from 'node:fs/promises';
import {basename,join,isAbsolute,resolve} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import type {Server} from 'node:http';
import {createConnection} from 'node:net';
import {performance} from 'node:perf_hooks';

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
      // The manifest describes these bytes; including itself would be circular.
      if(file==='capture-bundle.json')continue;
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile())files.push({file,sha256:createHash('sha256').update(await readFile(join(directory,file))).digest('hex')});
      else throw new Error(`Unsupported capture bundle entry: ${file}`);
    }
  };
  await visit('');files.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
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

// These helpers own only handles created by this invocation. They do not find,
// signal, reclaim, or certify other processes, tasks, or the machine's GPU.
export const captureRunnerIdentity=Object.freeze({pid:process.pid,runtimeStartedAt:new Date(performance.timeOrigin).toISOString()});
export function captureLeaseOptions(root:unknown,task:unknown,required:boolean){
  if(root===undefined&&task===undefined){if(required)throw new Error('Hardware-capable capture needs --lease-root and --task-id');return null;}
  if(typeof root!=='string'||!isAbsolute(root)||typeof task!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(task))throw new Error('Use an absolute --lease-root and a safe --task-id together');
  return {root,task};
}

/** A private nonce stays in this closure and owner.json, never in a receipt.
 * The supplied root must already exist and be shared by every cooperating run.
 * All task IDs compete for ONE lock; there is no stale-lock recovery. */
export async function acquireCaptureLease(root:string,task:string,runId:string){
  captureLeaseOptions(root,task,true);
  if(!(await lstat(root)).isDirectory())throw new Error('Lease root must be an existing directory');
  const directory=join(root,'capture.lock'),owner={task,runId,...captureRunnerIdentity,createdAt:new Date().toISOString(),nonce:randomBytes(24).toString('hex')};
  await mkdir(directory); // EEXIST is a blocker, never a reason to remove a lock.
  await writeFile(join(directory,'owner.json'),JSON.stringify(owner)+'\n',{flag:'wx',mode:0o600});
  let released=false;
  const publicOwner={task,runId,...captureRunnerIdentity,createdAt:owner.createdAt};
  return Object.freeze({owner:Object.freeze(publicOwner),async release(evidence:{browser:'not-started'|'unknown'|'owned-handles-closed';preview:'not-started'|'closed-port-refused'|'unknown';knownUnclosedResources:number}){
    if(released)throw new Error('Lease already released');
    // This is only the exact owned-handle scope, never an OS subtree/GPU claim.
    if(!['not-started','owned-handles-closed'].includes(evidence.browser)||!['not-started','closed-port-refused'].includes(evidence.preview)||evidence.knownUnclosedResources!==0)return {released:false,ownerMatched:null,reason:'owned-resource-exit-unverified'};
    const path=join(directory,'owner.json'),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Lease owner is not the acquired regular file');
    const actual=JSON.parse(await readFile(path,'utf8'));
    if(Object.keys(actual).length!==Object.keys(owner).length||Object.entries(owner).some(([key,value])=>actual[key]!==value))throw Object.assign(new Error('Lease owner mismatch; retained'),{ownerMatched:false});
    const entries=await readdir(directory);
    if(entries.length!==1||entries[0]!=='owner.json')throw new Error('Unexpected lease contents; retained');
    // Cooperative holders never replace/remove another holder's directory.
    // Deliberately no recursive deletion, process-name cleanup or stale reclaim.
    try{await unlink(path);await rmdir(directory);}catch{throw Object.assign(new Error('Lease removal unconfirmed'),{ownerMatched:true});}released=true;
    return {released:true,ownerMatched:true,reason:'owned-handles-closed-or-not-started'};
  }});
}

/** Sequential write-once events survive a later report/cleanup failure. */
export async function createCaptureLifecycle(run:CaptureRun){
  const directory=join(run.directory,'lifecycle');await mkdir(directory);
  let sequence=0;
  return async(event:string,details:Record<string,unknown>)=>{
    if(!/^[a-z][a-z-]*$/.test(event))throw new Error('Invalid lifecycle event');
    const entry={sequence:++sequence,event,observedAt:new Date().toISOString(),runId:run.runId,...details};
    await writeFile(join(directory,`${String(sequence).padStart(4,'0')}-${event}.json`),JSON.stringify(entry,null,2)+'\n',{flag:'wx'});
    return entry;
  };
}

/** Node's spawned ChildProcess is the identity, not a later PID lookup.
 * registeredAt is observation time, NOT a fabricated OS process birth time. */
export function observeCaptureProcess(child:ChildProcess){
  if(!Number.isInteger(child.pid)||!child.pid)throw new Error('Browser process handle has no PID');
  const evidence:{pid:number;parentPid:number;registeredAt:string;identitySource:string;exit:null|{code:number|null;signal:NodeJS.Signals|null;observedAt:string;source:string}}={pid:child.pid,parentPid:process.pid,registeredAt:new Date().toISOString(),identitySource:'owned-ChildProcess-handle',exit:null};
  const record=(code:number|null,signal:NodeJS.Signals|null,source:string)=>{evidence.exit??={code,signal,observedAt:new Date().toISOString(),source};};
  child.once('exit',(code,signal)=>record(code,signal,'ChildProcess-exit-event'));
  if(child.exitCode!==null||child.signalCode!==null)record(child.exitCode,child.signalCode,'already-exited-ChildProcess');
  return evidence;
}

export function captureBrowserExitState(launchRequested:boolean,serverClosed:boolean|null,connectionClosed:boolean,process:ReturnType<typeof observeCaptureProcess>|undefined){
  if(!launchRequested)return 'not-started';
  return serverClosed===true&&connectionClosed&&process?.exit?.code===0&&process.exit.signal===null?'owned-handles-closed':'unknown';
}

interface CaptureBrowserHandles {
  browser?:{close:()=>Promise<void>;isConnected:()=>boolean};
  server?:{close:()=>Promise<void>};
}
/** Signals and finally share this promise. Closing the owned server promptly
 * interrupts pending page/network operations; no process-name/PID signalling.
 * A request before launch returns a handle is NOT cached as successful cleanup. */
export function createCaptureBrowserCloser(handles:()=>CaptureBrowserHandles,timeoutMs=10000){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new Error('Invalid cleanup observation timeout');
  let closing:Promise<{serverClosed:boolean|null;connectionClosed:boolean;errors:string[]}>|undefined;
  return ()=>{
    if(closing)return closing;
    const current=handles();
    if(!current.server&&!current.browser)return Promise.resolve({serverClosed:null,connectionClosed:true,errors:[]});
    closing=(async()=>{
      const errors:string[]=[];
      // Start both immediately: a hanging connection close must not postpone
      // server.close(), which is what makes pending browser operations reject.
      let timer:ReturnType<typeof setTimeout>|undefined;
      const closed=Promise.allSettled([Promise.resolve().then(()=>current.browser?.close()),Promise.resolve().then(()=>current.server?.close())]);
      const result=await Promise.race([closed,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
      clearTimeout(timer);
      const latest=handles(),connectionClosed=!latest.browser||!latest.browser.isConnected();
      if(!result)return {serverClosed:null,connectionClosed,errors:['owned browser close timeout']};
      const [connection,server]=result;
      if(connection.status==='rejected'&&!connectionClosed)errors.push('browser connection close');
      if(server.status==='rejected')errors.push('BrowserServer close');
      return {serverClosed:current.server?server.status==='fulfilled':null,connectionClosed,errors};
    })();
    return closing;
  };
}

/** Only allowlisted safety facts leave memory; no argv/path/endpoint dump. */
export function captureSpawnEvidence(child:Pick<ChildProcess,'spawnargs'|'spawnfile'>,bundledExecutable:string,explicitExecutable?:string){
  const args=child.spawnargs.slice(1),has=(flag:string)=>args.some(arg=>arg===flag||arg.startsWith(flag+'='));
  const angle=args.find(arg=>arg.startsWith('--use-angle='))?.slice('--use-angle='.length);
  return {source:'ChildProcess.spawnargs',executable:resolve(child.spawnfile)===resolve(bundledExecutable)?'playwright-bundled':explicitExecutable&&resolve(child.spawnfile)===resolve(explicitExecutable)?'explicit-path':'unverified',headless:has('--headless'),headed:has('--headed'),noSandbox:has('--no-sandbox'),disableSetuidSandbox:has('--disable-setuid-sandbox'),unsafeSwiftshader:has('--enable-unsafe-swiftshader'),useAngle:!has('--use-angle')?null:angle&&['swiftshader','d3d11','gl','vulkan','metal'].includes(angle)?angle:'other',software:has('--software')};
}

/** Check this one recorded loopback port only. Never bind or stop its holder. */
export async function capturePortState(port:number):Promise<'refused'|'listening'|'unknown'>{
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid capture port');
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const finish=(state:'refused'|'listening'|'unknown')=>{socket.destroy();resolve(state);};
    socket.once('connect',()=>finish('listening'));socket.once('error',(error:NodeJS.ErrnoException)=>finish(error.code==='ECONNREFUSED'?'refused':'unknown'));socket.setTimeout(1000,()=>finish('unknown'));
  });
}

export async function closeCapturePreview(server:Server,port:number,timeoutMs=10000){
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Owned preview close timeout')),timeoutMs);
    try{server.close(error=>{clearTimeout(timer);error?reject(error):resolve();});server.closeAllConnections();}catch(error){clearTimeout(timer);reject(error);}
  });
  const listening=server.listening,portState=await capturePortState(port);
  return {pid:process.pid,port,closedAt:new Date().toISOString(),listening,portState,exitProven:!listening&&portState==='refused'};
}

/** Connection errors can contain the capability-bearing websocket URL. */
export function publicCaptureError(error:unknown,privatePaths:string[]=[]){
  let message=String(error instanceof Error?error.message:error).replace(/wss?:\/\/[^\s'"<>]+/gi,'<browser-endpoint>');
  for(const path of privatePaths.filter(Boolean).sort((a,b)=>b.length-a.length))message=message.split(path).join('<private-path>');
  return message;
}
