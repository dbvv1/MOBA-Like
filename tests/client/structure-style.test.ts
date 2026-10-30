import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash,} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {parseStructureStyle} from '../../src/render/structure-style.js';
import {battleAssetUrl,loadBattleAssets} from '../../src/render/battle-assets.js';
import manifest from '../../asset-pipeline/structure-refinement/manifest.json';
const {PNG}=createRequire(import.meta.url)('pngjs');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../../',import.meta.url);
async function file(path:string){return readFile(new URL(path,root));}
function glb(bytes:Buffer){const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()),start=20+bytes.readUInt32LE(12)+8;return {json,bin:bytes.subarray(start)};}
function imageHashes(bytes:Buffer){const {json,bin}=glb(bytes);return json.images.map((im:any)=>{const b=json.bufferViews[im.bufferView],png=PNG.sync.read(bin.subarray(b.byteOffset,b.byteOffset+b.byteLength));return `${png.width}x${png.height}:${sha(png.data)}`;}).sort();}
function loader(){return new GLTFLoader().register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){
  const texture=parser.json.textures[index],image=parser.json.images[texture.source];
  const data=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(data));
  const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;
}}));}
async function parse(path:string){const b=await file(path);return loader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
function points(root:THREE.Object3D,name:string){root.updateMatrixWorld(true);const o=root.getObjectByName(name) as THREE.Mesh;const a=o.geometry.attributes['position']!;return Array.from({length:a.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).toArray().map(v=>v.toFixed(5)).join(',')).sort();}
describe('bounded architectural standard-piece recipe',()=>{
 it('requires an explicit valid flag, independent of lighting and command input',()=>{
  expect(parseStructureStyle('')).toBe('baseline');expect(parseStructureStyle('?lighting=forest-light-v1&commands=buffer-v1')).toBe('baseline');
  expect(parseStructureStyle('?structures=stonework-v1')).toBe('stonework-v1');
  expect(()=>parseStructureStyle('?structures=x')).toThrow();expect(()=>parseStructureStyle('?structures=baseline&structures=stonework-v1')).toThrow();
  expect(battleAssetUrl('tower-teal')).toContain('/battle/exported/');expect(battleAssetUrl('tower-teal','stonework-v1')).toContain('/structure-refinement/');
  expect(battleAssetUrl('tree','stonework-v1')).toBe(battleAssetUrl('tree'));
 });
 it.each(manifest.assets)('$id retains atlas pixels, original parts, limits and unedited catapult/flag/foundation',async row=>{
  const source=await file(`asset-pipeline/battle/exported/${row.id}.glb`),candidate=await file(`asset-pipeline/structure-refinement/${row.file}`);
  expect(sha(source)).toBe(row.sourceSha256);expect(sha(candidate)).toBe(row.sha256);
  expect(candidate.length).toBe(row.bytes);expect(row.triangles).toBeLessThanOrEqual(12000);
  expect(imageHashes(candidate)).toEqual(imageHashes(source));
  const before=await parse(`asset-pipeline/battle/exported/${row.id}.glb`),after=await parse(`asset-pipeline/structure-refinement/${row.file}`);
  const a=new THREE.Box3().setFromObject(before.scene),b=new THREE.Box3().setFromObject(after.scene);
  for(const axis of ['x','y','z'] as const){expect(b.min[axis]).toBeGreaterThanOrEqual(a.min[axis]-.00002);expect(b.max[axis]).toBeLessThanOrEqual(a.max[axis]+.00002);}
  for(const name of row.parts){
    const original=before.scene.getObjectByName(name)!,refined=after.scene.getObjectByName(name)!;expect(refined).toBeTruthy();
    const oldBox=new THREE.Box3().setFromObject(original),newBox=new THREE.Box3().setFromObject(refined);
    for(const axis of ['x','y','z'] as const){expect(Math.abs(newBox.min[axis]-oldBox.min[axis])).toBeLessThanOrEqual(.02502);expect(Math.abs(newBox.max[axis]-oldBox.max[axis])).toBeLessThanOrEqual(.02502);}
  }
  let actualTriangles=0;after.scene.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;actualTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes['position']!.count)/3;
    const uv=mesh.geometry.attributes['uv'];if(uv)for(let i=0;i<uv.count;i++){expect(Number.isFinite(uv.getX(i))).toBe(true);expect(Number.isFinite(uv.getY(i))).toBe(true);expect(uv.getX(i)).toBeGreaterThanOrEqual(-.00001);expect(uv.getX(i)).toBeLessThanOrEqual(1.00001);expect(uv.getY(i)).toBeGreaterThanOrEqual(-.00001);expect(uv.getY(i)).toBeLessThanOrEqual(1.00001);}
  });expect(actualTriangles).toBe(row.triangles);
  for(const name of row.unchangedParts)expect(points(after.scene,name)).toEqual(points(before.scene,name));
  const materials=new Set<THREE.Material>();after.scene.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh)for(const x of [m.material].flat())materials.add(x);});
  for(const m of materials){if(m.name==='stonework-stone')expect((m as THREE.MeshStandardMaterial).roughness).toBeCloseTo(.9,6);}
 });
 it('uses six real replacements in the existing ordered loader and disposes every owned resource once',async()=>{
  const paths:string[]=[];const assets=await loadBattleAssets(async url=>{
   const path=url.split('?')[0]!.replace(/^\//,'');paths.push(path);return parse(path);
  },'forest-light-v1','stonework-v1');
  expect(paths.filter(p=>p.includes('structure-refinement'))).toHaveLength(6);
  expect(paths.filter(p=>p.includes('/battle/'))).toHaveLength(9);
  const resources=new Set<{dispose():void}>();for(const model of Object.values(assets.models))model.scene.traverse(o=>{const mesh=o as THREE.SkinnedMesh;if(!mesh.isMesh)return;resources.add(mesh.geometry);if(mesh.isSkinnedMesh)resources.add(mesh.skeleton);for(const m of [mesh.material].flat()){resources.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)resources.add(value);}});
  const spies=[...resources].map(r=>vi.spyOn(r,'dispose'));assets.dispose();assets.dispose();for(const spy of spies)expect(spy).toHaveBeenCalledTimes(1);
 });
});
