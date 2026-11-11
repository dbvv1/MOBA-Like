import {it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {parseMaterialFamily,loadQuietFamily,roadDistance,bindQuietGround} from '../../src/render/quiet-family.js';
import {createTerrainComposition,roadCrossSection} from '../../src/render/terrain-composition.js';
import {createGroundSurfaces} from '../../src/render/ground-surfaces.js';
const textures=()=>({road:new THREE.Texture(),forest:new THREE.Texture(),wall:new THREE.Texture(),dispose(){}});
it('opts in exactly once; absent, unknown and duplicate modes have zero candidate requests',async()=>{
 for(const q of ['', '?materials=legacy','?materials=quiet-family-v1&materials=quiet-family-v1']){
  expect(parseMaterialFamily(q)).toBe('baseline');const load=vi.fn();expect(await loadQuietFamily(parseMaterialFamily(q),load)).toBeUndefined();expect(load).not.toHaveBeenCalled();
 }
 expect(parseMaterialFamily('?materials=quiet-family-v1')).toBe('quiet-family-v1');
});
it('loads exactly three world-owned textures and releases once; a fresh restart owns a fresh set',async()=>{
 for(let run=0;run<2;run++){const input=[new THREE.Texture(),new THREE.Texture(),new THREE.Texture()];const disposed=input.map(t=>{const fn=vi.fn();t.addEventListener('dispose',fn);return fn;});let n=0;const load=vi.fn(async()=>input[n++]!);const result=await loadQuietFamily('quiet-family-v1',load);expect(load).toHaveBeenCalledTimes(3);expect(result?.wall.colorSpace).toBe(THREE.SRGBColorSpace);expect(result?.road.wrapS).toBe(THREE.RepeatWrapping);result!.dispose();result!.dispose();disposed.forEach(fn=>expect(fn).toHaveBeenCalledTimes(1));}
});
it('failure or cancellation cannot install a partial family; late resolved textures are disposed',async()=>{
 for(const failAt of [0,1,2]){let n=0,disposed=0;const result=await loadQuietFamily('quiet-family-v1',async()=>{if(n++===failAt)throw Error('unavailable');const t=new THREE.Texture();t.addEventListener('dispose',()=>disposed++);return t;});expect(result).toBeUndefined();expect(disposed).toBe(failAt);}
 const abort=new AbortController(),texture=new THREE.Texture(),dispose=vi.fn();texture.addEventListener('dispose',dispose);let resolve!:(v:THREE.Texture)=>void;const load=vi.fn(()=>new Promise<THREE.Texture>(r=>resolve=r));const pending=loadQuietFamily('quiet-family-v1',load,abort.signal);abort.abort();resolve(texture);expect(await pending).toBeUndefined();expect(dispose).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledTimes(1);
});
it('measures distance from the actual one-metre sampled road and clearing boundaries',()=>{
 for(let x=-109.75;x<110;x+=.5){const a=roadCrossSection(Math.floor(x)),b=roadCrossSection(Math.floor(x)+1),t=x-Math.floor(x);for(const side of ['south','north'] as const)expect(roadDistance(x,a[side]*(1-t)+b[side]*t)).toBeCloseTo(0,10);}
 expect(roadDistance(-101,0)).toBe(8.5);expect(roadDistance(111,0)).toBeLessThan(0);
});
it('preserves all ground positions, indices, UVs and colors while covering road, forest and shoulders',()=>{
 const tex=textures();for(const make of [(q:boolean)=>createTerrainComposition(tex,'baseline',q?tex:undefined),(q:boolean)=>createGroundSurfaces('baseline',tex.forest,q?tex:undefined)]){
  const base=make(false);const quiet=make(true);for(let i=0;i<base.root.children.length;i++){const a=base.root.children[i] as THREE.Mesh,b=quiet.root.children[i] as THREE.Mesh;if(!a.isMesh)continue;expect(Array.from(b.geometry.index?.array??[])).toEqual(Array.from(a.geometry.index?.array??[]));for(const name of Object.keys(a.geometry.attributes))expect(Array.from(b.geometry.getAttribute(name).array)).toEqual(Array.from(a.geometry.getAttribute(name).array));}base.dispose();quiet.dispose();
 }
 for(const material of [new THREE.MeshStandardMaterial(),new THREE.MeshToonMaterial()]){bindQuietGround(material,tex);const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <map_fragment>'};material.onBeforeCompile(shader as never,{} as never);expect(shader.fragmentShader).toContain('vQuietWorld/10.0');expect(shader.fragmentShader).toContain('vQuietWorld/12.0');expect(shader.fragmentShader).toContain('smoothstep(-0.4,0.4');expect(shader.vertexShader).toContain('modelMatrix');}
});
it('reports the actually owned family only after a submitted live frame, never URL intent',async()=>{
 const {inspectMaterialFamily}=await import('../../src/render/quiet-family.js');
 expect(inspectMaterialFamily('baseline',undefined,true,false)).toEqual({requested:'baseline',configured:'baseline',active:'baseline'});
 const owned=await loadQuietFamily('quiet-family-v1',async()=>new THREE.Texture());
 expect(inspectMaterialFamily('quiet-family-v1',owned,true,false).active).toBe('quiet-family-v1');
 for(const state of [inspectMaterialFamily('quiet-family-v1',undefined,true,false),inspectMaterialFamily('quiet-family-v1',owned,false,false),inspectMaterialFamily('quiet-family-v1',owned,true,true)])expect(state.active).toBeNull();
 const missing=await loadQuietFamily('quiet-family-v1',async()=>{throw Error('unavailable');});
 expect(inspectMaterialFamily('quiet-family-v1',missing,true,false).active).toBeNull();
 expect(inspectMaterialFamily('baseline',undefined,false,false).active).toBeNull();
 expect(inspectMaterialFamily('baseline',undefined,true,true).active).toBeNull();owned!.dispose();
});
