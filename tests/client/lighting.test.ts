import {readFile} from 'node:fs/promises';
import {separateSkyRadiance} from '../../src/render/sky-radiance.js';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {BATTLE_LIGHTING,createBattleLighting,fixedDenoiseNoise,receivesContactOcclusion} from '../../src/render/lighting.js';

const io=vi.hoisted(()=>({source:null as any,environment:null as any,pmrem:null as any,sourceDispose:null as any,fail:false,invalid:false}));
// Only the HDR network load and GPU PMREM conversion are replaced. Composer,
// GTAO, OutputPass and all application render/visibility/dispose logic are real.
vi.mock('three',async original=>{
  const actual=await original<typeof import('three')>();
  return {...actual,PMREMGenerator:class{
    compileEquirectangularShader=vi.fn();dispose=vi.fn();
    fromEquirectangular=vi.fn(()=>io.environment=new actual.WebGLRenderTarget(16,16));
    constructor(){io.pmrem=this;}
  }};
});
vi.mock('three/addons/loaders/HDRLoader.js',()=>({HDRLoader:class{
  async loadAsync(){if(io.fail)throw new Error('HDR load failed');io.source=new THREE.DataTexture(new Float32Array(64*32*4).fill(.4),64,32);if(io.invalid)io.source.image.data[0]=NaN;io.sourceDispose=vi.spyOn(io.source,'dispose');return io.source;}
}}));
afterEach(()=>{io.fail=false;io.invalid=false;vi.restoreAllMocks();});

function fixture(){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,16/9,.1,200);
  const world=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());world.name='actor';
  const bar=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({depthTest:false}));bar.name='health';
  const effect=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,toneMapped:false}));effect.name='skill';
  const hidden=new THREE.Mesh(world.geometry,world.material);hidden.visible=false;hidden.name='hidden';
  scene.add(world,bar,effect,hidden);
  const calls:any[]=[],clearColor=new THREE.Color();let target:THREE.WebGLRenderTarget|null=null,alpha=1;
  const renderer={
    shadowMap:{enabled:false,type:THREE.BasicShadowMap,autoUpdate:true},autoClear:true,
    info:{autoReset:true,reset:vi.fn()},toneMapping:THREE.NoToneMapping,toneMappingExposure:1,
    outputColorSpace:THREE.SRGBColorSpace,getPixelRatio:()=>1.5,
    getRenderTarget:()=>target,setRenderTarget:(next:THREE.WebGLRenderTarget|null)=>{target=next;},
    getClearColor:(out:THREE.Color)=>out.copy(clearColor),setClearColor:(color:THREE.ColorRepresentation,opacity?:number)=>{clearColor.set(color);if(opacity!==undefined)alpha=opacity;},
    getClearAlpha:()=>alpha,setClearAlpha:(value:number)=>{alpha=value;},clear:vi.fn(),
    render:vi.fn((object:THREE.Object3D)=>{
      const visible:string[]=[];if(object===scene)scene.traverseVisible(child=>{if((child as THREE.Mesh).isMesh)visible.push(child.name);});
      calls.push({object,target,visible,autoClear:renderer.autoClear,shadowUpdate:renderer.shadowMap.autoUpdate,
        override:scene.overrideMaterial,background:scene.background});
    }),
  };
  return {scene,camera,world,bar,effect,hidden,renderer:renderer as unknown as THREE.WebGLRenderer,calls};
}

