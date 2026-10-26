import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createEffects} from '../../src/render/effects.js';
import {makeSim,hero,place,perform,stepMany} from '../helpers.js';

const projectileCast={type:'cast' as const,slot:'Q' as const,targetId:null,direction:{x:1,z:0},point:null};

for (const version of [2,8] as const) describe(`snapshot effect consumers v${version} (CPU only)`,()=>{
  it('uses real projectile positions and immutable interpolation endpoints, then removes without a hit effect',async()=>{
    const sim=await makeSim(version,61);const blue=hero(sim,0);place(blue,{x:-8,z:0});place(hero(sim,1),{x:8,z:5});
    expect(perform(sim,{...projectileCast,heroId:blue.id}).accepted).toBe(true);
    while(sim.snapshot().projectiles.length===0&&sim.state.tick<20)sim.step([]);
    const first=sim.snapshot();expect(first.projectiles).toHaveLength(1);const serialized=JSON.stringify(first);
    const scene=new THREE.Scene(),effects=createEffects(scene);effects.sync(first);
    const projectile=first.projectiles[0]!;const mesh=effects.root.getObjectByName(`projectile-${projectile.id}`)!;
    expect(mesh.scale.x).toBe(projectile.width);expect(mesh.rotation.y).toBeCloseTo(Math.atan2(projectile.direction.x,projectile.direction.z));
    const body=mesh.children[0] as THREE.Mesh;let geometryDisposals=0,materialDisposals=0;
    body.geometry.addEventListener('dispose',()=>geometryDisposals++);(body.material as THREE.Material).addEventListener('dispose',()=>materialDisposals++);
    expect(mesh.position.x).toBe(projectile.position.x);effects.draw(0);expect(mesh.position.x).toBe(projectile.position.x);
    sim.step([]);const second=sim.snapshot();effects.sync(second);effects.draw(.5);
    const expected=(projectile.position.x+second.projectiles[0]!.position.x)/2;
    expect(mesh.position.x).toBeCloseTo(expected);effects.draw(.5);expect(mesh.position.x).toBeCloseTo(expected);
    expect(JSON.stringify(first)).toBe(serialized);
    stepMany(sim,40);effects.sync(sim.snapshot());expect(effects.root.children).toHaveLength(0);
    expect(geometryDisposals).toBe(0);expect(materialDisposals).toBe(0);
    effects.dispose();effects.dispose();expect(geometryDisposals).toBe(1);expect(materialDisposals).toBe(1);expect(scene.children).toHaveLength(0);
  });
  it('shows an active zone at its real center and radius, and drops it when absent',async()=>{
    const sim=await makeSim(version,62);const blue=hero(sim,0);place(blue,{x:-4,z:0});place(hero(sim,1),{x:4,z:5});
    expect(perform(sim,{type:'cast',heroId:blue.id,slot:'E',targetId:null,direction:null,point:{x:4,z:0}}).accepted).toBe(true);
    stepMany(sim,30);const snapshot=sim.snapshot();expect(snapshot.zones).toHaveLength(1);
    const effects=createEffects(new THREE.Scene());effects.sync(snapshot);const zone=snapshot.zones[0]!;
    const shape=effects.root.getObjectByName(`zone-${zone.id}`)!;
    expect(shape.position.x).toBe(zone.position.x);expect(shape.position.z).toBe(zone.position.z);expect(shape.scale.x).toBe(zone.radius);
    expect(shape.children).toHaveLength(2);
    const inspected=effects.inspect().find(item=>item.name===shape.name)!;expect(inspected.meshes).toBe(2);expect(inspected.visible).toBe(true);
    inspected.position.x=999;expect(shape.position.x).toBe(zone.position.x);
    const scene=effects.root.parent!;effects.root.removeFromParent();expect(effects.inspect()[0]!.visible).toBe(false);scene.add(effects.root);expect(shape.userData['expiresTick']).toBe(zone.expiresTick);
    stepMany(sim,120);effects.sync(sim.snapshot());expect(effects.root.children).toHaveLength(0);effects.dispose();
  });
  it('shows real delayed areas as unfilled dashed warnings and removes them at trigger without inferring hits',async()=>{
    const sim=await makeSim(version,64);const blue=hero(sim,0);place(blue,{x:-4,z:0});place(hero(sim,1),{x:4,z:5});
    expect(perform(sim,{type:'cast',heroId:blue.id,slot:'R',targetId:null,direction:null,point:{x:4,z:0}}).accepted).toBe(true);
    while(sim.snapshot().delayedAreas.length===0&&sim.state.tick<20)sim.step([]);
    const snapshot=sim.snapshot();expect(snapshot.delayedAreas).toHaveLength(1);const saved=JSON.stringify(snapshot);
    const effects=createEffects(new THREE.Scene());effects.sync(snapshot);const area=snapshot.delayedAreas[0]!;
    const warning=effects.root.getObjectByName(`warning-${area.id}`) as THREE.Mesh;
    expect(warning.position.x).toBe(area.position.x);expect(warning.scale.x).toBe(area.radius);expect(warning.userData['triggerTick']).toBe(area.triggerTick);
    expect(warning.children).toHaveLength(0); // No active-zone filled disc.
    const positions=warning.geometry.getAttribute('position');expect(positions.count).toBe(32*6);
    for(let i=0;i<positions.count;i++)expect(Math.hypot(positions.getX(i),positions.getY(i))).toBeGreaterThan(.94);
    stepMany(sim,30);effects.sync(sim.snapshot());expect(effects.root.children).toHaveLength(0);expect(JSON.stringify(snapshot)).toBe(saved);effects.dispose();
  });
  it('requires reset for rewind and rejects invalid alpha or use after disposal',async()=>{
    const sim=await makeSim(version,63),effects=createEffects(new THREE.Scene());const initial=sim.snapshot();effects.sync(initial);sim.step([]);effects.sync(sim.snapshot());
    expect(()=>effects.sync(initial)).toThrow('Reset');effects.reset();effects.sync(initial);
    for(const alpha of [-1,1.1,NaN])expect(()=>effects.draw(alpha)).toThrow('alpha');
    effects.dispose();effects.dispose();expect(()=>effects.sync(initial)).toThrow('disposed');
  });
});
