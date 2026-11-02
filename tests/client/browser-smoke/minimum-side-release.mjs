/** Import into an already authorized cloud browser owner. Use a fresh context per route (no saved-match prompt). This module launches nothing. */
export const requiredTicks=300;
export const routes=['/','/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1'];
export async function inspectMinimumRoute(page,baseURL,route,{canvas=false}={}){
  const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  try{
    await page.goto(new URL(route+(canvas?(route.includes('?')?'&':'?')+'renderer=canvas2d':''),baseURL).href);
    await page.waitForFunction(()=>window.mobaClient?.state().ready,{},{timeout:120000});
    await page.waitForFunction(()=>window.mobaClient?.state().acceptance?.reached,{},{timeout:120000});
    const state=await page.evaluate(()=>window.mobaClient.state());
    if(!state.ready||state.acceptance.advancedTicks<requiredTicks||errors.length)throw new Error(JSON.stringify({state,errors}));
    return {route,state,errors,scope:'minimum actual browser progression, not full smoke or visual/listening acceptance'};
  }finally{page.off('pageerror',onError);}
}

/** Real initialization failure probes. Use a separate fresh context for each. */
export async function inspectInvalidLightingFallback(page,baseURL){
 const result=await inspectMinimumRoute(page,baseURL,'/candidate.html?lighting=invalid&commands=buffer-v1&camera=hold-follow-v1');
 const visible=await page.locator('#notice').isVisible();
 const defaultRecovered=result.state.backend==='three-webgl2'&&result.state.lighting.configured==='forest-light-v1';
 const canvasRecovered=result.state.backend==='canvas2d'&&result.state.fallbackReason.includes('default renderer:');
 if(!(defaultRecovered||canvasRecovered)||!visible||!result.state.fallbackReason.includes('Unknown lighting')||result.state.camera.temporaryFollow)throw new Error('Missing visible default-render recovery');
 return {...result,noticeVisible:visible};
}
export async function inspectUnavailableWebGLFallback(page,baseURL){
 await page.addInitScript(()=>{
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){return String(kind).toLowerCase().includes('webgl')?null:original.call(this,kind,...args);};
 });
 const result=await inspectMinimumRoute(page,baseURL,routes[1]);
 const visible=await page.locator('#notice').isVisible();
 if(result.state.backend!=='canvas2d'||!visible||!result.state.fallbackReason)throw new Error('Missing automatic Canvas2D recovery');
 return {...result,noticeVisible:visible,scope:'WebGL contexts unavailable; real Canvas2D, normal client and simulation; not visual acceptance'};
}
