import * as THREE from 'three';
import {separateSkyRadiance} from './sky-radiance.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {FullScreenQuad,Pass} from 'three/addons/postprocessing/Pass.js';

// A single fixed daylight treatment, shared by play and reproducible captures.
// No auto exposure, bloom, temporal noise, model recolouring or simulation input.
export const BATTLE_LIGHTING=Object.freeze({
  sky:'#647e83',fogNear:48,fogFar:125,
  sun:'#ffe0ad',sunIntensity:3.15,environmentIntensity:.45,exposure:1.06,
  shadowSize:2048,aoRadius:.85,aoIntensity:.7,aoResolution:.75,
});

/** Unlit gameplay cues must neither cast screen-space AO nor be darkened by it. */
export function receivesContactOcclusion(object:THREE.Object3D):boolean{
  const mesh=object as THREE.Mesh;
  if(!mesh.isMesh)return false;
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  return materials.length>0&&materials.every(material=>
    (material as THREE.MeshStandardMaterial).isMeshStandardMaterial&&
    !material.transparent&&material.depthTest&&material.depthWrite);
}

/** The addon uses random denoise noise by default; keep captures repeatable. */
export function fixedDenoiseNoise(size=64):Uint8Array{
  let seed=0x1f2e3d4c;
  const values=new Uint8Array(size*size*4);
  for(let i=0;i<values.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    values[i]=seed>>>24;
  }
  return values;
}

// Multiply AO into the beauty buffer without swapping away its depth.
// Gameplay cues are deliberately not in this buffer (see GameplayOutputPass).
class ContactLightingPass extends Pass{
  readonly ao:GTAOPass;
  private readonly blend:FullScreenQuad;
  constructor(private readonly scene:THREE.Scene,private readonly camera:THREE.Camera){
    super();this.needsSwap=false;
    this.ao=new GTAOPass(scene,camera,1,1);
    this.ao.output=GTAOPass.OUTPUT.Off;
    this.ao.updateGtaoMaterial({radius:BATTLE_LIGHTING.aoRadius,thickness:1,
      distanceExponent:1.5,distanceFallOff:1,scale:1,samples:8,screenSpaceRadius:false});
    this.ao.updatePdMaterial({radius:3,samples:8,rings:2,depthPhi:2,normalPhi:3});
    this.ao.pdNoiseTexture.image.data=fixedDenoiseNoise();
    this.ao.pdNoiseTexture.needsUpdate=true;
    this.ao.blendMaterial.uniforms['intensity']!.value=BATTLE_LIGHTING.aoIntensity;
    this.ao.blendMaterial.uniforms['tDiffuse']!.value=this.ao.gtaoMap;
    this.blend=new FullScreenQuad(this.ao.blendMaterial);
  }
  override setSize(width:number,height:number){
    this.ao.setSize(Math.max(1,Math.round(width*BATTLE_LIGHTING.aoResolution)),
      Math.max(1,Math.round(height*BATTLE_LIGHTING.aoResolution)));
  }
  override render(renderer:THREE.WebGLRenderer,writeBuffer:THREE.WebGLRenderTarget,
    readBuffer:THREE.WebGLRenderTarget,deltaTime:number,maskActive:boolean){
    const overlays:THREE.Object3D[]=[];
    this.scene.traverseVisible(object=>{
      const drawable=object as THREE.Mesh&THREE.Sprite&THREE.Line&THREE.Points;
      if(drawable.isMesh||drawable.isSprite||drawable.isLine||drawable.isPoints)
        if(!receivesContactOcclusion(object))overlays.push(object);
    });
    const background=this.scene.background,override=this.scene.overrideMaterial;
    const autoClear=renderer.autoClear,shadowUpdate=renderer.shadowMap.autoUpdate;
    try{
      for(const object of overlays)object.visible=false;
      renderer.setRenderTarget(readBuffer);renderer.autoClear=true;
      renderer.render(this.scene,this.camera);
      // Updating the same sun map in the normal and overlay passes is wasteful.
      renderer.shadowMap.autoUpdate=false;
      this.ao.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
      renderer.setRenderTarget(readBuffer);renderer.autoClear=false;
      this.blend.render(renderer);
    }finally{
      for(const object of overlays)object.visible=true;
      this.scene.background=background;this.scene.overrideMaterial=override;
      renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowUpdate;
    }
  }
  override dispose(){
    this.ao.dispose();
    // Three r186's GTAOPass.dispose omits these two owned shader materials.
    this.ao.gtaoMaterial.dispose();this.ao.blendMaterial.dispose();this.blend.dispose();
  }
}

