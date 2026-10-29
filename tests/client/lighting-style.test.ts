import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {addEnvironmentLighting,applyWorldDiffuse,diffuseMaterial,lightingState,parseLightingStyle,renderRole,surfaceMaterial} from '../../src/render/lighting-style.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createBattlefield} from '../../src/render/battlefield.js';
import {createPresentation} from '../../asset-pipeline/presentation/adapter.js';
import {getContent} from '../../src/content/catalog.js';
import {CaptureSession} from '../../src/capture/session.js';
import {parseCaptureConfig} from '../../src/capture/config.js';
import {CAMERAS} from '../../src/capture/cameras.js';
import {testNavigation} from '../helpers.js';

const model=(material:THREE.Material|THREE.Material[]):GLTF=>{
  const scene=new THREE.Group();scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
  return {scene,scenes:[scene],animations:[],cameras:[],asset:{version:'2.0'},parser:null!,userData:{}};
};
const mats=(root:THREE.Object3D)=>{const result=new Set<THREE.Material>();root.traverse(node=>{if((node as THREE.Mesh).isMesh)for(const m of [((node as THREE.Mesh).material)].flat())result.add(m);});return result;};

describe('independent lighting request and explicit semantics',()=>{
  it('defaults to untouched baseline and rejects invalid/duplicate choices',()=>{
    expect(parseLightingStyle('?shot=gameplay&seed=61')).toBe('baseline');
    expect(parseLightingStyle('?lighting=stylized-diffuse')).toBe('stylized-diffuse');
    for(const query of ['?lighting=','?lighting=toon','?lighting=baseline&lighting=stylized-diffuse'])expect(()=>parseLightingStyle(query)).toThrow();
    expect(lightingState('stylized-diffuse')).toMatchObject({requested:'stylized-diffuse',configured:'stylized-diffuse',active:null,stage:'configured',toneMapping:'ACESFilmic',exposure:1.12});
  });
  it('uses world ownership, not Standard type, and leaves cues and authored unlit world alone',()=>{
    const world=new THREE.Group(),source=new THREE.MeshLambertMaterial({color:0xabc123}),a=new THREE.Mesh(new THREE.BoxGeometry(),source),b=a.clone();
    const cue=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({transparent:true,opacity:.6,depthWrite:false,toneMapped:false}));cue.userData['renderRole']='cue';
    const unlit=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:0x123456}));world.add(a,b,cue,unlit);
    const cueSource=cue.material,unlitSource=unlit.material;
    applyWorldDiffuse(world,'stylized-diffuse');
    expect(a.material).toBeInstanceOf(THREE.MeshToonMaterial);expect(a.material).toBe(b.material);
    expect(cue.material).toBe(cueSource);expect(renderRole(cue)).toBe('cue');
    expect(unlit.material).toBe(unlitSource);expect(renderRole(unlit)).toBe('world');expect(renderRole(a)).toBe('world');
    const replacement=a.material;applyWorldDiffuse(world,'stylized-diffuse');expect(a.material).toBe(replacement);
    expect(()=>diffuseMaterial(new THREE.ShaderMaterial(),'world','stylized-diffuse')).toThrow('Unsupported');
  });
  it('preserves baseline material identity and original light setup',()=>{
    const source=new THREE.MeshStandardMaterial({color:'#abc123',roughness:.8,metalness:.4});
    expect(diffuseMaterial(source,'world','baseline')).toBe(source);
    const base=new THREE.Scene();addEnvironmentLighting(base,'baseline');expect(base.children).toHaveLength(1);
    expect(base.children[0]).toBeInstanceOf(THREE.HemisphereLight);expect((base.children[0] as THREE.HemisphereLight).intensity).toBe(1.65);
    const variant=new THREE.Scene();addEnvironmentLighting(variant,'stylized-diffuse');expect(variant.children.map(o=>o.type)).toEqual(['HemisphereLight','AmbientLight']);
    expect((variant.children[1] as THREE.AmbientLight).intensity).toBe(.9);expect(variant.environment).toBeNull();
  });
});

