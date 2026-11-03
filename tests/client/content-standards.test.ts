import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createContentStandards} from '../../src/capture/content-standards.js';
import {applyQuietBuildings} from '../../src/render/quiet-buildings.js';
import layout from '../../asset-pipeline/quiet-family/standards/layout-manifest.json';
const load=async()=>{const models:Record<string,GLTF>={};for(const id of ['tower-teal','tower-rust','barracks-teal','barracks-rust','base-teal','base-rust','veyra-teal']){
 const source=id==='veyra-teal'?`asset-pipeline/heroes/veyra-release/exported/${id}.glb`:`asset-pipeline/battle/exported/${id}.glb`,bytes=await readFile(source);
 const entry=layout.entries.find(e=>e.source===source);if(entry)expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sourceSha256);
 const loader=new GLTFLoader().register(()=>({name:'CPU_texture_stub',loadTexture:async()=>new THREE.Texture()}));models[id]=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 }return {models,dispose(){}};};
const textureFamily=()=>({road:new THREE.Texture(),forest:new THREE.Texture(),wall:new THREE.Texture(),dispose(){}});
const compile=(m:THREE.Material)=>{const s={uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <begin_vertex>\n#include <project_vertex>',fragmentShader:'#include <map_fragment>'};m.onBeforeCompile(s as any,{} as THREE.WebGLRenderer);return s;};
describe('production content standard consumer',()=>{
 it('uses all five unchanged source slots, production stone hooks, true rig and world-source terrain sampling',async()=>{
  const assets=await load(),textures=textureFamily(),binding=applyQuietBuildings(assets,textures),lineup=createContentStandards(assets,'forest-light-v1',textures,textures);
  expect(lineup.inspect().slotCount).toBe(5);expect(lineup.inspect().heroClips.sort()).toEqual(['attack','death','hurt','idle','walk']);
  for(const id of ['tower','barracks','base']){
   const parent=lineup.root.getObjectByName(`standard-${id}`)!;expect(parent.position.toArray()).toEqual(layout.entries.find(e=>e.id===id)!.position);expect(parent.scale.toArray()).toEqual([1,1,1]);
   let bound=0;parent.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh&&mesh.geometry.getAttribute('quietStoneMask')){bound++;const shader=compile(mesh.material as THREE.Material);expect(shader.fragmentShader).toContain('step(0.999,vQuietStone)');expect(shader.uniforms['quietWall']!.value).toBe(textures.wall);}});expect(bound).toBeGreaterThan(0);
  }
  const shoulder=lineup.root.getObjectByName('standard-shoulder-section')!;for(const child of shoulder.children){const mesh=child as THREE.Mesh,shader=compile(mesh.material as THREE.Material);expect(shader.vertexShader).toContain('.xz-quietStandardOffset');expect((shader.uniforms['quietStandardOffset']!.value as THREE.Vector2).toArray()).toEqual([shoulder.position.x,shoulder.position.z]);expect(shader.fragmentShader).toContain('smoothstep(-0.4,0.4,quietDistance(vQuietWorld))');
   const vertices=mesh.geometry.getAttribute('position');lineup.root.updateMatrixWorld(true);for(let i=0;i<vertices.count;i++){const p=new THREE.Vector3().fromBufferAttribute(vertices,i),world=p.clone().applyMatrix4(mesh.matrixWorld);expect(world.x-shoulder.position.x).toBeCloseTo(p.x);expect(world.z-shoulder.position.z).toBeCloseTo(p.z);}
  }
  const hero=lineup.root.getObjectByName('standard-hero')!,position=hero.position.clone();let skins=0;hero.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skins++;});expect(skins).toBeGreaterThan(0);const bonesBefore:number[]=[];hero.traverse(o=>{if((o as THREE.Bone).isBone)bonesBefore.push(...o.position.toArray(),...o.quaternion.toArray());});lineup.advance(.5);const bonesAfter:number[]=[];hero.traverse(o=>{if((o as THREE.Bone).isBone)bonesAfter.push(...o.position.toArray(),...o.quaternion.toArray());});expect(bonesAfter).not.toEqual(bonesBefore);expect(hero.position.equals(position)).toBe(true);expect(lineup.inspect().heroTime).toBe(.5);
  let sourceDisposed=0;for(const asset of Object.values(assets.models))asset.scene.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.addEventListener('dispose',()=>sourceDisposed++);});lineup.dispose();lineup.dispose();expect(sourceDisposed).toBe(0);expect(lineup.root.children).toHaveLength(0);binding.dispose();
 });
 it('keeps baseline original materials, shares textures without owning them, and rejects missing source before allocation',async()=>{
  const assets=await load(),textures=textureFamily();let textureDisposals=0;for(const t of [textures.road,textures.forest,textures.wall])t.addEventListener('dispose',()=>textureDisposals++);
  const baseline=createContentStandards(assets,'baseline',textures);expect(baseline.inspect().materials).toBe('baseline');const mesh=baseline.root.getObjectByName('standard-shoulder-road') as THREE.Mesh;expect(compile(mesh.material as THREE.Material).fragmentShader).toBe('#include <map_fragment>');
  baseline.dispose();expect(textureDisposals).toBe(0);delete assets.models['base-teal'];expect(()=>createContentStandards(assets,'baseline',textures)).toThrow('base-teal');
 });
});

it('late missing clips dispose only owned shoulder and cloned skeleton resources',async()=>{
 const assets=await load(),textures=textureFamily();assets.models['veyra-teal']!.animations=[];
 const shared=new Set<object>();for(const asset of Object.values(assets.models))asset.scene.traverse(o=>{const m=o as THREE.SkinnedMesh;if(m.isMesh){shared.add(m.geometry);for(const x of Array.isArray(m.material)?m.material:[m.material])shared.add(x);}if(m.isSkinnedMesh)shared.add(m.skeleton);});
 const g=vi.spyOn(THREE.BufferGeometry.prototype,'dispose'),m=vi.spyOn(THREE.Material.prototype,'dispose'),k=vi.spyOn(THREE.Skeleton.prototype,'dispose'),t=vi.spyOn(THREE.Texture.prototype,'dispose');
 try{expect(()=>createContentStandards(assets,'baseline',textures)).toThrow();expect(g).toHaveBeenCalledTimes(2);expect(m).toHaveBeenCalledTimes(2);expect(k.mock.calls.length).toBeGreaterThan(0);for(const owner of [...g.mock.instances,...m.mock.instances,...k.mock.instances])expect(shared.has(owner)).toBe(false);expect(t).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();}
});
