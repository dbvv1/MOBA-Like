// Headless fixed-state comparison only: no OS/browser input or simulation mutation.
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {startServer} from './server.mjs';
import {launchOptions,pixelEvidence,cleanup} from './options.mjs';
const output=resolve(process.env.MOBA_SMOKE_OUTPUT??`smoke-artifacts/standards-${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`);
await mkdir(dirname(output),{recursive:true});
await mkdir(output,{recursive:false});
const report={passed:false,frames:[],observations:[],errors:[]},resources={};let server;
try{
 resources.server=await startServer(resolve('outputs/capture-build'));
 server=await chromium.launchServer(launchOptions());report.process={pid:server.process().pid,args:server.process().spawnargs};
 assert.ok(!report.process.args.some(x=>['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader'].includes(x)));
 resources.browser=await chromium.connect(server.wsEndpoint());
 const page=await resources.browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('requestfailed',r=>report.errors.push(`${r.url()}: ${r.failure()?.errorText}`));
 await page.route('**/*',route=>new URL(route.request().url()).origin===resources.server.origin?route.continue():route.abort());
 for(const shot of ['first-tower','barracks-road']){
  let baseline;const repeats=new Map();
  for(const standards of ['baseline','tower-standards'])for(let repeat=0;repeat<2;repeat++){
   await page.goto(`${resources.server.origin}/capture.html?shot=${shot}&seed=1&t=10&input=march&frames=1&standards=${standards}`,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.__shot?.ready===true,{},{timeout:120000});
   const metadata=await page.evaluate(()=>window.__shot);
   report.observations.push({shot,standards,repeat,metadata});
   if((process.env.MOBA_SMOKE_RENDERER??'gpu')==='gpu')assert.equal(metadata.rendererClass,'gpu','GPU requested; preserve evidence and stop without renderer switching');
   assert.equal(metadata.sourceDirty,false,'Comparison requires committed clean fixed source');
   assert.equal(metadata.standards.requested,standards);
   if(standards==='tower-standards'){
    assert.deepEqual(metadata.standards.models,{'tower-teal':'candidate','barracks-teal':'candidate'});assert.equal(metadata.standards.road,'candidate');
    for(const key of ['sourceCommit','bundleSha256','stateHash','simTick','virtualFrame','shot'])assert.deepEqual(metadata[key],baseline[key]);
    assert.deepEqual(metadata.camera,baseline.camera);assert.deepEqual(metadata.viewport,baseline.viewport);
   }else baseline=metadata;
   const file=`${shot}-${standards}-${repeat}.png`,bytes=await page.locator('#capture-stage canvas').screenshot({path:resolve(output,file)}),pixels=pixelEvidence(PNG.sync.read(bytes));assert.ok(pixels.nonBackground);
   const pngSha256=createHash('sha256').update(bytes).digest('hex');
   if(repeat)assert.equal(pngSha256,repeats.get(standards),'Repeated fixed-camera PNG must match');else repeats.set(standards,pngSha256);
   report.frames.push({file,repeat,pngSha256,pixels,metadata});
  }
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{
 report.cleanup=await cleanup(resources);
 try{await server?.close();}catch(error){report.cleanup.push(`browser-server: ${error.message||error}`);}
 if(report.cleanup.length){report.passed=false;process.exitCode=1;}
 await writeFile(resolve(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
}