describe('diffuse material input and resource contracts',()=>{
  it('retains source palette, UV textures, normal/emission/alpha/depth/side without mutating or owning input',()=>{
    const textures=Array.from({length:8},()=>new THREE.Texture());const source=new THREE.MeshStandardMaterial({color:'#884422',emissive:'#010203',emissiveIntensity:.3,map:textures[0]!,normalMap:textures[1]!,alphaMap:textures[2]!,emissiveMap:textures[3]!,aoMap:textures[4]!,lightMap:textures[5]!,metalnessMap:textures[6]!,roughnessMap:textures[7]!,side:THREE.DoubleSide,shadowSide:THREE.BackSide,transparent:true,opacity:.35,alphaTest:.12,depthWrite:false,depthTest:true,vertexColors:true,toneMapped:false});
    source.normalScale.set(.3,.7);source.name='authored';const before=source.toJSON(),dispose=vi.spyOn(source,'dispose');
    const target=diffuseMaterial(source,'world','stylized-diffuse') as THREE.MeshToonMaterial;
    expect(target).toBeInstanceOf(THREE.MeshToonMaterial);expect(target.color).toEqual(source.color);expect(target.color).not.toBe(source.color);expect(target.emissive).toEqual(source.emissive);expect(target.normalScale).toEqual(source.normalScale);
    for(const key of ['map','normalMap','alphaMap','emissiveMap','aoMap','lightMap','side','shadowSide','transparent','opacity','alphaTest','depthWrite','depthTest','vertexColors','toneMapped','emissiveIntensity','name'] as const)expect(target[key]).toBe(source[key]);
    expect(target.gradientMap).toBeNull();expect('envMap'in target).toBe(false);expect('metalnessMap'in target).toBe(false);
    expect(source.toJSON()).toEqual(before);expect(dispose).not.toHaveBeenCalled();
    expect(diffuseMaterial(source,'cue','stylized-diffuse')).toBe(source);
    expect(()=>diffuseMaterial(new THREE.MeshPhysicalMaterial(),'world','stylized-diffuse')).toThrow('Physical');
  });
  it('deduplicates shared source/replacement resources and PBR-only textures on disposal',async()=>{
    const map=new THREE.Texture(),unusedMap=new THREE.Texture(),source=new THREE.MeshStandardMaterial({map,roughnessMap:unusedMap}),input=model(source),sourceDispose=vi.spyOn(source,'dispose'),mapDispose=vi.spyOn(map,'dispose'),unusedDispose=vi.spyOn(unusedMap,'dispose');
    const assets=await loadBattleAssets(async()=>input,'stylized-diffuse');const target=(input.scene.children[0] as THREE.Mesh).material as THREE.Material,targetDispose=vi.spyOn(target,'dispose');
    const instance=clone(input.scene);expect((instance.children[0] as THREE.Mesh).material).toBe(target);
    expect(sourceDispose).not.toHaveBeenCalled();expect(mapDispose).not.toHaveBeenCalled();assets.dispose();assets.dispose();
    for(const spy of [sourceDispose,mapDispose,unusedDispose,targetDispose])expect(spy).toHaveBeenCalledTimes(1);
  });
  it('waits for late loads and releases them once on aggregate failure without partial conversion',async()=>{
    const source=new THREE.MeshStandardMaterial(),input=model(source),dispose=vi.spyOn(source,'dispose');let finish!:(model:GLTF)=>void,index=0;
    const pending=loadBattleAssets(()=>index++===0?Promise.reject(new Error('fixture load failure')):index===2?new Promise<GLTF>(resolve=>{finish=resolve;}):Promise.resolve(input),'stylized-diffuse');
    const rejected=expect(pending).rejects.toThrow('fixture load failure');await Promise.resolve();expect(dispose).not.toHaveBeenCalled();finish(input);await rejected;expect(dispose).toHaveBeenCalledTimes(1);expect((input.scene.children[0] as THREE.Mesh).material).toBe(source);
  });
  it('cleans converted array members even if a later unsupported member aborts assignment',async()=>{
    const source=new THREE.MeshStandardMaterial(),bad=new THREE.ShaderMaterial(),input=model([source,bad]);const dispose=vi.spyOn(THREE.MeshToonMaterial.prototype,'dispose');
    try{await expect(loadBattleAssets(async()=>input,'stylized-diffuse')).rejects.toThrow('Unsupported');expect(dispose).toHaveBeenCalledTimes(1);}finally{dispose.mockRestore();}
  });
  it('allocates procedural Toon once and retains geometry normals and vertex colors',()=>{
    const material=surfaceMaterial('stylized-diffuse',{color:'#284c43',vertexColors:true});expect(material).toBeInstanceOf(THREE.MeshToonMaterial);expect(material.vertexColors).toBe(true);
    const field=createBattlefield(getContent(11),{models:new Proxy({},{get:()=>model(new THREE.MeshToonMaterial())}),dispose(){}},'stylized-diffuse');
    const materials=mats(field.root);expect([...materials].every(m=>m instanceof THREE.MeshToonMaterial)).toBe(true);field.advance(1/60,0);expect(mats(field.root)).toEqual(materials);field.dispose();
  });
});

