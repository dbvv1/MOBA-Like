import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createCaptureRun,writeCaptureFrame,writeCaptureReport,captureBundleIdentity,verifyCaptureSource,repeatCheckDescription,verifyServedCaptureBundle,captureLeaseOptions,acquireCaptureLease,createCaptureLifecycle,observeCaptureProcess,captureBrowserExitState,createCaptureBrowserCloser,captureSpawnEvidence,capturePortState,closeCapturePreview,publicCaptureError} from '../tools/capture-output.js';
const temporary:string[]=[];
async function output(){const path=await mkdtemp(join(tmpdir(),'moba-capture-output-'));temporary.push(path);return path;}
afterEach(async()=>{for(const path of temporary.splice(0))await rm(path,{recursive:true,force:true});});
const commit='a'.repeat(40),bundle='c'.repeat(64),camera='spawn-software-seed1-frame600-r1';
const bytes=(value:string)=>Buffer.from(value);
describe('capture evidence isolation',()=>{
  it('keeps CSS capture dimensions fixed for the existing canvas screenshot consumer',async()=>{const html=await readFile(new URL('../capture.html',import.meta.url),'utf8');expect(html).toContain('#capture-stage{width:1280px;height:720px}');expect(html).toContain('#capture-stage canvas{display:block;width:1280px;height:720px}');});
  it('requires the served source identity on local and external consumers',()=>{
    const expected={sourceCommit:commit,sourceDirty:false};expect(()=>verifyCaptureSource({...expected},expected)).not.toThrow();
    expect(()=>verifyCaptureSource({sourceCommit:'b'.repeat(40),sourceDirty:false},expected)).toThrow('source');
    expect(()=>verifyCaptureSource({sourceCommit:commit,sourceDirty:true},expected)).toThrow('source');
    expect(()=>verifyCaptureSource({},expected)).toThrow('source');
  });
  it('does not claim an exact repetition check for a single run',()=>{expect(repeatCheckDescription('spawn',1,'3')).toContain('not performed');expect(repeatCheckDescription('spawn',2,'3')).toContain('exact RGBA');});
  it('keeps a three-frame before run intact when the same output gets a one-frame after run',async()=>{
    const root=await output(),before=await createCaptureRun(root,commit,'march');
    for(let frame=0;frame<3;frame++)await writeCaptureFrame(before,camera,frame,bytes(`before-${frame}`),{sourceCommit:commit,bundleSha256:bundle});
    await writeCaptureReport(before,{passed:true,frames:3,bundle:{sha256:bundle}});
    const original=await readFile(join(before.directory,'report.json'));
    const after=await createCaptureRun(root,commit,'march');
    await writeCaptureFrame(after,camera,0,bytes('after-0'),{sourceCommit:commit,bundleSha256:bundle});
    await writeCaptureReport(after,{passed:true,frames:1,bundle:{sha256:bundle}});
    expect(before.runId).not.toBe(after.runId);
    expect(await readFile(join(before.directory,camera,'00000.png'),'utf8')).toBe('before-0');
    expect(await readFile(join(before.directory,camera,'00002.png'),'utf8')).toBe('before-2');
    expect(await readFile(join(before.directory,'report.json'))).toEqual(original);
    expect((await readdir(join(after.directory,camera))).sort()).toEqual(['00000.json','00000.png']);
    expect(await readdir(root)).toHaveLength(2);
  });
  it('retains actual bundle/source/input identities across revisions and input changes',async()=>{
    const root=await output(),old=await createCaptureRun(root,commit,'idle'),nextCommit='b'.repeat(40),next=await createCaptureRun(root,nextCommit,'march');
    await writeCaptureFrame(old,camera,0,bytes('old'),{sourceCommit:commit,bundleSha256:bundle});
    const nextBundle='d'.repeat(64);
    await writeCaptureFrame(next,camera,0,bytes('new'),{sourceCommit:nextCommit,bundleSha256:nextBundle});
    await writeCaptureReport(next,{sourceCommit:nextCommit,bundle:{sha256:nextBundle}});
    const frame=JSON.parse(await readFile(join(next.directory,camera,'00000.json'),'utf8')),report=JSON.parse(await readFile(join(next.directory,'report.json'),'utf8'));
    expect(frame).toMatchObject({sourceCommit:nextCommit,runnerSourceCommit:nextCommit,bundleSha256:nextBundle,input:'march',runId:next.runId});
    expect(report).toMatchObject({sourceCommit:nextCommit,runnerSourceCommit:nextCommit,bundle:{sha256:nextBundle},input:'march',runId:next.runId});
    expect(JSON.parse(await readFile(join(old.directory,camera,'00000.json'),'utf8'))).toMatchObject({sourceCommit:commit,bundleSha256:bundle,input:'idle',runId:old.runId});
  });
  it('allocates exclusive roots for concurrent identical parameters',async()=>{
    const root=await output(),runs=await Promise.all(Array.from({length:8},()=>createCaptureRun(root,commit,'march')));
    expect(new Set(runs.map(run=>run.directory)).size).toBe(8);
    await Promise.all(runs.map(async(run,index)=>{await writeCaptureFrame(run,camera,0,bytes(String(index)),{});await writeCaptureReport(run,{index});}));
    for(const [index,run] of runs.entries())expect(await readFile(join(run.directory,camera,'00000.png'),'utf8')).toBe(String(index));
  });
  it('refuses duplicate frames and reports instead of overwriting evidence',async()=>{
    const run=await createCaptureRun(await output(),commit,'march');
    await writeCaptureFrame(run,camera,0,bytes('original'),{});await writeCaptureReport(run,{passed:true});
    await expect(writeCaptureFrame(run,camera,0,bytes('replacement'),{})).rejects.toMatchObject({code:'EEXIST'});
    await expect(writeCaptureReport(run,{passed:false})).rejects.toMatchObject({code:'EEXIST'});
    expect(await readFile(join(run.directory,camera,'00000.png'),'utf8')).toBe('original');
    expect(JSON.parse(await readFile(join(run.directory,'report.json'),'utf8')).passed).toBe(true);
  });
  it('rejects invalid identity and relative-path escape',async()=>{
    const root=await output();await expect(createCaptureRun(root,'bad','march')).rejects.toThrow('identity');await expect(createCaptureRun(root,commit,'../idle')).rejects.toThrow('identity');
    const run=await createCaptureRun(root,commit,'march');await expect(writeCaptureFrame(run,'../escape',0,bytes('bad'),{})).rejects.toThrow('path');
  });
  it('fingerprints actual static bundle bytes and detects changed content',async()=>{
    const root=await output();await mkdir(join(root,'assets'));await writeFile(join(root,'capture.html'),'entry');await writeFile(join(root,'assets','capture.js'),'before');
    const first=await captureBundleIdentity(root);await writeFile(join(root,'capture-bundle.json'),'self-describing manifest is excluded');expect(await captureBundleIdentity(root)).toEqual(first);expect(first.files.map(file=>file.file)).toEqual(['assets/capture.js','capture.html']);
    await writeFile(join(root,'assets','capture.js'),'after');const second=await captureBundleIdentity(root);expect(second.sha256).not.toBe(first.sha256);expect(second.files[1]).toEqual(first.files[1]);
  });
  it('rejects mismatched, missing or unknown served bundles even with an expected source label',async()=>{
    const root=await output();await writeFile(join(root,'capture.html'),'entry');await writeFile(join(root,'capture.js'),'expected-js');const expected=await captureBundleIdentity(root);
    expect(await verifyServedCaptureBundle(expected,file=>readFile(join(root,file)))).toBe(expected.sha256);
    await expect(verifyServedCaptureBundle(expected,async()=>bytes('different served build'))).rejects.toThrow('mismatch');
    await expect(verifyServedCaptureBundle(expected,async()=>{throw new Error('HTTP 404');})).rejects.toThrow('404');
    await expect(verifyServedCaptureBundle({sha256:'unknown',files:[]},async()=>bytes(''))).rejects.toThrow('empty');
  });
});