// Preserve the original direct-render semantics of UI/skill materials, including
// toneMapped:false (Veyra's core), and their original alpha/additive blending.
// OutputPass maps only the world. Copy its actual depth to the default buffer,
// then draw cues there: no guessed silhouettes and no second geometry depth pass.
class GameplayOutputPass extends Pass{
  readonly output=new OutputPass();
  readonly depthMaterial=new THREE.ShaderMaterial({
    uniforms:{tDepth:{value:null}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'uniform sampler2D tDepth; varying vec2 vUv; void main(){gl_FragDepth=texture2D(tDepth,vUv).x; gl_FragColor=vec4(0.);}',
    colorWrite:false,depthWrite:true,depthTest:true,depthFunc:THREE.AlwaysDepth,
    blending:THREE.NoBlending,toneMapped:false,
  });
  private readonly depthCopy=new FullScreenQuad(this.depthMaterial);
  constructor(private readonly scene:THREE.Scene,private readonly camera:THREE.Camera){super();this.needsSwap=false;}
  override render(renderer:THREE.WebGLRenderer,writeBuffer:THREE.WebGLRenderTarget,
    readBuffer:THREE.WebGLRenderTarget,deltaTime:number,maskActive:boolean){
    this.output.renderToScreen=true;
    this.output.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
    const world:THREE.Object3D[]=[];
    this.scene.traverseVisible(object=>{if(receivesContactOcclusion(object))world.push(object);});
    const background=this.scene.background,autoClear=renderer.autoClear,shadowUpdate=renderer.shadowMap.autoUpdate;
    try{
      renderer.setRenderTarget(null);renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;
      this.depthMaterial.uniforms['tDepth']!.value=readBuffer.depthTexture;
      this.depthCopy.render(renderer);
      for(const object of world)object.visible=false;
      this.scene.background=null;
      renderer.render(this.scene,this.camera);
    }finally{
      for(const object of world)object.visible=true;
      this.scene.background=background;renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowUpdate;
    }
  }
  override dispose(){this.output.dispose();this.depthMaterial.dispose();this.depthCopy.dispose();}
}

export async function createBattleLighting(renderer:THREE.WebGLRenderer,
  scene:THREE.Scene,camera:THREE.PerspectiveCamera){
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=BATTLE_LIGHTING.exposure;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  scene.background=new THREE.Color(BATTLE_LIGHTING.sky);
  scene.fog=new THREE.Fog(BATTLE_LIGHTING.sky,BATTLE_LIGHTING.fogNear,BATTLE_LIGHTING.fogFar);
  const sun=new THREE.DirectionalLight(BATTLE_LIGHTING.sun,BATTLE_LIGHTING.sunIntensity);
  sun.name='Battle daylight';sun.castShadow=true;
  sun.shadow.mapSize.set(BATTLE_LIGHTING.shadowSize,BATTLE_LIGHTING.shadowSize);
  Object.assign(sun.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:1,far:80});
  sun.shadow.bias=-.0001;sun.shadow.normalBias=.012;sun.shadow.radius=1;
  scene.add(sun,sun.target);
  // Sky PMREM is the only fill. No extra hemisphere light lifts the shadows.
  const pmrem=new THREE.PMREMGenerator(renderer);
  let source:THREE.DataTexture|undefined,environment:THREE.WebGLRenderTarget|undefined;
  let skySeparation:ReturnType<typeof separateSkyRadiance>|undefined;
  let composer:EffectComposer|undefined,contact:ContactLightingPass|undefined,output:GameplayOutputPass|undefined;
  const previousInfoAutoReset=renderer.info.autoReset;
  try{
    pmrem.compileEquirectangularShader();
    source=await new HDRLoader().loadAsync(new URL('../../assets/lighting/kloppenheim_03_puresky_1k.hdr',import.meta.url).href);
    skySeparation=separateSkyRadiance(source);
    environment=pmrem.fromEquirectangular(source);
    scene.environment=environment.texture;scene.environmentIntensity=BATTLE_LIGHTING.environmentIntensity;
    // Rotation aligns the bright sky with the established upper-left key.
    scene.environmentRotation.set(0,.65,0);
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4,
      depthTexture:new THREE.DepthTexture(1,1,THREE.UnsignedIntType)});
    composer=new EffectComposer(renderer,target);
    contact=new ContactLightingPass(scene,camera);output=new GameplayOutputPass(scene,camera);
    composer.addPass(contact);composer.addPass(output);
    renderer.info.autoReset=false;
  }catch(error){
    contact?.dispose();output?.dispose();composer?.dispose();environment?.dispose();
    scene.environment=null;scene.remove(sun,sun.target);sun.dispose();
    throw error;
  }finally{source?.dispose();pmrem.dispose();}
  const pipeline=composer,occlusion=contact,finalOutput=output,environmentTarget=environment;
  let disposed=false;
  return {
    follow(focus:THREE.Vector3){
      sun.position.set(focus.x-16,24,focus.z+10);sun.target.position.copy(focus);sun.target.updateMatrixWorld();
    },
    resize(width:number,height:number){
      pipeline.setPixelRatio(renderer.getPixelRatio());pipeline.setSize(width,height);
    },
    render(){
      const target=renderer.getRenderTarget(),clearColor=renderer.getClearColor(new THREE.Color()),clearAlpha=renderer.getClearAlpha();
      renderer.info.reset();
      try{pipeline.render(0);}finally{
        renderer.setRenderTarget(target);renderer.setClearColor(clearColor,clearAlpha);
      }
    },
    inspect(){
      let environmentReceivers=0,unlitOrTransparent=0;
      scene.traverseVisible(object=>{
        if(receivesContactOcclusion(object))environmentReceivers++;
        else if((object as THREE.Mesh).isMesh)unlitOrTransparent++;
      });
      return {environment:'kloppenheim_03_puresky_1k',skySeparation,environmentIntensity:BATTLE_LIGHTING.environmentIntensity,pmrem:scene.environment===environmentTarget.texture,
        environmentReceivers,unlitOrTransparent,sun:{intensity:sun.intensity,shadowType:'PCF',shadowMapSize:sun.shadow.mapSize.x,normalBias:sun.shadow.normalBias,bias:sun.shadow.bias},fog:{near:BATTLE_LIGHTING.fogNear,far:BATTLE_LIGHTING.fogFar},toneMapping:'ACESFilmic',exposure:BATTLE_LIGHTING.exposure,
        ao:'GTAO contact, deterministic 8 samples, 75% resolution',aoWidth:occlusion.ao.width,aoHeight:occlusion.ao.height,
        colorPipeline:'linear half-float MSAA -> contact AO -> OutputPass sRGB -> copy world depth -> original gameplay cues'};
    },
    dispose(){
      if(disposed)return;disposed=true;
      occlusion.dispose();finalOutput.dispose();pipeline.dispose();
      if(scene.environment===environmentTarget.texture)scene.environment=null;
      environmentTarget.dispose();scene.remove(sun,sun.target);sun.dispose();
      renderer.info.autoReset=previousInfoAutoReset;
    },
  };
}
export type BattleLighting=Awaited<ReturnType<typeof createBattleLighting>>;
