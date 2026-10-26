import {isAbsolute} from 'node:path';

// Explicit opt-ins only. Never retry using a different binary or sandbox mode.
export function launchOptions(env = process.env) {
  const executablePath = env.MOBA_SMOKE_CHROMIUM;
  if (executablePath && !isAbsolute(executablePath)) throw new Error('MOBA_SMOKE_CHROMIUM must be absolute');
  const sandboxOverride = env.MOBA_SMOKE_CLOUD_NO_SANDBOX;
  if (sandboxOverride !== undefined && sandboxOverride !== '1') throw new Error('MOBA_SMOKE_CLOUD_NO_SANDBOX must be unset or 1');
  return {headless:true, chromiumSandbox:sandboxOverride !== '1', timeout:30000,
    args:['--use-angle=swiftshader'],
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
