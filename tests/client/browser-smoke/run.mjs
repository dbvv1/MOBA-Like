import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {launchOptions,pixelEvidence,failureCategory,cleanup} from './options.mjs';
import {startServer} from './server.mjs';

// Check real ready/cooling HUD labels without altering simulation state.
async function checkHudLayout(page){
  const layouts=[];
  for(const width of [320,375,420,421,640,750,751,1280]){
    await page.setViewportSize({width,height:900});
    const layout=await page.locator('[data-skills]').evaluate(skills=>({
      width:innerWidth,height:innerHeight,
      buttons:[...skills.querySelectorAll('button')].map(button=>{
        const rect=button.getBoundingClientRect(),label=button.querySelector('span');
        const range=document.createRange();range.selectNodeContents(label);
        const lines=[...range.getClientRects()].map(line=>({left:line.left,right:line.right,top:line.top,bottom:line.bottom}));
        return {text:label.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,lines};
      }),
    }));
    layouts.push(layout);assert.equal(layout.buttons.length,4);
    for(const button of layout.buttons){
      assert.ok(button.left>=0&&button.right<=layout.width&&button.top>=0&&button.bottom<=layout.height,`Skill is outside ${width}px viewport: ${button.text}`);
      assert.ok(button.width>=44&&button.height>=44,`Skill target is too small: ${button.text}`);
      assert.ok(button.lines.length>0&&button.lines.every(line=>line.left>=button.left-1&&line.right<=button.right+1&&line.top>=button.top-1&&line.bottom<=button.bottom+1),`Skill label is clipped: ${button.text}`);
    }
  }
  await page.setViewportSize({width:1280,height:900});
  return layouts;
}

