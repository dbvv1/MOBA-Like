import {afterEach,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createImpacts} from '../../src/render/impact.js';
import {makeSim} from '../helpers.js';
import {loadCombatTextures} from '../../src/render/combat-textures.js';
afterEach(()=>vi.restoreAllMocks());
it('loads one source with a bounded UV window and releases the world-owned texture once',async()=>{
 const source=new THREE.Texture();let disposals=0;source.addEventListener('dispose',()=>disposals++);
 const load=vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockResolvedValue(source);
 const textures=(await loadCombatTextures())!;expect(load).toHaveBeenCalledTimes(1);expect(load.mock.calls[0]![0]).toContain('trace_02.png');expect(textures.release).toBe(source);expect(source.colorSpace).toBe(THREE.SRGBColorSpace);
 expect(source.offset.x).toBeGreaterThanOrEqual(0);expect(source.offset.y).toBeGreaterThanOrEqual(0);expect(source.offset.x+source.repeat.x).toBeLessThanOrEqual(1);expect(source.offset.y+source.repeat.y).toBeLessThanOrEqual(1);
 textures.dispose();textures.dispose();expect(disposals).toBe(1);
});
it('keeps the original geometric release available when the optional source fails',async()=>{
 vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockRejectedValue(new Error('source unavailable'));
 const textures=await loadCombatTextures();expect(textures).toBeUndefined();
 const scene=new THREE.Scene(),effects=createImpacts(scene,textures),sim=await makeSim(10,61),snapshot=sim.snapshot();
 effects.sync({...snapshot,events:[{type:'basicAttack',tick:0,ordinal:0,sourceId:snapshot.heroes[0]!.id,targetId:snapshot.heroes[1]!.id}]});
 const streak=scene.getObjectByName('hero-release-streak') as THREE.Mesh;expect(streak.geometry.getAttribute('position').count).toBe(18);expect((streak.material as THREE.MeshBasicMaterial).map).toBeNull();effects.dispose();
});
