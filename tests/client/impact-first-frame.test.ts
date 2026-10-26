import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createImpacts} from '../../src/render/impact.js';
import {makeSim,hero,place} from '../helpers.js';
describe('actual impact first presentation frame',()=>{
 for(const delta of [.016,.1,.25])it(`a newly committed attack is rendered before ageing at delta ${delta}`,async()=>{
  const sim=await makeSim(10,61),snapshot=sim.snapshot(),scene=new THREE.Scene(),fx=createImpacts(scene);
  const input={...snapshot,events:[{type:'basicAttack' as const,tick:snapshot.tick,ordinal:0,sourceId:snapshot.heroes[0]!.id,targetId:snapshot.heroes[1]!.id}]};
  fx.sync(input);fx.sync(input);const root=scene.getObjectByName('battle-feedback')!;expect(root.children).toHaveLength(1);fx.draw(delta);expect(root.children).toHaveLength(1);expect((root.children[0] as THREE.Line).material).toBeDefined();
  fx.draw(.1);fx.draw(.1);expect(root.children).toHaveLength(0);fx.dispose();expect(scene.children).toHaveLength(0);
 });
 it('draws a stationary directed release between actual endpoints without inventing a hit or travelling projectile',async()=>{
  const sim=await makeSim(10,61),snapshot=sim.snapshot(),scene=new THREE.Scene(),fx=createImpacts(scene),source=snapshot.heroes[0]!,target=snapshot.heroes[1]!;
  const input={...snapshot,events:[{type:'basicAttack' as const,tick:snapshot.tick,ordinal:0,sourceId:source.id,targetId:target.id}]};fx.sync(input);fx.draw(.25);
  const root=scene.getObjectByName('battle-feedback')!,streak=root.children[0] as THREE.Mesh;expect(root.children).toHaveLength(1);expect(streak.name).toBe('hero-release-streak');expect(streak.isMesh).toBe(true);expect(streak.geometry.attributes.position!.count).toBe(18);
  streak.updateMatrixWorld(true);const end=streak.localToWorld(new THREE.Vector3(0,0,1));expect(end.distanceTo(new THREE.Vector3(target.position.x,1.2,target.position.z))).toBeLessThan(1e-6);
  const scale=streak.scale.clone(),position=streak.position.clone();fx.draw(.04);expect(streak.scale.equals(scale)).toBe(true);expect(streak.position.equals(position)).toBe(true);expect(root.children).toHaveLength(1);fx.dispose();expect(scene.children).toHaveLength(0);
 });
 for(const version of [9,10] as const)it(`v${version} preserves actual committed releases through lethal minion cleanup`,async()=>{
  const sim=await makeSim(version,61);while(!sim.state.entities.some(e=>e.kind==='minion'))sim.step([]);
  const blue=sim.state.entities.find(e=>e.kind==='minion'&&e.team===0)!,red=sim.state.entities.find(e=>e.kind==='minion'&&e.team===1)!;let commands:Parameters<typeof sim.step>[0]=[];
  if(version===10){const h=hero(sim,0);place(h,{x:-1,z:0});h.attackCooldown=0;place(red,{x:0,z:0});red.hp=1;commands=[{type:'attack',heroId:h.id,targetId:red.id}];}
  else{place(blue,{x:0,z:0});place(red,{x:.5,z:0});blue.hp=red.hp=1;blue.attackCooldown=red.attackCooldown=0;}
  sim.step(commands);const snapshot=sim.snapshot(),scene=new THREE.Scene(),fx=createImpacts(scene),hash=sim.finalHash();expect(snapshot.events.filter(e=>e.type==='basicAttack')).toHaveLength(version===9?2:1);expect(snapshot.entities.some(e=>e.id===red.id)).toBe(false);
  fx.sync(snapshot);fx.draw(.1);const root=scene.getObjectByName('battle-feedback')!;expect(root.children).toHaveLength(version===9?2:1);expect(snapshot.events.some(e=>e.type==='heroDamaged')).toBe(false);expect(sim.finalHash()).toBe(hash);
  // Without a same-step authoritative endpoint, absence alone must not fabricate it.
  fx.dispose();const missing=createImpacts(scene);missing.sync({...snapshot,events:snapshot.events.filter(e=>e.type!=='minionDied')});expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(0);missing.dispose();
 });
 it('keeps the existing 48-cue bound and same-batch deduplication',async()=>{
  const sim=await makeSim(10,61),snapshot=sim.snapshot(),scene=new THREE.Scene(),fx=createImpacts(scene);
  const events=Array.from({length:60},(_,ordinal)=>({type:'basicAttack' as const,tick:snapshot.tick,ordinal,sourceId:snapshot.heroes[0]!.id,targetId:snapshot.heroes[1]!.id}));
  fx.sync({...snapshot,events});fx.sync({...snapshot,events});const root=scene.getObjectByName('battle-feedback')!;expect(root.children).toHaveLength(48);fx.draw(.25);expect(root.children).toHaveLength(48);fx.draw(.1);fx.draw(.1);expect(root.children).toHaveLength(0);fx.dispose();expect(scene.children).toHaveLength(0);
 });
});
