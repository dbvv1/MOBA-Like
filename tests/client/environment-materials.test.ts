import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {environmentCandidate,environmentSpecs,loadEnvironmentFamily,projectedGeometry} from '../../src/render/environment-materials.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createBattlefield} from '../../src/render/battlefield.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';
const {PNG}=createRequire(import.meta.url)('pngjs');
async function actualAssets(){
 const loader=new GLTFLoader().register(parser=>({name:'CPU_PNG',async loadTexture(index:number){const texture=parser.json.textures[index],image=parser.json.images[texture.source],bytes=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(bytes));const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;return value;}}));
 return loadBattleAssets(async url=>{const path=url.split('?')[0]!,bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
}
const mockLoad=async()=>new THREE.Texture();
describe('optional environment material family',()=>{
 it('opts in only at the exact version and never selects original forest v1',()=>{
  for(const query of ['', '?environment-materials=v2','?environment-materials=true'])expect(environmentCandidate(query)).toBe(false);
  expect(environmentCandidate('?environment-materials=v1')).toBe(true);expect(environmentSpecs.forest.url).toContain('forest-edge-albedo-v2.png');
 });
 it('maps reused translated geometry in world metres, preserving overlapping lane phase',()=>{
  const plane=new THREE.PlaneGeometry(12,10);plane.rotateX(-Math.PI/2);
  const a=new THREE.Mesh(plane),b=new THREE.Mesh(plane);a.position.x=6;b.position.x=18;
  const ga=projectedGeometry(a,8),gb=projectedGeometry(b,8);
  const ua=ga.getAttribute('uv'),ub=gb.getAttribute('uv');
  expect(Math.max(...Array.from({length:ua.count},(_,i)=>ua.getX(i)))).toBe(1.5);
  expect(Math.min(...Array.from({length:ub.count},(_,i)=>ub.getX(i)))).toBe(1.5);
  expect(plane.getAttribute('uv').getX(0)).toBe(0);ga.dispose();gb.dispose();plane.dispose();
 });
 it('gives vertical foundation faces noncollapsed, finite UVs without changing vertex positions',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,.03,4));mesh.rotation.y=Math.PI/2;mesh.position.set(-20,0,0);
  const geom=projectedGeometry(mesh,4,true),uv=geom.getAttribute('uv');
  for(const v of uv.array)expect(Number.isFinite(v)).toBe(true);
  for(let i=0;i<uv.count;i+=3){const area=(uv.getX(i+1)-uv.getX(i))*(uv.getY(i+2)-uv.getY(i))-(uv.getX(i+2)-uv.getX(i))*(uv.getY(i+1)-uv.getY(i));expect(Math.abs(area)).toBeGreaterThan(0);}
  expect(geom.getAttribute('position').array).toEqual(mesh.geometry.toNonIndexed().getAttribute('position').array);geom.dispose();mesh.geometry.dispose();
 });
 it('shares three white-base sRGB materials, mirrored sampling and idempotent release',async()=>{
  const textures=[new THREE.Texture(),new THREE.Texture(),new THREE.Texture()],spies=textures.map(t=>vi.spyOn(t,'dispose'));let n=0;
  const family=await loadEnvironmentFamily(undefined,async()=>textures[n++]!);
  const meshes=Array.from({length:18},()=>new THREE.Mesh(new THREE.PlaneGeometry(1,1)));
  for(const mesh of meshes)family.apply(mesh,'lane');
  expect(new Set(meshes.map(m=>m.material)).size).toBe(1);
  for(const material of Object.values(family.materials)){expect(material.color.getHex()).toBe(0xffffff);expect(material.vertexColors).toBe(false);expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);expect(material.map!.wrapS).toBe(THREE.MirroredRepeatWrapping);}
  const gs=meshes.map(m=>vi.spyOn(m.geometry,'dispose')),ms=Object.values(family.materials).map(m=>vi.spyOn(m,'dispose'));
  family.dispose();family.dispose();for(const spy of [...spies,...gs,...ms])expect(spy).toHaveBeenCalledTimes(1);
 });
 it('cleans successful and late textures after one load fails or cancellation',async()=>{
  const texture=new THREE.Texture(),spy=vi.spyOn(texture,'dispose');let n=0;
  await expect(loadEnvironmentFamily(undefined,async()=>{if(n++===1)throw new Error('decode');return texture;})).rejects.toThrow('decode');expect(spy).toHaveBeenCalledTimes(1);
  const controller=new AbortController(),late=new THREE.Texture(),lateSpy=vi.spyOn(late,'dispose');
  const pending=loadEnvironmentFamily(controller.signal,async()=>{await Promise.resolve();return late;});controller.abort();await expect(pending).rejects.toThrow('cancelled');expect(lateSpy).toHaveBeenCalledTimes(1);
 });
 it('decodes the three original PNG sources on CPU at their actual dimensions',async()=>{
  for(const name of ['lane-stone-albedo.png','structure-stone-albedo.png','forest-edge-albedo-v2.png']){
   const png=PNG.sync.read(await readFile(new URL(`../../assets/environment-materials/${name}`,import.meta.url)));expect(png.width).toBe(1254);expect(png.height).toBe(1254);
  }
 });
 it('consumes real GLBs across whole lane/ground/foundations without altering atlases or simulation',async()=>{
  const assets=await actualAssets(),sim=await makeSim(10,61),snapshot=sim.snapshot(),hash=sim.finalHash();
  const originals=new Map<THREE.Mesh,{geometry:THREE.BufferGeometry;material:THREE.Material|THREE.Material[]}>();
  for(const model of Object.values(assets.models))model.scene.traverse(o=>{if(o instanceof THREE.Mesh)originals.set(o,{geometry:o.geometry,material:o.material});});
  const field=createBattlefield(getContent(10),assets,{environmentMaterials:true,loadEnvironment:signal=>loadEnvironmentFamily(signal,mockLoad)});
  field.sync(snapshot);await field.environmentReady;field.root.updateMatrixWorld(true);
  const counts={lane:0,foundation:0,forest:0,other:0};const changed:THREE.Mesh[]=[];
  field.root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
   const target=o.name==='stone-path'||o.name.startsWith('worn-edge-')?'lane':o.name==='worn-foundation'?'foundation':o.name==='EnvironmentGround'||o.name==='GroundShoulderPatches'?'forest':null;
   if(target){counts[target]++;changed.push(o);const uv=o.geometry.getAttribute('uv');expect(uv).toBeDefined();expect((o.material as THREE.MeshStandardMaterial).map).not.toBeNull();for(const v of uv.array)expect(Number.isFinite(v)).toBe(true);
    if(target!=='foundation'){const pos=o.geometry.getAttribute('position');for(let i=0;i<pos.count;i++){const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);expect(uv.getX(i)).toBeCloseTo(p.x/8,5);expect(uv.getY(i)).toBeCloseTo(p.z/8,5);}}
   }else{counts.other++;expect([...originals.values()].some(v=>v.material===o.material)||o.name==='Ground-blade'||o.name==='Ground-leaf').toBe(true);}
  });
  expect(counts.lane).toBeGreaterThan(18);expect(counts.foundation).toBeGreaterThan(0);expect(counts.forest).toBe(2);expect(counts.other).toBeGreaterThan(0);
  expect(new Set(changed.map(o=>(o.material as THREE.MeshStandardMaterial).map)).size).toBe(3);
  for(const [mesh,original] of originals){expect(mesh.geometry).toBe(original.geometry);expect(mesh.material).toBe(original.material);}
  field.advance(.016,.5);expect(sim.finalHash()).toBe(hash);expect(sim.snapshot()).toEqual(snapshot);
  const spies=changed.map(o=>vi.spyOn(o.geometry,'dispose'));field.dispose();field.dispose();assets.dispose();for(const spy of spies)expect(spy).toHaveBeenCalledTimes(1);
 });
 it('does not invoke the family loader at the default entry and handles structures born after load',async()=>{
  const assets=await actualAssets(),load=vi.fn(loadEnvironmentFamily),stable=createBattlefield(getContent(10),assets,{loadEnvironment:load});await stable.environmentReady;expect(load).not.toHaveBeenCalled();stable.dispose();
  const candidate=createBattlefield(getContent(10),assets,{environmentMaterials:true,loadEnvironment:signal=>loadEnvironmentFamily(signal,mockLoad)});await candidate.environmentReady;const sim=await makeSim(10,61);candidate.sync(sim.snapshot());let foundations=0;
  candidate.root.traverse(node=>{if(node instanceof THREE.Mesh&&node.name==='worn-foundation'){foundations++;expect((node.material as THREE.MeshStandardMaterial).map).not.toBeNull();expect(node.geometry.getAttribute('uv')).toBeDefined();}});expect(foundations).toBeGreaterThan(0);candidate.dispose();assets.dispose();
 });
 it('retains default materials on failure and never attaches a late family after destruction',async()=>{
  const assets=await actualAssets();const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const field=createBattlefield(getContent(10),assets,{environmentMaterials:true,loadEnvironment:async()=>{throw new Error('offline');}});
  await field.environmentReady;expect(((field.root.getObjectByName('EnvironmentGround') as THREE.Mesh).material as THREE.MeshStandardMaterial).map).toBeNull();expect(warning).toHaveBeenCalledTimes(1);field.dispose();warning.mockRestore();
  const family=await loadEnvironmentFamily(undefined,mockLoad),dispose=vi.spyOn(family,'dispose');let resolve!:(value:typeof family)=>void;
  const late=createBattlefield(getContent(10),assets,{environmentMaterials:true,loadEnvironment:()=>new Promise(r=>{resolve=r;})});late.dispose();resolve(family);await late.environmentReady;expect(late.root.children).toHaveLength(0);expect(dispose).toHaveBeenCalledTimes(1);assets.dispose();
 });
});
