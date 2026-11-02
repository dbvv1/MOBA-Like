import {CAPTURE_SIZE} from './cameras.js';
/** Read the detached renderer buffer, never a page or CSS-sized screenshot. */
export function captureOutput(canvas:HTMLCanvasElement,gl:WebGLRenderingContext|WebGL2RenderingContext){
  if(canvas.getContext('webgl2')!==gl||gl.isContextLost())throw new Error('Capture requires an active WebGL2 context; Canvas2D fallback is disabled');
  if(canvas.width!==CAPTURE_SIZE.width||canvas.height!==CAPTURE_SIZE.height)throw new Error('Capture buffer must be 1280x720');
  gl.finish();
  const pngDataUrl=canvas.toDataURL('image/png');
  if(!pngDataUrl.startsWith('data:image/png;base64,'))throw new Error('Capture PNG encoding failed');
  return {backend:'webgl2',image:{...CAPTURE_SIZE,dpr:1},pngDataUrl};
}
