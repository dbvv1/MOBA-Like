#!/usr/bin/env node
// node --import tsx tools/capture.mjs --software --check-live
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {access} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {PNG} from 'pngjs';
import {CAMERAS,CAPTURE_SIZE} from '../src/capture/cameras.ts';
import {parseCaptureConfig} from '../src/capture/config.ts';
import {parseLightingStyle} from '../src/render/lighting-style.ts';
import {createCaptureRun,writeCaptureFrame,writeCaptureReport,captureBundleIdentity,verifyCaptureSource,repeatCheckDescription,verifyServedCaptureBundle,captureLeaseOptions,acquireCaptureLease,createCaptureLifecycle,observeCaptureProcess,captureBrowserExitState,createCaptureBrowserCloser,captureSpawnEvidence,closeCapturePreview,publicCaptureError} from './capture-output.ts';
const {values}=parseArgs({options:{'lease-root':{type:'string'},'task-id':{type:'string'},lighting:{type:'string',default:'baseline'},base:{type:'string'},out:{type:'string',default:'outputs/capture'},shot:{type:'string',default:'all'},seed:{type:'string',default:'1'},t:{type:'string',default:'10'},input:{type:'string',default:'march'},frames:{type:'string',default:'1'},repeat:{type:'string',default:'2'},software:{type:'boolean',default:false},headed:{type:'boolean',default:false},'require-gpu':{type:'boolean',default:false},'check-live':{type:'boolean',default:false}}});
const leaseOptions=captureLeaseOptions(values['lease-root'],values['task-id'],!values.software||values['require-gpu']);
assert.ok(!(values['require-gpu']&&(values.headed||values['check-live']||process.env.MOBA_CAPTURE_CHROMIUM)),'GPU capture is bundled headless only, without live-input checks');
const lighting=parseLightingStyle(new URLSearchParams({lighting:values.lighting}).toString());
const names=values.shot==='all'?Object.keys(CAMERAS):[values.shot],repeat=Number(values.repeat);
assert.ok(Number.isInteger(repeat)&&repeat>=1&&repeat<=5,'--repeat must be 1–5');
assert.ok(!(values.software&&values['require-gpu']),'--software conflicts with --require-gpu');
if(process.env.MOBA_CAPTURE_CHROMIUM)assert.ok(isAbsolute(process.env.MOBA_CAPTURE_CHROMIUM),'MOBA_CAPTURE_CHROMIUM must be absolute');
for(const shot of names)parseCaptureConfig(new URLSearchParams({shot,seed:values.seed,t:values.t,input:values.input,frames:values.frames}).toString());
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={passed:false,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),shots:[],errors:[],warnings:[],checks:[],qualityAcceptance:'not-performed; capture infrastructure is not lighting/material or player-control approval'};
const output=await createCaptureRun(resolve(values.out),report.sourceCommit,values.input);
report.runId=output.runId;
report.parameters={lighting,shots:names,seed:values.seed,t:values.t,input:values.input,frames:values.frames,repeat};
report.bundle={binding:'unverified',sha256:null};
console.log(`MOBA_CAPTURE_RUN=${output.directory}`);
const record=await createCaptureLifecycle(output);
let browser,browserServer,context,server,previewPort,processEvidence,lease;
let browserState='not-started',previewState='not-started',interrupted=null;
const closeOwnedBrowser=createCaptureBrowserCloser(()=>({browser,server:browserServer}));
const onInterrupt=signal=>{interrupted=signal;void closeOwnedBrowser();};
const onSIGINT=()=>onInterrupt('SIGINT'),onSIGTERM=()=>onInterrupt('SIGTERM'),onSIGHUP=()=>onInterrupt('SIGHUP');
process.on('SIGINT',onSIGINT);process.on('SIGTERM',onSIGTERM);process.on('SIGHUP',onSIGHUP);
const checkInterrupted=()=>{if(interrupted)throw new Error(`Capture interrupted by ${interrupted}`);};
report.execution={scope:'this invocation owned BrowserServer/ChildProcess/connection/preview only',osProcessTree:'not-observed',globalGpuAvailability:'not-assessed'};
try{
  await record('runner-started',{pid:process.pid,task:leaseOptions?.task??null});
  if(leaseOptions){lease=await acquireCaptureLease(leaseOptions.root,leaseOptions.task,output.runId);report.execution.leaseOwner=lease.owner;await record('lease-acquired',{owner:lease.owner});}
  checkInterrupted();
  let base=values.base;
  // Both modes require the intended fixed artifact. External service labels are
  // not sufficient: every expected static file must also match its bytes.
  await access(join(root,'outputs/capture-build/capture.html'));
  report.bundle={binding:'expected-local-static-files',...await captureBundleIdentity(join(root,'outputs/capture-build'))};
  if(!base){
    await record('preview-start-requested',{pid:process.pid});checkInterrupted();previewState='unknown';
    server=await preview({configFile:false,root,build:{outDir:'outputs/capture-build'},preview:{host:'127.0.0.1',port:0,open:false}});
    const address=server.httpServer.address();assert.ok(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}/capture.html`;
    previewPort=address.port;await record('preview-listening',{pid:process.pid,host:'127.0.0.1',port:previewPort,inProcess:true});checkInterrupted();
  }
  const captureURL=new URL(base),allowedOrigin=captureURL.origin;
  assert.match(captureURL.pathname,/\/capture\.html$/,'--base must identify capture.html, not the live player entry');
  const launch={host:'127.0.0.1',handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,headless:!values.headed,chromiumSandbox:true,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',...(values.software?['--use-angle=swiftshader']:[])],...(process.env.MOBA_CAPTURE_CHROMIUM?{executablePath:process.env.MOBA_CAPTURE_CHROMIUM}:{channel:'chromium'})};
  const {executablePath,...publicLaunch}=launch;
  report.launch={...publicLaunch,explicitExecutable:!!executablePath};report.launchEvidence='Requested options; actual allowlisted safety facts are in spawnEvidence. No raw argv/path/endpoint retained.';
  checkInterrupted();await record('browser-start-requested',{launch:report.launch});checkInterrupted();browserState='unknown';
  try{browserServer=await chromium.launchServer(launch);}catch{throw new Error('Browser launch failed; no process handle returned, exit unknown');}
  const child=browserServer.process();processEvidence=observeCaptureProcess(child);
  report.spawnEvidence=captureSpawnEvidence(child,chromium.executablePath(),executablePath);
  await record('browser-process-observed',{process:processEvidence,spawn:report.spawnEvidence});
  assert.equal(report.spawnEvidence.noSandbox,false);assert.equal(report.spawnEvidence.disableSetuidSandbox,false);assert.equal(report.spawnEvidence.unsafeSwiftshader,false);
  if(values['require-gpu']){assert.equal(report.spawnEvidence.headless,true);assert.equal(report.spawnEvidence.headed,false);assert.equal(report.spawnEvidence.software,false);assert.equal(report.spawnEvidence.executable,'playwright-bundled');assert.equal(report.spawnEvidence.useAngle,null);}
  checkInterrupted();
  // The endpoint is an in-memory capability, never part of any receipt or log.
  try{browser=await chromium.connect(browserServer.wsEndpoint());}catch{throw new Error('Browser connection failed; closing the owned BrowserServer');}
  report.browserVersion=browser.version();checkInterrupted();
  context=await browser.newContext({viewport:CAPTURE_SIZE,deviceScaleFactor:1,locale:'en-US',timezoneId:'UTC'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===allowedOrigin?route.continue():route.abort('blockedbyclient'));
  const verifyServed=()=>verifyServedCaptureBundle(report.bundle,async file=>{
    const url=new URL(file.split('/').map(encodeURIComponent).join('/'),new URL('.',captureURL));
    const response=await context.request.get(url.href,{maxRedirects:0});
    assert.equal(response.ok(),true,`Capture bundle file unavailable: ${file} (${response.status()})`);
    return response.body();
  });
  await verifyServed();report.bundle.binding='served-files-verified-against-local-artifact';
  for(const shot of names){
    const baseline=[];
    for(let run=1;run<=repeat;run++){
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')report.warnings.push(message.text());});
      page.on('requestfailed',request=>errors.push(`${request.url()} ${request.failure()?.errorText}`));
      page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
      const url=new URL(captureURL);for(const [key,value] of Object.entries({lighting,shot,seed:values.seed,t:values.t,input:values.input,frames:values.frames}))url.searchParams.set(key,value);
      await page.goto(url.href,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__shot?.ready||window.__shot?.error,null,{timeout:120000});
      assert.equal(await page.evaluate(()=>window.__shot.error),undefined);
      assert.equal(await page.evaluate(()=>typeof window.mobaClient),'undefined','Capture must not create live controls/client');
      const canvas=page.locator('#capture-stage canvas');
      for(let frame=0;frame<Number(values.frames);frame++){
        checkInterrupted();
        const meta=await page.evaluate(()=>window.__shot);
        assert.equal(meta.lighting?.requested,lighting);assert.equal(meta.lighting?.active,lighting);
        assert.equal(meta.ready,true);assert.equal(meta.frame,frame);assert.equal(meta.backend,'three-webgl2');
        assert.deepEqual(meta.viewport,{...CAPTURE_SIZE,pixelRatio:1,bufferWidth:CAPTURE_SIZE.width,bufferHeight:CAPTURE_SIZE.height});
        verifyCaptureSource(meta,report);
        if(values['require-gpu']){assert.equal(meta.rendererClass,'gpu',`Hardware renderer required; raw report: ${meta.renderer}`);assert.equal(meta.unmasked,true);}
        if(frame===0){await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>window.__shot),meta,'Wall time must not advance capture');}
        const png=await canvas.screenshot(),pixels=PNG.sync.read(png),colors=new Set();
        for(let i=0;i<pixels.data.length;i+=16)colors.add(`${pixels.data[i]>>3},${pixels.data[i+1]>>3},${pixels.data[i+2]>>3}`);
        assert.ok(colors.size>32,'Expected rendered environment, not blank/loading pixels');
        const rendererSlug=meta.renderer.replace(/[^a-z0-9]+/gi,'-').slice(0,64).replace(/-$/,'')||'unreported';
        const directory=`${shot}-${meta.rendererClass}-${rendererSlug}-${hash(Buffer.from(meta.renderer)).slice(0,10)}-seed${meta.seed}-frame${meta.virtualFrame-frame}-r${run}`;
        const entry=await writeCaptureFrame(output,directory,frame,png,{run,rgbaSha256:hash(pixels.data),pngSha256:hash(png),...meta,bundleSha256:report.bundle.sha256,bundleBinding:report.bundle.binding});
        report.shots.push(entry);
        const comparable={lighting:meta.lighting,hash:entry.rgbaSha256,stateHash:meta.stateHash,camera:meta.camera,renderer:meta.renderer,t:meta.t};
        if(run===1)baseline.push(comparable);else assert.deepEqual(comparable,baseline[frame],`${shot} frame ${frame} must repeat pixel-identically on the same renderer`);
        assert.equal(await page.evaluate(frame=>window.__shotNext(frame),frame),frame<Number(values.frames)-1);
      }
      assert.deepEqual(errors,[]);await page.close();
    }
    report.checks.push(repeatCheckDescription(shot,repeat,values.frames));
  }
  if(values['check-live']){
    const page=await context.newPage(),url=new URL(captureURL);url.search='?shot=spawn&t=0';
    await page.goto(url.href);await page.waitForFunction(()=>window.__shot?.ready);await page.locator('#capture-exit').click();
    await page.waitForFunction(()=>window.mobaClient?.state().ready);
    assert.equal(await page.evaluate(()=>typeof window.__shot),'undefined');assert.equal(await page.evaluate(()=>typeof window.__shotNext),'undefined');
    const tick=await page.evaluate(()=>window.mobaClient.snapshot().tick);await page.waitForFunction(tick=>window.mobaClient.snapshot().tick>tick+3,tick);
    const canvas=page.locator('#stage canvas'),box=await canvas.boundingBox();assert.ok(box);
    const before=await page.evaluate(()=>window.mobaClient.snapshot().heroes.find(h=>h.team===0).position);
    await page.mouse.click(box.x+box.width*.6,box.y+box.height*.5,{button:'right'});
    await page.waitForFunction(before=>{const hero=window.mobaClient.snapshot().heroes.find(h=>h.team===0);return Math.hypot(hero.position.x-before.x,hero.position.z-before.z)>.1;},before);
    report.checks.push('Capture exit returns to default route: no capture globals; live ticking and normal right-click movement');await page.close();
  }
  await verifyServed();
  assert.equal((await captureBundleIdentity(join(root,'outputs/capture-build'))).sha256,report.bundle.sha256,'Capture bundle changed during the run; do not use this evidence');
  checkInterrupted();report.passed=true;
}catch(error){report.errors.push(publicCaptureError(error,[root,resolve(values.out),leaseOptions?.root,process.env.MOBA_CAPTURE_CHROMIUM].filter(Boolean)));process.exitCode=1;}
finally{
  report.capturePassed=report.passed;
  const cleanupError=label=>{report.passed=false;report.errors.push(`Cleanup failed: ${label}; owned resource state remains unverified`);process.exitCode=1;};
  const {connectionClosed,serverClosed,errors:closeErrors}=await closeOwnedBrowser();
  for(const error of closeErrors)cleanupError(error);
  browserState=captureBrowserExitState(browserState!=='not-started',serverClosed,connectionClosed,processEvidence);
  report.execution.browser={state:browserState,serverClosed,connectionClosed,process:processEvidence??null};
  try{await record('browser-close-observed',report.execution.browser);}catch{cleanupError('browser receipt write');}
  if(server&&previewPort)try{
    report.execution.preview=await closeCapturePreview(server.httpServer,previewPort);
    if(report.execution.preview.exitProven)previewState='closed-port-refused';
  }catch{cleanupError('preview close/port check');}
  report.execution.preview={...report.execution.preview,state:previewState,externalNotOwned:!!values.base};
  try{await record('preview-close-observed',report.execution.preview);}catch{cleanupError('preview receipt write');}
  const knownUnclosedResources=Number(browserState==='unknown')+Number(previewState==='unknown');
  if(knownUnclosedResources)cleanupError('owned resource exit');
  if(lease)try{
    report.execution.lease=await lease.release({browser:browserState,preview:previewState,knownUnclosedResources});
    if(!report.execution.lease.released)cleanupError('lease retained');
  }catch(error){report.execution.lease={released:null,ownerMatched:error?.ownerMatched??null,reason:'release-unconfirmed'};cleanupError('lease owner/release');}
  if(report.execution.lease)try{await record('lease-release-observed',report.execution.lease);}catch{cleanupError('lease receipt write');}
  if(interrupted){report.execution.interrupted=interrupted;report.passed=false;process.exitCode=1;}
  process.removeListener('SIGINT',onSIGINT);process.removeListener('SIGTERM',onSIGTERM);process.removeListener('SIGHUP',onSIGHUP);
  console.log(JSON.stringify(await writeCaptureReport(output,report),null,2));
}
