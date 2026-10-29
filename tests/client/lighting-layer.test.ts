import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {aoKernel} from '../../src/render/lighting-post.js';
import {parseLightingStyle,diffuseMaterial,surfaceMaterial,lightingState} from '../../src/render/lighting-style.js';
describe('lighting-only candidate isolation',()=>{
  it('requires explicit opt-in and does not convert PBR or cue materials',()=>{
    expect(parseLightingStyle('')).toBe('baseline');expect(parseLightingStyle('?lighting=forest-light-v1')).toBe('forest-light-v1');
    const source=new THREE.MeshStandardMaterial({metalness:.2,roughness:.7});
    expect(diffuseMaterial(source,'world','forest-light-v1')).toBe(source);
    expect(diffuseMaterial(source,'cue','forest-light-v1')).toBe(source);
    expect(surfaceMaterial('forest-light-v1',{})).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(lightingState('forest-light-v1').active).toBeNull();
    expect(lightingState('forest-light-v1',true).active).toBe('forest-light-v1');
  });
  it('keeps AO samples deterministic without mutating the global random stream',()=>{
    const a=aoKernel(),b=aoKernel();expect(a).toEqual(b);expect(a[0]).not.toBe(b[0]);
    for(const v of a){expect(v.z).toBeGreaterThan(0);expect(v.length()).toBeLessThanOrEqual(1.000001);}
  });
});
