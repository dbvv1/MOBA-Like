export type RendererClass='software'|'gpu'|'unknown';
export function classifyRenderer(renderer:string):RendererClass {
  if(/swiftshader|llvmpipe|softpipe|swrast|lavapipe|software|basic render|microsoft remote|mesa offscreen/i.test(renderer))return 'software';
  if(/virgl|virtual|vmware|parallels/i.test(renderer))return 'unknown';
  return /nvidia|geforce|quadro|radeon|\bAMD\b|\bATI\b|\bIntel\b|Apple\s+(?:M\d|GPU)|adreno|mali|powervr/i.test(renderer)?'gpu':'unknown';
}
export function rendererEvidence(gl:WebGLRenderingContext|WebGL2RenderingContext){
  if(gl.isContextLost())throw new Error('WebGL context lost');
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)??'');
  return {renderer,vendor:String(gl.getParameter(ext?ext.UNMASKED_VENDOR_WEBGL:gl.VENDOR)??''),version:String(gl.getParameter(gl.VERSION)),unmasked:!!ext,rendererClass:classifyRenderer(renderer)};
}
