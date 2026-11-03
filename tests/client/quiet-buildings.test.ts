import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {applyQuietBuildings,bindQuietStone} from '../../src/render/quiet-buildings.js';
import type {BattleAssets} from '../../src/render/battle-assets.js';
const ids=['tower-teal','tower-rust','barracks-teal','barracks-rust','base-teal','base-rust'];
async function load():Promise<BattleAssets>{
 const models:Record<string,GLTF>={};
 for(const id of ids){const loader=new GLTFLoader().register(()=>({name:'CPU_embedded_texture_identity',loadTexture:async()=>new THREE.Texture()}));const bytes=await readFile(new URL(`../../asset-pipeline/battle/exported/${id}.glb`,import.meta.url));models[id]=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
 return {models,dispose(){}};
}
const textures=()=>({road:new THREE.Texture(),forest:new THREE.Texture(),wall:new THREE.Texture(),dispose(){}});
function snapshot(assets:BattleAssets){const result=new Map<THREE.Mesh,{geometry:THREE.BufferGeometry;material:THREE.Material|THREE.Material[]}>();for(const model of Object.values(assets.models))model.scene.traverse(o=>{if(o instanceof THREE.Mesh)result.set(o,{geometry:o.geometry,material:o.material});});return result;}
function compile(material:THREE.Material){const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <map_fragment>'};material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);return shader;}
describe('quiet buildings integrated ownership',()=>{
 it('applies all six actual GLBs, preserves atlas and original UV, restores exactly once',async()=>{
 const assets=await load(),before=snapshot(assets),family=textures(),binding=applyQuietBuildings(assets,family);expect(binding.coverage).toHaveLength(6);
 let changed=0;const releases:ReturnType<typeof vi.fn>[]=[];
 for(const [mesh,original] of before){if(mesh.geometry===original.geometry){expect(mesh.material).toBe(original.material);continue;}changed++;
 const source=original.material as THREE.MeshStandardMaterial,material=mesh.material as THREE.MeshStandardMaterial;
 expect(material).not.toBe(source);expect(material.map).toBe(source.map);expect(Array.from(mesh.geometry.getAttribute('uv').array)).toEqual(Array.from(original.geometry.getAttribute('uv').array));
 const a=vi.fn(),b=vi.fn();mesh.geometry.addEventListener('dispose',a);material.addEventListener('dispose',b);releases.push(a,b);
 const shader=compile(material);expect(shader.vertexShader).toContain('quietStonePosition/4.0');for(const plane of ['yz','xz','xy'])expect(shader.fragmentShader).toContain(`vQuietStonePosition.${plane}`);expect(shader.fragmentShader).toContain('step(0.999,vQuietStone)');expect(shader.uniforms).toHaveProperty('quietWall.value',family.wall);
 }
 expect(changed).toBe(6);binding.dispose();binding.dispose();for(const fn of releases)expect(fn).toHaveBeenCalledTimes(1);for(const [mesh,s] of before){expect(mesh.geometry).toBe(s.geometry);expect(mesh.material).toBe(s.material);}
 });
 it('rolls back all five preceding real assets when the final one is missing',async()=>{
 const assets=await load();delete assets.models['base-rust'];const before=snapshot(assets);
 const materials=vi.spyOn(THREE.Material.prototype,'dispose'),geometries=vi.spyOn(THREE.BufferGeometry.prototype,'dispose');
 try{expect(()=>applyQuietBuildings(assets,textures())).toThrow('base-rust');expect(materials).toHaveBeenCalledTimes(5);expect(geometries).toHaveBeenCalledTimes(5);for(const [mesh,s] of before){expect(mesh.geometry).toBe(s.geometry);expect(mesh.material).toBe(s.material);}}finally{materials.mockRestore();geometries.mockRestore();}
 });
 it('chains the previous compile hook and cache key',()=>{
 const material=new THREE.MeshStandardMaterial(),previous=vi.fn((shader:THREE.WebGLProgramParametersWithUniforms)=>{shader.vertexShader+='\n// prior';});material.onBeforeCompile=previous;material.customProgramCacheKey=()=> 'original-key';bindQuietStone(material,new THREE.Texture());const result=compile(material);expect(previous).toHaveBeenCalledTimes(1);expect(result.vertexShader).toContain('// prior');expect(material.customProgramCacheKey()).toBe('original-key|quiet-stone-v1');
 });
 it('preserves source hooks when creating candidate material clones',async()=>{
 const assets=await load();let target:THREE.Mesh|undefined;assets.models['base-teal']!.scene.traverse(o=>{if(o instanceof THREE.Mesh)target=o;});const material=target!.material as THREE.Material,hook=vi.fn();material.onBeforeCompile=hook;material.customProgramCacheKey=()=> 'source-hook';const binding=applyQuietBuildings(assets,textures());compile(target!.material as THREE.Material);expect(hook).toHaveBeenCalledTimes(1);expect((target!.material as THREE.Material).customProgramCacheKey()).toContain('source-hook');binding.dispose();
 });
 it('rejects a renamed body and restores all earlier assets instead of applying a partial layer',async()=>{
 const assets=await load(),before=snapshot(assets);assets.models['base-rust']!.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.name='unrecognized-body';});expect(()=>applyQuietBuildings(assets,textures())).toThrow('Missing explicit stone coverage base-rust');for(const [mesh,s] of before){expect(mesh.geometry).toBe(s.geometry);expect(mesh.material).toBe(s.material);}
 });

});
