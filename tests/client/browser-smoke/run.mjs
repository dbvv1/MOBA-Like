import assert from 'node:assert/strict';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {launchOptions,pixelEvidence,failureCategory,cleanup} from './options.mjs';
import {startServer} from './server.mjs';

const output=new URL('./reports/',import.meta.url);
await mkdir(output,{recursive:true});
for (const name of ['page.png','canvas.png','failure.png','report.json']) await rm(new URL(name,output),{force:true});
const report={startedAt:new Date().toISOString(),passed:false,consoleErrors:[],pageErrors:[],httpErrors:[],requestFailures:[],warnings:[],characterAssets:[]};
const resources={};let page,stage='configure';
try {
  const options=launchOptions();report.launch=options;
  resources.server=await startServer();const {origin}=resources.server;
  stage='launch';resources.browser=await chromium.launch(options);report.browserVersion=resources.browser.version();
  page=await resources.browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());else if(message.type()==='warning')report.warnings.push(message.text());});
  page.on('pageerror',error=>report.pageErrors.push(String(error)));
  page.on('requestfailed',request=>report.requestFailures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{if(response.ok()&&new URL(response.url()).pathname.endsWith('.glb'))report.characterAssets.push(new URL(response.url()).pathname);if(response.status()>=400)report.httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  stage='navigate';const response=await page.goto(origin,{waitUntil:'networkidle'});assert.ok(response?.ok(),'HTML must load successfully');
  stage='initialize';
  await page.waitForFunction(()=>window.mobaClient?.state().ready || (!document.querySelector('#restart').disabled && !document.querySelector('#notice').hidden));
  const notice=await page.locator('#notice').textContent();
  assert.equal(await page.locator('#notice').isVisible(),false,notice || 'Initialization failed');
  assert.equal(await page.evaluate(()=>window.mobaClient.state().backend),'three-webgl2');
  assert.ok(report.characterAssets.some(path=>/\/blue-reactions-[^/]+\.glb$/.test(path)),'The adopted reaction GLB must load successfully in the real build');
  stage='context';
  report.webgl2=await page.locator('#stage canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2');return gl&&!gl.isContextLost()?{version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER)}:null;});
  assert.ok(report.webgl2,'A live WebGL2 context is required');
  stage='input';const initial=await page.evaluate(()=>window.mobaClient.snapshot());report.initialTick=initial.tick;report.contentVersion=initial.contentVersion;assert.equal(initial.contentVersion,8,'Integrated browser entry must use accepted v8 content, not frozen v2 or experimental v9');
  await page.waitForFunction(tick=>window.mobaClient.snapshot().tick>tick+5,initial.tick);
  const hero=initial.heroes.find(hero=>hero.team===0);assert.ok(hero,'Player hero exists');
  const canvas=page.locator('#stage canvas');const box=await canvas.boundingBox();assert.ok(box,'Canvas visible');
  // Real pointer events, not direct calls to Simulation or the command queue.
  await page.mouse.click(box.x+box.width*.6,box.y+box.height*.5,{button:'right'});
  await page.waitForFunction(({id,start})=>{const hero=window.mobaClient.snapshot().heroes.find(h=>h.id===id);return Math.hypot(hero.position.x-start.x,hero.position.z-start.z)>.1;},{id:hero.id,start:hero.position});
  assert.ok(await page.evaluate(id=>window.mobaClient.snapshot().heroes.find(h=>h.id===id).moveGoal,hero.id),'Move must still be active before stop');
  await page.keyboard.press('s');
  await page.waitForFunction(id=>window.mobaClient.snapshot().heroes.find(h=>h.id===id).moveGoal===null,hero.id);
  const stopped=await page.evaluate(()=>window.mobaClient.snapshot());
  await page.waitForFunction(tick=>window.mobaClient.snapshot().tick>tick+6,stopped.tick);
  const stoppedHero=stopped.heroes.find(h=>h.id===hero.id);
  const laterHero=await page.evaluate(id=>window.mobaClient.snapshot().heroes.find(h=>h.id===id),hero.id);
  assert.ok(Math.hypot(stoppedHero.position.x-laterHero.position.x,stoppedHero.position.z-laterHero.position.z)<1e-8,'S must stop movement across simulation ticks');
  await page.locator('[data-lock]').uncheck();
  assert.equal(await page.evaluate(()=>window.mobaClient.state().camera.locked),false);
  const cameraBefore=await page.evaluate(()=>window.mobaClient.state().camera.position);
  await page.mouse.move(box.x+box.width*.98,box.y+box.height*.5);
  await page.waitForFunction(x=>window.mobaClient.state().camera.position.x>x+.2,cameraBefore.x);
  await canvas.focus();await page.keyboard.press('Space');
  await page.waitForFunction(id=>{const state=window.mobaClient.state();const hero=window.mobaClient.snapshot().heroes.find(h=>h.id===id);return state.camera.locked && Math.abs(state.camera.position.x-hero.position.x)<.01;},hero.id);
  assert.equal(await page.locator('[data-lock]').isChecked(),true);
  assert.equal(await page.locator('[data-skills] button').count(),4);
  assert.match(await page.locator('[data-hero]').textContent(),/HP .*Mana/);
  // Inspect actual attached Three line geometry after normal Q/E selection and cancellation.
  // No simulation injection or synthetic mode label is accepted as evidence.
  stage='targeting';await page.mouse.move(box.x+box.width*.58,box.y+box.height*.52);
  await canvas.focus();await page.keyboard.press('q');
  await page.waitForFunction(()=>{const aim=window.mobaClient.state().targeting;return aim.visible&&aim.lines.some(line=>line.name==='requested-target'&&line.visible&&line.vertices===12);});
  const direction=await page.evaluate(()=>window.mobaClient.state().targeting);
  await page.keyboard.press('e');
  await page.waitForFunction(()=>{const aim=window.mobaClient.state().targeting;return aim.visible&&aim.lines.some(line=>line.name==='requested-target'&&line.visible&&line.vertices>=96);});
  const area=await page.evaluate(()=>window.mobaClient.state().targeting);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.mobaClient.state().targeting.visible);
  report.targeting={direction,area,cancelled:true};
  stage='input';
  // Trigger an actual persistent effect through normal controls, not a debug command API.
  await canvas.focus();await page.keyboard.press('e');
  await page.mouse.click(box.x+box.width*.58,box.y+box.height*.52);
  await page.waitForFunction(()=>{
    const snapshot=window.mobaClient.snapshot(),effects=window.mobaClient.state().effects;
    const player=snapshot.heroes.find(hero=>hero.team===0);
    return player.cooldowns.E>0 && snapshot.zones.some(zone=>zone.team===0 && effects.some(effect=>effect.name===`zone-${zone.id}`&&effect.visible&&effect.meshes>=2));
  });
  report.effect=await page.evaluate(()=>{
    const snapshot=window.mobaClient.snapshot(),effects=window.mobaClient.state().effects;
    const zone=snapshot.zones.find(zone=>zone.team===0&&effects.some(effect=>effect.name===`zone-${zone.id}`));
    return {zone,consumer:effects.find(effect=>effect.name===`zone-${zone.id}`)};
  });
  assert.equal(report.effect.consumer.position.x,report.effect.zone.position.x);
  assert.equal(report.effect.consumer.position.z,report.effect.zone.position.z);
  report.finalTick=await page.evaluate(()=>window.mobaClient.snapshot().tick);
  await page.screenshot({path:fileURLToPath(new URL('page.png',output))});
  stage='pixels';
  const bytes=await canvas.screenshot({path:fileURLToPath(new URL('canvas.png',output))});
  report.pixels=pixelEvidence(PNG.sync.read(bytes));assert.ok(report.pixels.nonBackground,'Canvas must have non-background scene pixels');
  stage='errors';assert.equal(await page.locator('#notice').isVisible(),false,'Runtime failure notice');
  for(const key of ['consoleErrors','pageErrors','httpErrors','requestFailures'])assert.deepEqual(report[key],[],key);
  report.passed=true;
}catch(error){
  report.failure={stage,category:failureCategory(stage,String(error)),message:error.stack||String(error)};process.exitCode=1;
  if(page){try{report.notice=await page.locator('#notice').textContent({timeout:1000});await page.screenshot({path:fileURLToPath(new URL('failure.png',output)),timeout:3000});}catch(captureError){report.captureError=String(captureError);}}
}finally{
  report.cleanupErrors=await cleanup(resources);
  if(report.cleanupErrors.length){report.passed=false;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