describe('fixed battle lighting pipeline (no pixel-quality assertion)',()=>{
  it('separates only the solar neighbourhood, preserving the rest of the HDR and alpha',()=>{
    const data=new Float32Array(128*64*4).fill(.4);for(let i=3;i<data.length;i+=4)data[i]=1;
    const sun=(12*128+45)*4;data[sun]=data[sun+1]=data[sun+2]=10000;
    const original=data.slice(),texture=new THREE.DataTexture(data,128,64),report=separateSkyRadiance(texture);
    expect(report.separated).toBe(true);expect(report.peakX).toBe(45);expect(report.peakY).toBe(12);
    expect(data[sun]).toBeCloseTo(.4);expect(report.pixels).toBeLessThan(data.length/4*.02);
    expect(data.slice(32*128*4)).toEqual(original.slice(32*128*4));
    for(let i=3;i<data.length;i+=4)expect(data[i]).toBe(1);
  });
  it('does not flatten an overcast sky or accept invalid radiance',()=>{
    const data=new Float32Array(64*32*4).fill(.4),original=data.slice();
    expect(separateSkyRadiance(new THREE.DataTexture(data,64,32)).separated).toBe(false);expect(data).toEqual(original);
    expect(()=>separateSkyRadiance(new THREE.DataTexture(new Uint8Array(16),2,2))).toThrow('linear half/float');
  });
  it.each([NaN,Infinity,-1])('rejects invalid HDR radiance %s without partial edits',value=>{
    const data=new Float32Array(64*32*4).fill(.4);data[(30*64+10)*4]=value;const original=data.slice();
    expect(()=>separateSkyRadiance(new THREE.DataTexture(data,64,32))).toThrow('Invalid HDR radiance sample');
    expect(data).toEqual(original);
  });
  it('releases the loaded HDR and PMREM helper if sky processing fails',async()=>{
    const f=fixture();io.invalid=true;
    await expect(createBattleLighting(f.renderer,f.scene,f.camera)).rejects.toThrow('Invalid HDR radiance sample');
    expect(io.sourceDispose).toHaveBeenCalledOnce();expect(io.pmrem.dispose).toHaveBeenCalledOnce();
    expect(f.scene.environment).toBeNull();expect(f.scene.children.some(object=>(object as THREE.Light).isLight)).toBe(false);
  });
  it('keeps the adopted sky above zero while removing its unshadowed sun energy',async()=>{
    const {HDRLoader}=await vi.importActual<typeof import('three/addons/loaders/HDRLoader.js')>('three/addons/loaders/HDRLoader.js');
    const buffer=await readFile(new URL('../../assets/lighting/kloppenheim_03_puresky_1k.hdr',import.meta.url));
    const hdr=new HDRLoader().parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),data=hdr.data as Uint16Array;
    const original=data.slice(),texture=new THREE.DataTexture(data,hdr.width,hdr.height),report=separateSkyRadiance(texture);
    expect(report.separated).toBe(true);expect(report.peakLuminance).toBeGreaterThan(30000);expect(report.pixels).toBeLessThan(5000);
    const irradiance=(values:Uint16Array)=>{
      let sum=0;for(let y=0;y<hdr.height/2;y++){const theta=(y+.5)*Math.PI/hdr.height,weight=Math.sin(theta)*Math.cos(theta)*2*Math.PI/hdr.width/hdr.height;
        for(let x=0;x<hdr.width;x++)sum+=THREE.DataUtils.fromHalfFloat(values[(y*hdr.width+x)*4+1]!)*weight;}
      return sum;
    };
    const before=irradiance(original),after=irradiance(data);
    expect(after).toBeGreaterThan(.3);expect(after/before).toBeLessThan(.65);expect(after/before).toBeGreaterThan(.35);
    const offset=hdr.width*hdr.height*2*data.BYTES_PER_ELEMENT;
    expect(Buffer.from(data.buffer,data.byteOffset+offset,data.byteLength-offset).equals(Buffer.from(original.buffer,original.byteOffset+offset,original.byteLength-offset))).toBe(true);
  });
  it('only opaque depth-writing PBR geometry participates in AO',()=>{
    const {world,bar,effect}=fixture();
    expect(receivesContactOcclusion(world)).toBe(true);
    expect(receivesContactOcclusion(bar)).toBe(false);expect(receivesContactOcclusion(effect)).toBe(false);
    const translucent=new THREE.Mesh(world.geometry,new THREE.MeshStandardMaterial({transparent:true}));
    expect(receivesContactOcclusion(translucent)).toBe(false);
    expect(receivesContactOcclusion(new THREE.Group())).toBe(false);
  });
  it('noise is fixed across instances and does not consume global random state',()=>{
    const random=vi.spyOn(Math,'random');const a=fixedDenoiseNoise(),b=fixedDenoiseNoise();
    expect(a).toEqual(b);expect(a.length).toBe(64*64*4);expect(new Set(a).size).toBe(256);
    expect(random).not.toHaveBeenCalled();
  });
  it('keeps world depth, applies AO before cues, then performs one output conversion',async()=>{
    const f=fixture(),add=vi.spyOn(EffectComposer.prototype,'addPass');
    const rig=await createBattleLighting(f.renderer,f.scene,f.camera);
    expect(add.mock.calls.map(([pass])=>pass.constructor.name)).toEqual(['ContactLightingPass','GameplayOutputPass']);
    const contact=add.mock.calls[0]![0] as any,gameplay=add.mock.calls[1]![0] as any,output=gameplay.output as OutputPass;
    expect(contact.needsSwap).toBe(false);expect(contact.ao).toBeInstanceOf(GTAOPass);
    expect(contact.ao.output).toBe(GTAOPass.OUTPUT.Off);
    expect(contact.ao.gtaoMaterial.uniforms.radius.value).toBe(BATTLE_LIGHTING.aoRadius);
    expect(contact.ao.gtaoMaterial.defines.SAMPLES).toBe(8);
    expect(contact.ao.pdNoiseTexture.image.data).toEqual(fixedDenoiseNoise());
    expect(f.scene.environment).toBe(io.environment.texture);expect(f.scene.environmentIntensity).toBe(.45);
    expect(f.scene.fog!.color).toEqual(f.scene.background);
    expect(f.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    rig.resize(1280,720);expect(contact.ao.width).toBe(1440);expect(contact.ao.height).toBe(810);
    rig.follow(new THREE.Vector3(-28,0,0));
    const sun=f.scene.getObjectByName('Battle daylight') as THREE.DirectionalLight;
    expect(sun.position.toArray()).toEqual([-44,24,10]);expect(sun.shadow.mapSize.x).toBe(2048);expect(sun.shadow.normalBias).toBe(.012);expect(sun.shadow.bias).toBe(-.0001);
    expect(f.renderer.shadowMap.type).toBe(THREE.PCFShadowMap);expect(f.scene.children.filter(o=>(o as THREE.Light).isLight)).toHaveLength(1);
    rig.render();
    const scenes=f.calls.filter(call=>call.object===f.scene);
    expect(scenes).toHaveLength(3);
    expect(scenes[0].visible).toEqual(['actor']);expect(scenes[0].autoClear).toBe(true);
    expect(scenes[1].visible).toEqual(['actor']);expect(scenes[1].override).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(scenes[1].shadowUpdate).toBe(false);
    expect(scenes[2].visible).toEqual(['health','skill']);expect(scenes[2].target).toBeNull();
    expect(gameplay.depthMaterial.uniforms.tDepth.value).toBe(scenes[0].target.depthTexture);
    expect(gameplay.depthMaterial.colorWrite).toBe(false);expect(gameplay.depthMaterial.depthWrite).toBe(true);
    expect(gameplay.depthMaterial.depthFunc).toBe(THREE.AlwaysDepth);
    expect(gameplay.depthMaterial.fragmentShader).toContain('gl_FragDepth=texture2D(tDepth,vUv).x');
    expect(scenes[2].autoClear).toBe(false);expect(scenes[2].background).toBeNull();
    expect(f.calls.at(-1).object).toBe(f.scene);expect(f.calls.at(-2).object.material).toBe(gameplay.depthMaterial);expect(f.calls.at(-3).object.material).toBe(output.material);expect(output.material.defines).toHaveProperty('ACES_FILMIC_TONE_MAPPING');
    expect(output.material.defines).toHaveProperty('SRGB_TRANSFER');
    expect(f.world.visible&&f.bar.visible&&f.effect.visible).toBe(true);expect(f.hidden.visible).toBe(false);
    expect((f.effect.material as THREE.Material).toneMapped).toBe(false);
    expect(f.scene.overrideMaterial).toBeNull();expect(f.renderer.autoClear).toBe(true);expect(f.renderer.shadowMap.autoUpdate).toBe(true);
    const envDispose=vi.spyOn(io.environment,'dispose'),aoDispose=vi.spyOn(contact.ao,'dispose');
    const gtaoShader=vi.spyOn(contact.ao.gtaoMaterial,'dispose'),blendShader=vi.spyOn(contact.ao.blendMaterial,'dispose');
    const depthDispose=vi.spyOn(gameplay.depthMaterial,'dispose'),outputDispose=vi.spyOn(output,'dispose'),sunDispose=vi.spyOn(sun,'dispose');
    rig.dispose();rig.dispose();
    for(const spy of [envDispose,aoDispose,gtaoShader,blendShader,outputDispose,depthDispose,sunDispose])expect(spy).toHaveBeenCalledTimes(1);
    expect(f.scene.environment).toBeNull();expect(f.renderer.info.autoReset).toBe(true);expect(io.pmrem.dispose).toHaveBeenCalledOnce();expect(io.sourceDispose).toHaveBeenCalledOnce();
  });
  it.each([1,2,6,7,8])('restores renderer state when draw %i fails',async failAt=>{
    const f=fixture(),rig=await createBattleLighting(f.renderer,f.scene,f.camera),background=f.scene.background;
    f.renderer.setClearColor('#123456',.35);
    const original=f.renderer.render.bind(f.renderer);let draws=0;
    vi.mocked(f.renderer.render).mockImplementation((...args)=>{if(++draws===failAt)throw new Error('renderer failure');original(...args);});
    expect(()=>rig.render()).toThrow('renderer failure');
    expect(f.world.visible&&f.bar.visible&&f.effect.visible).toBe(true);expect(f.hidden.visible).toBe(false);
    expect(f.scene.background).toBe(background);expect(f.scene.overrideMaterial).toBeNull();
    expect(f.renderer.autoClear&&f.renderer.shadowMap.autoUpdate).toBe(true);
    expect(f.renderer.getRenderTarget()).toBeNull();
    expect(f.renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456');expect(f.renderer.getClearAlpha()).toBe(.35);rig.dispose();
  });
  it('releases initialization resources and rejects missing HDR rather than claiming IBL',async()=>{
    const f=fixture();io.fail=true;
    await expect(createBattleLighting(f.renderer,f.scene,f.camera)).rejects.toThrow('HDR load failed');
    expect(io.pmrem.dispose).toHaveBeenCalledOnce();expect(f.scene.environment).toBeNull();
    expect(f.scene.children.some(object=>(object as THREE.Light).isLight)).toBe(false);
  });
});
