import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareQuietStone,isQuietStoneUv} from '../../src/render/quiet-stone.js';
const {PNG}=createRequire(import.meta.url)('pngjs');
async function load(id:string){
 const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_embedded_PNG',async loadTexture(index:number){
 const texture=parser.json.textures[index],image=parser.json.images[texture.source];
 if(image.mimeType!=='image/png')throw new Error('Expected embedded PNG');
 const png=PNG.sync.read(Buffer.from(await parser.getDependency('bufferView',image.bufferView)));
 const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;return value;
 }}));
 const bytes=await readFile(new URL(`../../asset-pipeline/battle/exported/${id}.glb`,import.meta.url));
 return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}
describe('quiet family explicit real-GLB stone masks',()=>{
 for(const kind of ['tower','barracks','base'])for(const team of ['teal','rust'])it(`${kind}-${team} preserves geometry and protects non-stone triangles`,async()=>{
 const id=`${kind}-${team}`,root=await load(id);
 const originals=new Map<THREE.Mesh,THREE.BufferGeometry>();root.traverse(o=>{if(o instanceof THREE.Mesh)originals.set(o,o.geometry);});
 const binding=prepareQuietStone(root,id);expect(binding.meshes).toHaveLength(1);
 expect(binding.coverage[0]!.stoneTriangles).toBeGreaterThan(100);expect(binding.coverage[0]!.protectedTriangles).toBeGreaterThan(0);
 for(const [mesh,original] of originals){
 if(!binding.meshes.includes(mesh)){expect(mesh.geometry).toBe(original);continue;}
 const g=mesh.geometry;expect(g).not.toBe(original);expect(Array.from(g.index!.array)).toEqual(Array.from(original.index!.array));
 for(const key of Object.keys(original.attributes))expect(Array.from(g.getAttribute(key).array)).toEqual(Array.from(original.getAttribute(key).array));
 expect(g.getAttribute('quietStonePosition').count).toBe(g.getAttribute('position').count);expect(g.getAttribute('quietStoneNormal').count).toBe(g.getAttribute('normal').count);
 const mask=g.getAttribute('quietStoneMask'),physical=g.getAttribute('quietStoneUv'),uv=g.getAttribute('uv');
 for(let i=0;i<mask.count;i++){expect(Number.isFinite(physical.getX(i))&&Number.isFinite(physical.getY(i))).toBe(true);if(mask.getX(i))expect(isQuietStoneUv(uv.getX(i),uv.getY(i))).toBe(true);}
 for(let i=0;i<g.index!.count;i+=3){const values=[0,1,2].map(k=>mask.getX(g.index!.getX(i+k)));expect(new Set(values).size).toBe(1);}
 }
 console.log(JSON.stringify(binding.coverage));binding.dispose();binding.dispose();for(const [mesh,g] of originals)expect(mesh.geometry).toBe(g);
 });
 it('fails closed for unknown asset and material',async()=>{const root=await load('base-teal');expect(prepareQuietStone(root,'unknown').meshes).toHaveLength(0);root.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material))o.material.name='not-approved';});expect(prepareQuietStone(root,'base-teal').meshes).toHaveLength(0);});
 it('uses asset-relative meters and leaves root translation out',()=>{
 const root=new THREE.Group();root.position.set(100,200,300);const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.name='building_castle_green';mesh.material.name='hexagons_medieval';
 mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,4,0,0,0,0,4],3));mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute([.3,.1,.3,.1,.3,.1],2));root.add(mesh);
 const result=prepareQuietStone(root,'base-teal');expect(Array.from(mesh.geometry.getAttribute('quietStonePosition').array)).toEqual([0,0,0,4,0,0,0,0,4]);expect(Array.from(mesh.geometry.getAttribute('quietStoneUv').array)).toEqual([0,0,1,0,0,1]);result.dispose();
 });
 it('does not leak through shared vertices bordering protected atlas cells',()=>{
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.name='building_castle_green';mesh.material.name='hexagons_medieval';root.add(mesh);
 mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,4,0,0,0,0,4,4,0,4],3));mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute([.3,.1,.3,.1,.3,.1,.7,.1],2));mesh.geometry.setIndex([0,1,2,1,3,2]);
 const original=mesh.geometry,result=prepareQuietStone(root,'base-teal');expect(result.coverage[0]!.stoneTriangles).toBe(0);expect(Array.from(mesh.geometry.getAttribute('quietStoneMask').array)).toEqual([0,0,0,0]);result.dispose();expect(mesh.geometry).toBe(original);
 });
 it('keeps independent clones isolated and releases only its own geometry',async()=>{
 const original=await load('base-teal'),a=original.clone(true),b=original.clone(true);
 const pa=prepareQuietStone(a,'base-teal'),pb=prepareQuietStone(b,'base-teal');expect(pa.meshes[0]!.geometry).not.toBe(pb.meshes[0]!.geometry);
 let disposed=0;pa.meshes[0]!.geometry.addEventListener('dispose',()=>disposed++);pa.dispose();pa.dispose();expect(disposed).toBe(1);expect(pb.meshes[0]!.geometry.getAttribute('quietStoneMask')).toBeDefined();pb.dispose();
 });

});
