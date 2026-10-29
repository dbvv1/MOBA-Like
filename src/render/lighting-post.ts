import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {renderRole} from './lighting-style.js';

/** Fixed sampling, independent of the simulation/random stream and wall clock. */
export function aoKernel(count=16){
  return Array.from({length:count},(_,i)=>{
    const z=(i+.5)/count,angle=i*2.399963229728653;
    return new THREE.Vector3(Math.cos(angle)*Math.sqrt(1-z*z),Math.sin(angle)*Math.sqrt(1-z*z),z).multiplyScalar(.1+.9*((i+1)/count)**2);
  });
}

/** Only world meshes occlude. UI, targeting and effects never enter the normal buffer. */
class WorldAO extends SSAOPass {
  private hidden:THREE.Object3D[]=[];
  _overrideVisibility(){
    this.scene.traverse(o=>{if(o.visible&&((o as THREE.Mesh).isMesh||(o as THREE.Line).isLine||(o as THREE.Points).isPoints||(o as THREE.Sprite).isSprite)&&(!(o as THREE.Mesh).isMesh||renderRole(o)!=='world')){o.visible=false;this.hidden.push(o);}});
  }
  _restoreVisibility(){for(const o of this.hidden)o.visible=true;this.hidden.length=0;}
}

export function createLightingPost(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera){
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  const composer=new EffectComposer(renderer,target),beauty=new RenderPass(scene,camera);
  const ao=new WorldAO(scene,camera,1,1,16);
  // Replace Three's random constructor samples before the first submitted frame.
  ao.kernel.splice(0,ao.kernel.length,...aoKernel());
  ao.noiseTexture.dispose();
  ao.noiseTexture=new THREE.DataTexture(new Float32Array([.13,-.71,.39,-.23,.89,.47,-.53,.07,-.37,.67,-.97,.31,.59,-.11,.79,-.43]),4,4,THREE.RedFormat,THREE.FloatType);
  ao.noiseTexture.wrapS=ao.noiseTexture.wrapT=THREE.RepeatWrapping;ao.noiseTexture.needsUpdate=true;
  ao.ssaoMaterial.uniforms['tNoise']!.value=ao.noiseTexture;
  ao.kernelRadius=1.4;ao.minDistance=.001;ao.maxDistance=.015;
  const grade=new ShaderPass({
    uniforms:{tDiffuse:{value:null}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){vec4 source=texture2D(tDiffuse,vUv);vec3 c=source.rgb;
        float l=dot(c,vec3(.2126,.7152,.0722));
        vec3 balance=mix(vec3(.82,1.02,1.05),vec3(1.04,1.01,.94),smoothstep(.04,.65,l));
        gl_FragColor=vec4(max(c*balance,vec3(0.0)),source.a);}`
  });
  const output=new OutputPass();
  for(const pass of [beauty,ao,grade,output])composer.addPass(pass);
  let disposed=false;
  function renderLayers(){
    const objects:Array<{object:THREE.Object3D;visible:boolean;world:boolean}>=[];
    const writes=new Map<THREE.Material,boolean>();
    scene.traverse(object=>{if((object as THREE.Mesh).isMesh||(object as THREE.Line).isLine||(object as THREE.Points).isPoints||(object as THREE.Sprite).isSprite)objects.push({object,visible:object.visible,world:renderRole(object)==='world'});});
    const background=scene.background,autoClear=renderer.autoClear,shadowUpdate=renderer.shadowMap.autoUpdate;
    try{
      for(const row of objects)row.object.visible=row.visible&&row.world;
      composer.render(0);
      // Rebuild world depth on the default framebuffer with the actual source
      // shaders (alpha tests/skinning included), without touching its graded color.
      scene.background=null;renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;
      renderer.setRenderTarget(null);renderer.clearDepth();
      for(const row of objects)if(row.world){
        const material=(row.object as THREE.Mesh).material;
        for(const m of Array.isArray(material)?material:[material])if(m&&!writes.has(m)){writes.set(m,m.colorWrite);m.colorWrite=false;}
      }
      renderer.render(scene,camera);
      for(const [material,colorWrite] of writes)material.colorWrite=colorWrite;
      // Render cues in their original shader/toneMapped/depth semantics. Neither
      // the world AO nor the world color grade is multiplied into their pixels.
      for(const row of objects)row.object.visible=row.visible&&!row.world;
      renderer.render(scene,camera);
    }finally{
      for(const [material,colorWrite] of writes)material.colorWrite=colorWrite;
      for(const row of objects)row.object.visible=row.visible;
      scene.background=background;renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowUpdate;
    }
  }
  return {
    resize(width:number,height:number,pixelRatio:number){composer.setPixelRatio(pixelRatio);composer.setSize(width,height);},
    render(){
      ao.ssaoMaterial.uniforms['cameraProjectionMatrix']!.value.copy(camera.projectionMatrix);
      ao.ssaoMaterial.uniforms['cameraInverseProjectionMatrix']!.value.copy(camera.projectionMatrixInverse);
      renderLayers();
    },
    dispose(){if(disposed)return;disposed=true;ao.ssaoMaterial.dispose();ao.noiseTexture.dispose();for(const pass of [beauty,ao,grade,output])pass.dispose();composer.dispose();}
  };
}