const output=pathToFileURL(resolve(process.env.MOBA_SMOKE_OUTPUT??`smoke-artifacts/${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`)+'/');
await mkdir(dirname(fileURLToPath(output)),{recursive:true});
await mkdir(output,{recursive:false}); // Each run owns a new directory; never overwrite prior evidence.
const expectedSha=process.env.MOBA_SMOKE_SOURCE_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const report={startedAt:new Date().toISOString(),passed:false,consoleErrors:[],pageErrors:[],httpErrors:[],requestFailures:[],warnings:[],characterAssets:[]};
const resources={};let browserServer,browserProcess,page,stage='configure';
try {
  const options=launchOptions();report.launch=options;
  resources.server=await startServer();const {origin}=resources.server;
  stage='launch';browserServer=await chromium.launchServer(options);browserProcess=browserServer.process();report.browserProcess={pid:browserProcess.pid,args:browserProcess.spawnargs};assert.ok(!browserProcess.spawnargs.some(arg=>arg==='--no-sandbox'||arg==='--disable-setuid-sandbox'||arg==='--enable-unsafe-swiftshader'),'Unsafe browser argument');resources.browser=await chromium.connect(browserServer.wsEndpoint());report.browserVersion=resources.browser.version();
  page=await resources.browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());else if(message.type()==='warning')report.warnings.push(message.text());});
  page.on('pageerror',error=>report.pageErrors.push(String(error)));
  page.on('requestfailed',request=>report.requestFailures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{if(response.ok()&&new URL(response.url()).pathname.endsWith('.glb'))report.characterAssets.push(new URL(response.url()).pathname);if(response.status()>=400)report.httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  stage='identity';const identity=await (await fetch(origin+'/build-identity.json')).json();report.source=identity;assert.equal(identity.commit,expectedSha);assert.equal(identity.tree,execFileSync('git',['rev-parse',`${expectedSha}^{tree}`],{encoding:'utf8'}).trim());assert.equal(identity.dirty,false,'Smoke must target committed clean source');
  stage='default-entry';await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.mobaClient?.state().ready);
  const beforeDefault=await page.evaluate(()=>window.mobaClient.snapshot());assert.equal(beforeDefault.contentVersion,10);await page.waitForFunction(tick=>window.mobaClient.snapshot().tick>tick+5,beforeDefault.tick);
  report.defaultEntry={contentVersion:beforeDefault.contentVersion,initialTick:beforeDefault.tick,finalTick:await page.evaluate(()=>window.mobaClient.snapshot().tick),pixels:pixelEvidence(PNG.sync.read(await page.locator('#stage canvas').screenshot({path:fileURLToPath(new URL('default-canvas.png',output))})))};assert.ok(report.defaultEntry.pixels.nonBackground);
  report.defaultCharacterAssets=[...report.characterAssets];report.characterAssets=[];
  stage='navigate';const response=await page.goto(origin+'/candidate.html',{waitUntil:'networkidle'});assert.ok(response?.ok(),'HTML must load successfully');
  stage='initialize';
  await page.waitForFunction(()=>window.mobaClient?.state().ready || (!document.querySelector('#restart').disabled && !document.querySelector('#notice').hidden));
  const notice=await page.locator('#notice').textContent();
  assert.equal(await page.locator('#notice').isVisible(),false,notice || 'Initialization failed');
  assert.equal(await page.evaluate(()=>window.mobaClient.state().backend),'three-webgl2');
  for(const id of ['hero-teal','hero-rust','melee-teal','ranged-rust','tower-teal','lane-ground'])assert.ok(report.characterAssets.some(path=>new RegExp(`/${id}-[^/]+\\.glb$`).test(path)),`Adopted battle GLB ${id} must load successfully in the real build`);
  stage='context';
  report.webgl2=await page.locator('#stage canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return gl&&!gl.isContextLost()?{version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null}:null;});
  assert.ok(report.webgl2,'A live WebGL2 context is required');const raw=report.webgl2.unmaskedRenderer??'';report.rendererClass=/swiftshader|llvmpipe|softpipe|software/i.test(raw)?'software':/NVIDIA|AMD|Intel|Apple|Radeon|GeForce|Adreno|Mali/i.test(raw)?'gpu':'unknown';
  stage='hud-layout';report.hudLayout=await checkHudLayout(page);
  stage='input';const initial=await page.evaluate(()=>window.mobaClient.snapshot());report.initialTick=initial.tick;report.contentVersion=initial.contentVersion;assert.equal(initial.contentVersion,11,'Candidate browser entry must use the versioned basic attack cycle');
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
  // A catalog-mapped source icon must actually decode in the live HUD, not just exist in a model.
  const projectileIcon=page.locator('[data-skills] button').filter({hasText:'Q Rift Lancet'}).locator('img');
  await projectileIcon.waitFor({state:'visible'});
  await projectileIcon.evaluate(image=>image.decode());
  report.projectileIcon=await projectileIcon.evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight,complete:image.complete}));
  assert.deepEqual(report.projectileIcon,{width:64,height:64,complete:true});

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
    const snapshot=window.mobaClient.snapshot(),state=window.mobaClient.state(),effects=state.effects;
    const player=snapshot.heroes.find(hero=>hero.team===0);
    const actor=state.motions.find(actor=>actor.id===player.id);
    if(!actor?.attached||!actor.visible||!actor.actions.some(action=>action.clip==='attack.upper'&&action.tracks>0&&action.weight>0))return false;
    return player.cooldowns.E>0 && snapshot.zones.some(zone=>zone.team===0 && effects.some(effect=>effect.name===`zone-${zone.id}`&&effect.visible&&effect.meshes>=2));
  });
  report.motion=await page.evaluate(()=>window.mobaClient.state().motions);
  report.effect=await page.evaluate(()=>{
    const snapshot=window.mobaClient.snapshot(),effects=window.mobaClient.state().effects;
    const zone=snapshot.zones.find(zone=>zone.team===0&&effects.some(effect=>effect.name===`zone-${zone.id}`));
    return {zone,consumer:effects.find(effect=>effect.name===`zone-${zone.id}`)};
  });
  assert.equal(report.effect.consumer.position.x,report.effect.zone.position.x);
  assert.equal(report.effect.consumer.position.z,report.effect.zone.position.z);
  stage='hud-layout-cooldown';report.cooldownHudLayout=await checkHudLayout(page);
  report.initialMatchFinalTick=await page.evaluate(()=>window.mobaClient.snapshot().tick);
  // Next-match selection must not mutate a live hero; exercise real DOM, controls and restart.
  stage='hero-selection';
  await page.locator('#hero-select').selectOption('morrow');
  assert.equal(await page.evaluate(()=>window.mobaClient.snapshot().heroes.find(h=>h.team===0).definitionId),'veyra');
  await page.locator('#restart').click();
  await page.waitForFunction(()=>window.mobaClient?.state().ready&&window.mobaClient.snapshot().heroes.find(h=>h.team===0)?.definitionId==='morrow');
  assert.equal(await page.locator('#hero-select').inputValue(),'morrow');
  assert.match(await page.locator('[data-hero]').textContent(),/Morrow/);
  assert.match(await page.locator('[data-skills]').textContent(),/Barkguard/);
  const morrowCanvas=page.locator('#stage canvas'),morrowBox=await morrowCanvas.boundingBox();assert.ok(morrowBox);
  await morrowCanvas.focus();await page.keyboard.press('w');
  await page.waitForFunction(()=>{const h=window.mobaClient.snapshot().heroes.find(h=>h.team===0);return h.shield>0&&h.cooldowns.W>0&&h.mana<h.maxMana;});
  for(const slot of ['q','e','r']){
    await morrowCanvas.focus();await page.keyboard.press(slot);
    await page.mouse.click(morrowBox.x+morrowBox.width*.55,morrowBox.y+morrowBox.height*.51);
    await page.waitForFunction(slot=>{const s=window.mobaClient.snapshot(),h=s.heroes.find(h=>h.team===0);return h.cooldowns[slot.toUpperCase()]>0&&s.stats.abilities[`morrow.${slot}`]?.casts===1;},slot);
    // Let the accepted cast resolve before asking for the next one.
    await page.waitForFunction(()=>window.mobaClient.snapshot().heroes.find(h=>h.team===0).castSlot===null);
  }
  report.heroSelection={selected:'morrow',played:await page.evaluate(()=>window.mobaClient.snapshot().heroes.find(h=>h.team===0))};
  stage='hud-layout-morrow-cooldown';report.morrowCooldownHudLayout=await checkHudLayout(page);
  assert.ok(await page.evaluate(()=>window.mobaClient.snapshot().zones.some(z=>z.team===0&&z.abilityId==='morrow.e')),'Morrow E must produce its actual zone');
  await page.locator('#restart').click();
  await page.waitForFunction(()=>{const h=window.mobaClient?.snapshot().heroes.find(h=>h.team===0);return h?.definitionId==='morrow'&&h.mana===h.maxMana&&Object.values(h.cooldowns).every(x=>x===0);});
  assert.equal(await page.locator('#hero-select').inputValue(),'morrow');
  await page.locator('#hero-select').selectOption('veyra');await page.locator('#restart').click();
  await page.waitForFunction(()=>window.mobaClient?.snapshot().heroes.find(h=>h.team===0)?.definitionId==='veyra');
  await page.waitForFunction(()=>window.mobaClient.snapshot().tick>5);
  assert.match(await page.locator('[data-skills]').textContent(),/Slipstream/);
  assert.equal(await page.locator('#stage canvas').count(),1,'Restarts must replace, not accumulate, renderers');
  report.heroSelection.restartPreserved=true;report.heroSelection.changedBack=true;
  stage='keyboard-and-resume';await page.locator('footer details').evaluate(node=>{node.open=true;});await page.locator('#keyboard-settings').click();await page.locator('[data-binding-action="Q"]').click();await page.keyboard.press('f');await page.locator('[data-binding-save]').click();
  assert.match(await page.locator('[data-skills] button').first().textContent(),/^F /);
  // Closing settings intentionally clears pointer ownership. Focus alone is not a pointer event.
  // Re-enter the current canvas through real page input before checking the remapped aim.
  await canvas.focus();const reboundBox=await canvas.boundingBox();assert.ok(reboundBox,'Current canvas must be visible after settings');
  await page.mouse.move(reboundBox.x+reboundBox.width*.58,reboundBox.y+reboundBox.height*.52);
  await page.keyboard.press('f');await page.waitForFunction(()=>window.mobaClient.state().targeting.visible);await page.keyboard.press('Escape');
  const beforeResume=await page.evaluate(()=>window.mobaClient.snapshot());await page.getByRole('button',{name:'Save match',exact:true}).click();await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Continue saved match',exact:true}).click();await page.waitForFunction(()=>window.mobaClient?.state().ready);
  const resumed=await page.evaluate(()=>window.mobaClient.snapshot());assert.ok(resumed.tick>=beforeResume.tick);assert.equal(resumed.contentVersion,11);assert.match(await page.locator('[data-skills] button').first().textContent(),/^F /);report.resume={savedTick:beforeResume.tick,resumedTick:resumed.tick,remappedQ:'F'};
  report.finalTick=await page.evaluate(()=>window.mobaClient.snapshot().tick);
  await page.screenshot({path:fileURLToPath(new URL('page.png',output))});
  stage='pixels';
  const bytes=await canvas.screenshot({path:fileURLToPath(new URL('canvas.png',output))});
  report.pixels=pixelEvidence(PNG.sync.read(bytes));assert.ok(report.pixels.nonBackground,'Canvas must have non-background scene pixels');
  stage='errors';assert.equal(await page.locator('#notice').isVisible(),false,'Runtime failure notice');
  for(const key of ['consoleErrors','pageErrors','httpErrors','requestFailures'])assert.deepEqual(report[key],[],key);
  stage='diffuse-entry';await page.close();const diffuse=await resources.browser.newPage({viewport:{width:1280,height:900}});diffuse.setDefaultTimeout(15000);page=diffuse;
  diffuse.on('pageerror',error=>report.pageErrors.push(String(error)));diffuse.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await diffuse.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  await diffuse.goto(origin+'/candidate.html?lighting=stylized-diffuse',{waitUntil:'networkidle'});await diffuse.waitForFunction(()=>window.mobaClient?.state().ready&&window.mobaClient.state().lighting.active==='stylized-diffuse');
  report.diffuseEntry={contentVersion:await diffuse.evaluate(()=>window.mobaClient.snapshot().contentVersion),lighting:await diffuse.evaluate(()=>window.mobaClient.state().lighting),pixels:pixelEvidence(PNG.sync.read(await diffuse.locator('#stage canvas').screenshot({path:fileURLToPath(new URL('diffuse-canvas.png',output))})))};
  assert.equal(report.diffuseEntry.contentVersion,11);assert.ok(report.diffuseEntry.pixels.nonBackground);await diffuse.close();for(const key of ['consoleErrors','pageErrors'])assert.deepEqual(report[key],[],key);
  report.passed=true;
}catch(error){
  report.failure={stage,category:failureCategory(stage,String(error)),message:error.stack||String(error)};process.exitCode=1;
  if(page){try{report.notice=await page.locator('#notice').textContent({timeout:1000});await page.screenshot({path:fileURLToPath(new URL('failure.png',output)),timeout:3000});}catch(captureError){report.captureError=String(captureError);}}
}finally{
  report.cleanupErrors=await cleanup(resources);
  if(browserServer){try{await browserServer.close();}catch(error){report.cleanupErrors.push(`browserServer: ${error}`);}}
  report.processExit=browserProcess?{pid:browserProcess.pid,exitCode:browserProcess.exitCode,signalCode:browserProcess.signalCode,exited:browserProcess.exitCode!==null||browserProcess.signalCode!==null}:null;
  if(browserProcess&&!report.processExit.exited)report.cleanupErrors.push('Owned browser process exit not confirmed');
  if(resources.server){try{await fetch(resources.server.origin);report.cleanupErrors.push('Owned preview port remains reachable');}catch{report.previewClosed=true;}}
  if(report.cleanupErrors.length){report.passed=false;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();
  const files=[];for(const name of await readdir(output)){const bytes=await readFile(new URL(name,output));files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  await writeFile(new URL('manifest.json',output),JSON.stringify({source:report.source,startedAt:report.startedAt,finishedAt:report.finishedAt,passed:report.passed,renderer:report.webgl2,rendererClass:report.rendererClass??'unknown',processExit:report.processExit,previewClosed:report.previewClosed??false,files},null,2)+'\n');
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
