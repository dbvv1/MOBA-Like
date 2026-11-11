import {isAbsolute} from 'node:path';
import assert from 'node:assert/strict';

// Both variants run the same full input/restart/save sequence, never a load-only probe.
export function smokeEntry(env = process.env) {
  const variant=env.MOBA_SMOKE_VARIANT??'default';
  if(!['default','quiet'].includes(variant))throw new Error('MOBA_SMOKE_VARIANT must be default or quiet');
  return {variant,route:variant==='default'?'/':'/candidate.html?materials=quiet-family-v1&lighting=forest-light-v1',contentVersion:11,lighting:'forest-light-v1'};
}

export function assertSmokeEntry(state,entry,pageURL) {
  const url=new URL(pageURL);
  assert.equal(url.pathname+url.search,entry.route,'Selected entry URL must survive every restart and resume');
  assert.equal(state.ready,true,'Selected entry must be ready');
  assert.equal(state.backend,'three-webgl2','Selected entry must render WebGL2');
  assert.equal(state.fallbackReason,'','Selected entry must not silently recover to default materials');
  assert.equal(state.contentVersion,entry.contentVersion);
  assert.equal(state.lighting?.active,entry.lighting);
  const material=entry.variant==='quiet'?'quiet-family-v1':'baseline';
  assert.equal(state.materials?.configured,material,'Actual loaded material family must match the selected entry');
  assert.equal(state.materials?.active,material,'Material family must have submitted a live frame');
}

export function assertRetiredLighting(state,noticeVisible) {
  assert.equal(state.ready,true);
  assert.equal(state.backend,'three-webgl2','Retirement probe must restore the real default renderer');
  assert.equal(state.lighting?.active,'forest-light-v1');
  assert.match(state.fallbackReason,/stylized-diffuse trial is retired/);
  assert.equal(noticeVisible,true,'Retired trial must explain visible default recovery');
}

// Explicit opt-ins only. Never retry using a different binary or sandbox mode.
export function launchOptions(env = process.env) {
  const executablePath = env.MOBA_SMOKE_CHROMIUM;
  if (executablePath && !isAbsolute(executablePath)) throw new Error('MOBA_SMOKE_CHROMIUM must be absolute');
  if (env.MOBA_SMOKE_CLOUD_NO_SANDBOX !== undefined) throw new Error('Sandbox override is not permitted');
  const renderer=env.MOBA_SMOKE_RENDERER??'gpu';
  if(!['gpu','software'].includes(renderer))throw new Error('Renderer must be gpu or software');
  return {headless:true, chromiumSandbox:true, timeout:30000,
    args:renderer==='software'?['--use-angle=swiftshader']:[],
    ignoreDefaultArgs:['--enable-unsafe-swiftshader'],
    ...(executablePath ? {executablePath} : {})};
}

export function pixelEvidence({width,height,data}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width*height*4) throw new Error('Invalid RGBA image');
  const counts = new Map();
  for (let i=0;i<data.length;i+=4) {
    const key=`${data[i]>>3},${data[i+1]>>3},${data[i+2]>>3},${data[i+3]>>3}`;
    counts.set(key,(counts.get(key)||0)+1);
  }
  const dominantFraction=Math.max(...counts.values())/(width*height);
  return {width,height,quantizedColors:counts.size,dominantFraction,nonBackground:counts.size>32 && dominantFraction<.99};
}

export function failureCategory(stage,message='') {
  if (/WebGL|context.*lost/i.test(message)) return 'webgl-unavailable';
  return ({launch:'browser-launch',navigate:'http-load',initialize:'client-initialization',context:'webgl-unavailable',input:'input-or-simulation',pixels:'render-pixels',errors:'browser-errors'})[stage] || 'harness';
}

export async function cleanup(resources) {
  const errors=[];
  for (const [name,close] of [['browser',()=>resources.browser?.close()],['server',()=>resources.server?.close()]]) {
    try {await close();} catch(error) {errors.push(`${name}: ${error.message || error}`);}
  }
  return errors;
}
