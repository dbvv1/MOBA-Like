import {it,expect} from 'vitest';
import * as THREE from 'three';
import {parseMaterialStyle,wallUvGeometry,applyTowerMaterialSample} from '../../src/render/ai-material-pair.js';
import {createTerrainComposition} from '../../src/render/terrain-composition.js';
it('is opt-in and rejects malformed material requests without swallowing other routes',()=>{
 for(const search of ['', '?lighting=forest-light-v1&commands=buffer-v1','?materials=baseline'])expect(parseMaterialStyle(search)).toBe('baseline');
 expect(parseMaterialStyle('?materials=ai-pair-v1&lighting=forest-light-v1')).toBe('ai-pair-v1');
 for(const search of ['?materials=oops','?materials=','?materials=baseline&materials=ai-pair-v1'])expect(()=>parseMaterialStyle(search)).toThrow();
});
it('clones only UV coordinates; leaves positions/normals/indices/source attributes intact',()=>{
 const source=new THREE.BoxGeometry(2,3,2),originalUV=source.getAttribute('uv').array.slice(),result=wallUvGeometry(source);
 for(const attr of ['position','normal'])expect(result.getAttribute(attr).array).toEqual(source.getAttribute(attr).array);
 expect(result.index!.array).toEqual(source.index!.array);expect(source.getAttribute('uv').array).toEqual(originalUV);
 expect(result).not.toBe(source);expect(Array.from(result.getAttribute('uv').array).every(Number.isFinite)).toBe(true);
 result.dispose();source.dispose();
});
it('touches only existing masonry body and owns only its cloned geometry/material',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),source=new THREE.MeshStandardMaterial({color:'red'}),wall=new THREE.Texture();
 const body=new THREE.Mesh(geometry,source);body.name='building_tower_catapult_green';const flag=new THREE.Mesh(geometry,source);flag.name='team-standard';root.add(body,flag);
 let old=0,newDisposed=0;geometry.addEventListener('dispose',()=>old++);source.addEventListener('dispose',()=>old++);wall.addEventListener('dispose',()=>old++);
 const sample=applyTowerMaterialSample(root,wall);expect(sample.count).toBe(1);expect(flag.geometry).toBe(geometry);expect(flag.material).toBe(source);expect((body.material as THREE.MeshStandardMaterial).map).toBe(wall);
 body.geometry.addEventListener('dispose',()=>newDisposed++);body.material.addEventListener('dispose',()=>newDisposed++);sample.dispose();expect(newDisposed).toBe(2);expect(old).toBe(0);
});
it('uses existing road triangles only and keeps both non-sample terrain and default positions identical',()=>{
 const textures={road:new THREE.Texture(),forest:new THREE.Texture()},sample=new THREE.Texture(),base=createTerrainComposition(textures,'forest-light-v1'),candidate=createTerrainComposition(textures,'forest-light-v1',sample);
 const a=base.root.getObjectByName('ContinuousRoadAndClearings') as THREE.Mesh,b=candidate.root.getObjectByName('ContinuousRoadAndClearings') as THREE.Mesh;
 expect(b.geometry.getAttribute('position').array).toEqual(a.geometry.getAttribute('position').array);expect(b.geometry.getAttribute('normal').array).toEqual(a.geometry.getAttribute('normal').array);expect(b.geometry.getAttribute('uv').array).toEqual(a.geometry.getAttribute('uv').array);
 expect(a.geometry.groups).toHaveLength(0);expect(b.geometry.groups).toHaveLength(3);expect(b.geometry.groups.map(g=>g.materialIndex)).toEqual([0,1,0]);
 const positions=b.geometry.getAttribute('position'),group=b.geometry.groups[1]!;
 for(let i=group.start;i<group.start+group.count;i++)expect(positions.getX(i)).toBeGreaterThanOrEqual(-42);
 expect((candidate.root.getObjectByName('ContinuousForestFloor') as THREE.Mesh).geometry.getAttribute('position').array).toEqual((base.root.getObjectByName('ContinuousForestFloor') as THREE.Mesh).geometry.getAttribute('position').array);
 base.dispose();candidate.dispose();
});
it('does not claim a masonry match for absent or differently named models',()=>{
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.name='team-standard';root.add(mesh);
 const source=mesh.material,sample=applyTowerMaterialSample(root,new THREE.Texture());expect(sample.count).toBe(0);expect(mesh.material).toBe(source);sample.dispose();sample.dispose();
});