const noResources={browser:'not-started',preview:'not-started',knownUnclosedResources:0} as const;
describe('capture ownership and lifecycle receipts (CPU only)',()=>{
  it('requires an explicit stable root/task pair for GPU and refuses malformed input',()=>{
    expect(captureLeaseOptions(undefined,undefined,false)).toBeNull();
    expect(()=>captureLeaseOptions(undefined,undefined,true)).toThrow('needs');
    for(const [root,task] of [['relative','task'],['/stable',undefined],[undefined,'task'],['/stable','../escape'],['/stable','']])expect(()=>captureLeaseOptions(root,task,true)).toThrow();
  });
  it('does not create a missing stable lease root',async()=>{
    const root=await output();await expect(acquireCaptureLease(join(root,'missing'),'task','run-a')).rejects.toMatchObject({code:'ENOENT'});
    expect(await readdir(root)).toEqual([]);
  });
  it('uses one lock for different task IDs and never steals an existing owner',async()=>{
    const root=await output(),lease=await acquireCaptureLease(root,'task-a','run-a'),path=join(root,'capture.lock','owner.json'),original=await readFile(path,'utf8');
    await expect(acquireCaptureLease(root,'task-b','run-b')).rejects.toMatchObject({code:'EEXIST'});
    expect(await readFile(path,'utf8')).toBe(original);expect(JSON.stringify(lease.owner)).not.toContain(JSON.parse(original).nonce);
    expect(await lease.release(noResources)).toMatchObject({released:true,ownerMatched:true});expect(await readdir(root)).toEqual([]);
    await expect(lease.release(noResources)).rejects.toThrow('already');
  });
  it('compares the privately held nonce exactly, not just its format',async()=>{
    const root=await output(),lease=await acquireCaptureLease(root,'task','run'),path=join(root,'capture.lock','owner.json');
    const owner=JSON.parse(await readFile(path,'utf8'));owner.nonce='0'.repeat(48);await writeFile(path,JSON.stringify(owner));
    await expect(lease.release(noResources)).rejects.toThrow('mismatch');expect(JSON.parse(await readFile(path,'utf8')).nonce).toBe(owner.nonce);
  });
  it('rejects changed owner identity even when the nonce is unchanged',async()=>{
    const root=await output(),lease=await acquireCaptureLease(root,'task','run'),path=join(root,'capture.lock','owner.json');
    const owner=JSON.parse(await readFile(path,'utf8'));owner.pid++;await writeFile(path,JSON.stringify(owner));
    await expect(lease.release(noResources)).rejects.toThrow('mismatch');expect(await readdir(join(root,'capture.lock'))).toEqual(['owner.json']);
  });
  it('keeps malformed/missing owners and unexpected files instead of recursively deleting',async()=>{
    for(const mode of ['malformed','missing','extra']){
      const root=await output(),lease=await acquireCaptureLease(root,'task','run'),path=join(root,'capture.lock','owner.json');
      if(mode==='malformed')await writeFile(path,'not json');else if(mode==='missing')await rm(path);else await writeFile(join(root,'capture.lock','foreign'),'keep');
      await expect(lease.release(noResources)).rejects.toThrow();expect(await readdir(root)).toEqual(['capture.lock']);
    }
  });
  it('retains the lease for unknown launch/preview outcomes or any known unclosed resource',async()=>{
    const root=await output(),lease=await acquireCaptureLease(root,'task','run');
    for(const evidence of [{...noResources,browser:'unknown' as const},{...noResources,preview:'unknown' as const},{...noResources,knownUnclosedResources:1}])expect(await lease.release(evidence)).toMatchObject({released:false,ownerMatched:null});
    expect(await readdir(root)).toEqual(['capture.lock']);
    expect(await lease.release({...noResources,browser:'owned-handles-closed',preview:'closed-port-refused'})).toMatchObject({released:true,ownerMatched:true});
  });
  it('leaves separate write-once lifecycle events for every run, including failed starts',async()=>{
    const root=await output(),first=await createCaptureRun(root,commit,'idle'),second=await createCaptureRun(root,commit,'idle');
    for(const run of [first,second]){const record=await createCaptureLifecycle(run);await record('browser-start-requested',{headless:true});await record('browser-close-observed',{state:'unknown'});expect(await readdir(join(run.directory,'lifecycle'))).toEqual(['0001-browser-start-requested.json','0002-browser-close-observed.json']);}
    await expect(createCaptureLifecycle(first)).rejects.toMatchObject({code:'EEXIST'});
  });
  it('records exit on an owned real Node child, with no browser or OS PID lookup',async()=>{
    const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),30)'],{stdio:'ignore'}),observed=observeCaptureProcess(child);
    expect(observed.pid).toBe(child.pid);expect(observed.exit).toBeNull();await once(child,'close');
    expect(observed.exit).toMatchObject({code:0,signal:null,source:'ChildProcess-exit-event'});expect(observed.identitySource).toBe('owned-ChildProcess-handle');
    expect(observeCaptureProcess(child).exit).toMatchObject({source:'already-exited-ChildProcess'});
  });
  it('records abnormal/signal exit without converting it to a normal exit',async()=>{
    const failed=spawn(process.execPath,['-e','process.exit(3)'],{stdio:'ignore'}),failure=observeCaptureProcess(failed);await once(failed,'close');expect(failure.exit?.code).toBe(3);
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),observed=observeCaptureProcess(child);child.kill('SIGTERM');await once(child,'close');
    expect(observed.exit?.signal).toBe('SIGTERM');expect(observed.exit?.code).toBeNull();
  });
  it('shares one signal/finally close and interrupts a pending operation immediately (CPU stub)',async()=>{
    let connected=true,unblock!:()=>void;const pending=new Promise<void>(resolve=>{unblock=resolve;});
    const browser={close:vi.fn(async()=>{await pending;connected=false;}),isConnected:()=>connected};
    const server={close:vi.fn(async()=>{unblock();})},close=createCaptureBrowserCloser(()=>({browser,server}));
    const signalClose=close();expect(close()).toBe(signalClose);
    expect(await signalClose).toMatchObject({serverClosed:true,connectionClosed:true,errors:[]});
    expect(browser.close).toHaveBeenCalledTimes(1);expect(server.close).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging owned close, reports unknown and does not retry or force-kill',async()=>{
    const server={close:vi.fn(()=>new Promise<void>(()=>{}))},close=createCaptureBrowserCloser(()=>({server}),10);
    expect(await close()).toMatchObject({serverClosed:null,errors:['owned browser close timeout']});await close();expect(server.close).toHaveBeenCalledTimes(1);
  });
  it('does not cache a pre-handle signal as proof that a later launch was cleaned up',async()=>{
    let server:undefined|{close:()=>Promise<void>};const close=createCaptureBrowserCloser(()=>({server}));
    expect((await close()).serverClosed).toBeNull();server={close:vi.fn(async()=>{})};
    expect((await close()).serverClosed).toBe(true);expect(server.close).toHaveBeenCalledTimes(1);
  });
  it('retains a failed close result instead of retrying or declaring success',async()=>{
    const server={close:vi.fn(async()=>{throw new Error('stub close failure');})},close=createCaptureBrowserCloser(()=>({server}));
    expect(await close()).toMatchObject({serverClosed:false,errors:['BrowserServer close']});await close();expect(server.close).toHaveBeenCalledTimes(1);
  });
  it('never treats a failed close, disconnect-only, abnormal exit or missing handle as safe cleanup',()=>{
    const process={pid:123,parentPid:12,registeredAt:'observed',identitySource:'owned-ChildProcess-handle',exit:{code:0,signal:null,observedAt:'observed',source:'ChildProcess-exit-event'}};
    expect(captureBrowserExitState(false,null,true,undefined)).toBe('not-started');
    expect(captureBrowserExitState(true,true,true,process)).toBe('owned-handles-closed');
    for(const [closed,connected,evidence] of [[false,true,process],[true,false,process],[true,true,undefined],[true,true,{...process,exit:null}],[true,true,{...process,exit:{...process.exit,code:1}}]] as const)expect(captureBrowserExitState(true,closed,connected,evidence)).toBe('unknown');
  });
  it('propagates preview close failure rather than certifying a port cleanup',async()=>{
    const server=createServer();vi.spyOn(server,'close').mockImplementation(callback=>{callback?.(new Error('test-close-failure'));return server;});
    await expect(closeCapturePreview(server,12345)).rejects.toThrow('test-close-failure');
  });
  it('publishes allowlisted actual flags and executable classification, never paths or argv',()=>{
    const evidence=captureSpawnEvidence({spawnfile:'/private/browser',spawnargs:['/private/browser','--headless=new','--user-data-dir=/private/profile','--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader','--use-angle=/private/custom']},'/private/browser');
    expect(evidence).toMatchObject({source:'ChildProcess.spawnargs',executable:'playwright-bundled',headless:true,noSandbox:true,disableSetuidSandbox:true,unsafeSwiftshader:true,useAngle:'other'});expect(JSON.stringify(evidence)).not.toContain('/private');expect(JSON.stringify(evidence)).not.toContain('user-data-dir');
    expect(captureSpawnEvidence({spawnfile:'/custom',spawnargs:['/custom']},'/bundled','/custom').executable).toBe('explicit-path');
  });
  it('redacts websocket connection capabilities and known private paths from errors',()=>{
    expect(publicCaptureError(new Error('connect ws://127.0.0.1:1234/private-capability failed /private/root'),['/private/root'])).toBe('connect <browser-endpoint> failed <private-path>');
  });
  it('bounds a hung preview close without certifying that its listener has exited',async()=>{
    const server=createServer();vi.spyOn(server,'close').mockImplementation(()=>server);
    await expect(closeCapturePreview(server,12345,10)).rejects.toThrow('preview close timeout');
  });
  it('records and closes only the actual owned HTTP port, then observes refusal',async()=>{
    const server=createServer((_req,res)=>res.end('test'));server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');
    try{expect(await capturePortState(address.port)).toBe('listening');expect(await closeCapturePreview(server,address.port)).toMatchObject({pid:process.pid,port:address.port,listening:false,portState:'refused',exitProven:true});}finally{server.close();}
  });
  it('does not close a new holder if the recorded preview port has been reused',async()=>{
    const server=createServer((_req,res)=>res.end('own')),replacement=createServer((_req,res)=>res.end('replacement'));server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');
    const original=server.close.bind(server);
    vi.spyOn(server,'close').mockImplementation(callback=>original(error=>{if(error){callback?.(error);return;}replacement.listen(address.port,'127.0.0.1',()=>callback?.());}));
    try{expect(await closeCapturePreview(server,address.port)).toMatchObject({listening:false,portState:'listening',exitProven:false});expect(replacement.listening).toBe(true);}finally{await new Promise<void>(resolve=>replacement.close(()=>resolve()));}
  });
  it('uses supported BrowserServer process ownership and preserves lighting and exact repeat checks',async()=>{
    const source=await readFile(new URL('../tools/capture.mjs',import.meta.url),'utf8');
    expect(source).toContain('chromium.launchServer(launch)');expect(source).toContain('browserServer.process()');expect(source).not.toContain('browser.process()');
    expect(source).toContain('await closeOwnedBrowser()');expect(source).toContain('chromium.connect(browserServer.wsEndpoint())');expect(source).toContain("host:'127.0.0.1'");
    expect(source).toContain("!values.software||values['require-gpu']");expect(source).toContain('parseLightingStyle');expect(source).toContain('lighting,shot,seed:values.seed');expect(source).toContain('assert.deepEqual(comparable,baseline[frame]');
  });
});
