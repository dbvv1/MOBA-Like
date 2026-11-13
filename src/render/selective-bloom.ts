import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

/** Dedicated layer for the tower cores. Ordinary world pixels live on layer 0. */
export const CRYSTAL_BLOOM_LAYER=1;

/** Bloom only the energy cores. The layer-scoped render excludes ground, lane,
 * foliage and structures, so no full-screen bright-pass can leak into the map. */
export function createSelectiveBloom(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,strength=.9){
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
  const composer=new EffectComposer(renderer,target);
  composer.renderToScreen=false;
  const renderPass=new RenderPass(scene,camera);
  const bloomPass=new UnrealBloomPass(new THREE.Vector2(1,1),strength,.3,.46);
  composer.addPass(renderPass);composer.addPass(bloomPass);
  const clearColor=new THREE.Color(),clearAlpha=renderer.getClearAlpha();
  function render(){
    const background=scene.background;
    scene.background=null;
    const layers=camera.layers.mask;
    camera.layers.set(CRYSTAL_BLOOM_LAYER);
    renderer.getClearColor(clearColor);const previousAlpha=renderer.getClearAlpha();
    renderer.setClearColor(0x000000,1);
    const shadowUpdate=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;
    composer.render();
    renderer.shadowMap.autoUpdate=shadowUpdate;
    renderer.setClearColor(clearColor,previousAlpha);camera.layers.mask=layers;scene.background=background;
  }
  let disposed=false;
  return {
    texture:()=>composer.readBuffer.texture,
    render,
    setSize(width:number,height:number){composer.setPixelRatio(1);composer.setSize(width,height);},
    dispose(){if(disposed)return;disposed=true;renderPass.dispose();bloomPass.dispose();composer.dispose();renderer.setClearColor(clearColor,clearAlpha);}
  };
}

/** Baseline has no AO or grade chain. It only composites the layer-scoped glow
 * under the same tone-mapping/colour-space output the direct renderer used. */
export function createCrystalBloomPost(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera){
  const baseTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  const bloom=createSelectiveBloom(renderer,scene,camera,.42);
  const composer=new EffectComposer(renderer),combine=new ShaderPass({
    uniforms:{tBase:{value:null},tBloom:{value:null},strength:{value:1}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tBase;uniform sampler2D tBloom;uniform float strength;varying vec2 vUv;
      void main(){vec3 base=texture2D(tBase,vUv).rgb;vec3 glow=texture2D(tBloom,vUv).rgb;gl_FragColor=vec4(base+glow*strength,1.0);}`
  });
  composer.addPass(combine);composer.addPass(new OutputPass());
  let disposed=false;
  return {
    resize(width:number,height:number,pixelRatio:number){composer.setPixelRatio(pixelRatio);composer.setSize(width,height);baseTarget.setSize(Math.max(1,Math.floor(width*pixelRatio)),Math.max(1,Math.floor(height*pixelRatio)));bloom.setSize(Math.max(1,Math.floor(width*pixelRatio*.5)),Math.max(1,Math.floor(height*pixelRatio*.5)));},
    render(){
      const previousTarget=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      renderer.setRenderTarget(baseTarget);renderer.autoClear=true;renderer.clear();renderer.render(scene,camera);
      bloom.render();combine.uniforms['tBase']!.value=baseTarget.texture;combine.uniforms['tBloom']!.value=bloom.texture();
      renderer.setRenderTarget(null);renderer.autoClear=autoClear;composer.render();renderer.setRenderTarget(previousTarget);
    },
    dispose(){if(disposed)return;disposed=true;bloom.dispose();baseTarget.dispose();for(const pass of composer.passes)pass.dispose();composer.dispose();}
  };
}