describe('fixed source and real prototype consumers',()=>{
  it('verifies installed 0.186.1 native direct shadow and independent indirect path',async()=>{
    const root=new URL('../../node_modules/three/',import.meta.url);expect(JSON.parse(await readFile(new URL('package.json',root),'utf8')).version).toBe('0.186.1');
    const read=(name:string)=>readFile(new URL(`src/renderers/shaders/${name}`,root),'utf8');
    const lights=await read('ShaderChunk/lights_fragment_begin.glsl.js'),toon=await read('ShaderLib/meshtoon.glsl.js'),response=await read('ShaderChunk/lights_toon_pars_fragment.glsl.js');
    expect(lights).toContain('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow');expect(lights).toContain('getAmbientLightIrradiance( ambientLightColor )');expect(lights).toContain('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )');
    expect(response).toContain('reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert');expect(toon).not.toMatch(/envmap|cube_uv_reflection/);expect(toon).toContain('reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance');
  });
  it('loads every real GLB, preserves texture identity, and keeps new hero/field instances Toon across ticks',async()=>{
    const {PNG}=createRequire(import.meta.url)('pngjs');const originals=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    const loader=new GLTFLoader().register(parser=>({name:'CPU_embedded_PNG',async loadTexture(index:number){const entry=parser.json.textures[index],image=parser.json.images[entry.source];if(image.mimeType!=='image/png')throw new Error('Expected PNG');const bytes=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(bytes));const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;}}));
    const assets=await loadBattleAssets(async url=>{const path=url.split('?')[0]!,bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));const asset=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');asset.scene.traverse(node=>{if((node as THREE.Mesh).isMesh)expect((node as THREE.Mesh).geometry.getAttribute('normal')).toBeDefined();});for(const m of mats(asset.scene)){originals.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);}return asset;},'stylized-diffuse');
    expect(originals.size).toBeGreaterThan(10);for(const asset of Object.values(assets.models))for(const m of mats(asset.scene)){expect(m).toBeInstanceOf(THREE.MeshToonMaterial);for(const value of Object.values(m))if(value instanceof THREE.Texture)expect(textures.has(value)).toBe(true);}
    const session=new CaptureSession(parseCaptureConfig('?shot=first-tower&seed=61&t=101&input=idle&frames=20')!,await testNavigation());
    const view=createPresentation({catalog:session.sim.catalog,assets:{blue:assets.models['hero-teal']!,amber:assets.models['hero-rust']!,byDefinition:{veyra:{blue:assets.models['veyra-teal']!,amber:assets.models['veyra-rust']!}}},heroesOnly:true}),field=createBattlefield(session.sim.catalog,assets,'stylized-diffuse');
    const consumer={sync(snapshot:any){view.sync(snapshot);field.sync(snapshot);},draw(seconds:number,alpha:number){view.advance(seconds,alpha);field.advance(seconds,alpha);},renderOnly(){}};
    try{
      await session.prepare(consumer);for(let i=0;i<16;i++)session.next(consumer,i);
      expect(session.metadata).toMatchObject({stateHash:'4a4767ad53dba0d9',frame:16,virtualFrame:6076});
      expect([...mats(view.root),...mats(field.root)].every(m=>m instanceof THREE.MeshToonMaterial)).toBe(true);
      expect(Object.keys(CAMERAS)).toEqual(['gameplay','spawn','barracks-road','first-tower','spawn-to-tower']);
    }finally{view.dispose();field.dispose();assets.dispose();}
  });
});
