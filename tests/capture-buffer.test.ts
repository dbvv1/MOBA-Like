import {it,expect} from 'vitest';
import {captureOutput} from '../src/capture/output.js';
it('exports only the fixed WebGL2 buffer, rejecting size/context/encoding failures',()=>{
  const gl={isContextLost:()=>false,finish(){}};
  const canvas={width:1280,height:720,getContext:()=>gl,toDataURL:()=> 'data:image/png;base64,AA=='};
  const read=()=>captureOutput(canvas as unknown as HTMLCanvasElement,gl as WebGL2RenderingContext);
  expect(read()).toMatchObject({backend:'webgl2',image:{width:1280,height:720,dpr:1},pngDataUrl:'data:image/png;base64,AA=='});
  canvas.width=900;expect(read).toThrow('1280x720');canvas.width=1280;
  canvas.toDataURL=()=> 'data:,';expect(read).toThrow('PNG');gl.isContextLost=()=>true;expect(read).toThrow('WebGL2');
});
