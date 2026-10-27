import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createTerrainComposition,roadCrossSection} from '../../src/render/terrain-composition.js';
describe('continuous authored ground zones',()=>{
  it('makes base and tower clearings without adding height or collision',()=>{
    expect(roadCrossSection(-101).north).toBe(8.5);expect(roadCrossSection(-56).north).toBe(4.8);
    expect(roadCrossSection(0).north).toBeLessThan(4);
    const terrain=createTerrainComposition({road:new THREE.Texture(),forest:new THREE.Texture()});
    for(const object of terrain.root.children){const m=object as THREE.Mesh,p=m.geometry.getAttribute('position'),uv=m.geometry.getAttribute('uv');for(let i=0;i<p.count;i++){expect(p.getY(i)).toBe(0);expect(Number.isFinite(uv.getX(i))).toBe(true);}const hits:THREE.Intersection[]=[];m.raycast(new THREE.Raycaster(),hits);expect(hits).toEqual([]);}
    terrain.dispose();
  });
  it('releases surfaces once but not world-owned textures',()=>{
    const road=new THREE.Texture(),forest=new THREE.Texture();let textures=0,owned=0;road.addEventListener('dispose',()=>textures++);forest.addEventListener('dispose',()=>textures++);
    const terrain=createTerrainComposition({road,forest});for(const object of terrain.root.children){const m=object as THREE.Mesh;m.geometry.addEventListener('dispose',()=>owned++);(m.material as THREE.Material).addEventListener('dispose',()=>owned++);}
    terrain.dispose();terrain.dispose();expect(owned).toBe(4);expect(textures).toBe(0);expect(terrain.root.children).toHaveLength(0);
  });
});
