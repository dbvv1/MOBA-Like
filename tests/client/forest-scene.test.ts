import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {parseForestScene,forestVergeLayout,applyForestGround,applyForestAtmosphere} from '../../src/render/forest-scene.js';
import {createTerrainComposition} from '../../src/render/terrain-composition.js';

describe('forest verge scene candidate',()=>{
  it('is opt in and malformed/duplicate values do not change default',()=>{
    expect(parseForestScene('?scene=forest-verge-v1')).toBe('forest-verge-v1');
    for(const q of ['', '?scene=other','?scene=forest-verge-v1&scene=forest-verge-v1'])expect(parseForestScene(q)).toBe('baseline');
  });
  it('has deterministic clusters with lane and base clearance and fewer instances than the original fence',()=>{
    const a=forestVergeLayout(-110,110);expect(a).toEqual(forestVergeLayout(-110,110));expect(a.length).toBeLessThan(180);
    for(const p of a){expect(Math.abs(p.z)).toBeGreaterThan(10);expect(p.scale).toBeGreaterThan(0);expect(Object.values(p).slice(1).every(Number.isFinite)).toBe(true);}
  });
  it('leaves default buffers unchanged and colors only the selected scene',()=>{
    const textures={road:new THREE.Texture(),forest:new THREE.Texture()};
    const a=createTerrainComposition(textures),b=createTerrainComposition(textures,'baseline',undefined,'forest-verge-v1');
    a.root.children.forEach((object,i)=>{
      const old=object as THREE.Mesh,newer=b.root.children[i] as THREE.Mesh;
      expect(old.geometry.getAttribute('color')).toBeUndefined();
      expect([...newer.geometry.getAttribute('position').array]).toEqual([...old.geometry.getAttribute('position').array]);
      expect((newer.material as THREE.Material).customProgramCacheKey()).toContain('|forest-verge-v1');
    });a.dispose();b.dispose();textures.road.dispose();textures.forest.dispose();
  });
  it('composes after texture hooks with a shared fragment-space mask',()=>{
    const geo=new THREE.BufferGeometry(),mat=new THREE.MeshStandardMaterial();
    mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','// existing texture hook');};
    applyForestGround(geo,mat);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    mat.onBeforeCompile(shader as any,{} as any);
    expect(shader.fragmentShader).toContain('// existing texture hook');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb*=forestValue');
    expect(shader.vertexShader).toContain('vForestWorld=(modelMatrix');
    geo.dispose();mat.dispose();
  });
  it('does not recolor authored cues or directional lights',()=>{
    const scene=new THREE.Scene(),light=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight('#ffccaa'),cue=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:'#ff0000'}));
    scene.add(light,sun,cue);const color=sun.color.clone();applyForestAtmosphere(scene);
    expect(sun.color.equals(color)).toBe(true);expect(cue.material.color.getHex()).toBe(0xff0000);expect(scene.fog).toBeInstanceOf(THREE.Fog);cue.geometry.dispose();cue.material.dispose();
  });
});
