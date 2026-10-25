import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3, Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { getContent } from '../../src/content/catalog.ts';
import { Simulation } from '../../src/sim/simulation.ts';
import { createPresentation, loadCharacterAssets, disposeCharacterAssets } from './adapter.js';
import { abilityViewModel, iconUrl } from './icons.js';

const assets = await loadCharacterAssets(async url => {
  const bytes = await readFile(new URL(url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
});
const navigation = {closestPoint:p=>({...p}), findPath:(start,end)=>({success:true,points:[{...start},{...end}],reason:null})};
function simulation(version=1) { return new Simulation({seed:7,contentVersion:version,navigation,heroesPerTeam:2}); }
function deepFreeze(object) { Object.freeze(object); for (const value of Object.values(object)) if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value); return object; }
function bones(root) { const values=[]; root.traverse(node=>{if(node.isBone) values.push(node);}); return values; }
function meshes(root) { const values=[]; root.traverse(node=>{if(node.isSkinnedMesh) values.push(node);}); return values; }

test('real Simulation snapshots drive isolated GLB instances without mutating snapshot/source', () => {
  const sim=simulation(); const catalog=getContent(1); const view=createPresentation({catalog,assets});
  const first=deepFreeze(sim.snapshot()); const before=JSON.stringify(first);
  view.sync(first); assert.equal(view.inspect().heroes.length,4);
  const blue=first.heroes.filter(h=>h.team===0);
  const a=view.root.getObjectByName(`hero-${blue[0].id}`); const b=view.root.getObjectByName(`hero-${blue[1].id}`);
  assert.notEqual(bones(a)[0],bones(b)[0]); assert.notEqual(meshes(a)[0].skeleton,meshes(b)[0].skeleton);
  assert.notEqual(meshes(a)[0].material,meshes(b)[0].material);
  const sourceBones=bones(assets.blue.scene).map(b=>b.matrixWorld.toArray());
  sim.step([{type:'move',heroId:blue[0].id,point:{x:blue[0].position.x+4,z:blue[0].position.z}}]);
  const next=deepFreeze(sim.snapshot()); view.sync(next);
  assert.equal(view.inspect().heroes.find(h=>h.id===blue[0].id).action,'walk');
  assert.equal(view.inspect().heroes.find(h=>h.id===blue[1].id).action,'idle');
  const untouched=bones(b).map(b=>b.matrix.toArray());
  view.advance(0.3);
  assert.deepEqual(bones(assets.blue.scene).map(b=>b.matrixWorld.toArray()),sourceBones);
  assert.equal(JSON.stringify(first),before);
  // Changing one clone cannot alter its sibling's local skeleton.
  const sibling=bones(b)[0].position.clone(); bones(a)[0].position.x+=3;
  assert.ok(bones(b)[0].position.equals(sibling));
  assert.ok(untouched.length===15);
  assert.equal(a.position.x,next.heroes.find(h=>h.id===blue[0].id).position.x);
  assert.equal(a.position.z,next.heroes.find(h=>h.id===blue[0].id).position.z);
  assert.ok(Math.abs(a.rotation.y-Math.PI/2)<1e-6);
  let sourceDisposals=0; meshes(assets.blue.scene)[0].geometry.addEventListener('dispose',()=>sourceDisposals++);
  view.dispose(); assert.equal(view.root.children.length,0); assert.equal(sourceDisposals,0);
});

test('whole actor translation moves every posed skin point; clones retain faction geometry', () => {
  const sim=simulation(); const view=createPresentation({catalog:getContent(1),assets}); view.sync(sim.snapshot()); view.advance(.4);
  const hero=sim.snapshot().heroes[0]; const actor=view.root.getObjectByName(`hero-${hero.id}`);
  const points=()=>meshes(actor).flatMap(mesh=>Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld)));
  const before=points(); actor.position.add(new Vector3(3,2,-4)); view.root.updateMatrixWorld(true);
  points().forEach((p,i)=>assert.ok(p.distanceTo(before[i].clone().add(new Vector3(3,2,-4)))<1e-5));
  const amber=sim.snapshot().heroes.find(h=>h.team===1); const redRoot=view.root.getObjectByName(`hero-${amber.id}`);
  assert.notEqual(meshes(actor).length,meshes(redRoot).length,'single/double faction fins are preserved'); view.dispose();
});

test('death, removal, reset and repeated ticks do not fabricate attacks or leak actors', () => {
  const sim=simulation(); const view=createPresentation({catalog:getContent(1),assets}); const snap=sim.snapshot(); view.sync(snap);
  const id=snap.heroes[0].id;
  const changed=structuredClone(snap); changed.tick++; changed.heroes[0].alive=false; changed.heroes[0].castSlot='R'; view.sync(changed);
  assert.deepEqual(view.inspect().heroes.find(h=>h.id===id),{id,action:'idle',team:0,visible:false});
  view.sync(changed); assert.equal(view.inspect().heroes.length,4);
  const reduced=structuredClone(changed); reduced.tick++; reduced.heroes=[]; reduced.entities=[]; view.sync(reduced);
  assert.equal(view.inspect().heroes.length,0); assert.equal(view.inspect().entities,0);
  assert.throws(()=>view.sync(snap),/reset/); view.reset(); view.sync(snap); assert.equal(view.inspect().heroes.length,4);
  assert.throws(()=>view.advance(-1),/delta/); assert.throws(()=>view.sync({...snap,contentVersion:2}),/version/);
  view.dispose(); view.dispose(); assert.throws(()=>view.sync(snap),/disposed/);
});

test('map bounds and entity placement come from the actual content/snapshot', () => {
  const sim=simulation(); const catalog=getContent(1); const view=createPresentation({catalog,assets});
  for (let tick=0; tick<245; tick++) sim.step([]);
  const snapshot=sim.snapshot(); assert.ok(snapshot.entities.some(e=>e.kind==='minion')); view.sync(snapshot);
  assert.equal(view.root.getObjectByName('map-bounds').geometry.parameters.width,catalog.map.world.maxX-catalog.map.world.minX);
  for(const entity of snapshot.entities.filter(e=>e.kind!=='hero')) {const proxy=view.root.getObjectByName(`entity-${entity.id}`); assert.equal(proxy.position.x,entity.position.x); assert.equal(proxy.scale.x,entity.radius);}
  view.dispose();
});

test('icons use catalog delivery, actual cooldown/cast/death states, never fixed slot guesses', async () => {
  const sim=simulation(); const hero=sim.snapshot().heroes[0]; const icons=abilityViewModel(hero,getContent(1));
  assert.deepEqual(icons.map(i=>i.semantic),['targeted','displacement','persistent-effect','control']);
  for(const icon of icons) assert.match(await readFile(new URL(icon.icon),'utf8'),/<svg/);
  const v2=abilityViewModel(hero,getContent(2)); assert.equal(v2[0].icon,null); assert.equal(v2[0].semantic,null);
  sim.step([{type:'cast',heroId:hero.id,slot:'W',targetId:null,point:null,direction:{x:1,z:0}}]);
  const castHero=sim.snapshot().heroes.find(h=>h.id===hero.id);
  const castIcon=abilityViewModel(castHero,getContent(1)).find(i=>i.slot==='W');
  assert.ok(castIcon.cooldownTicks>0); assert.equal(castIcon.cooldownSeconds,castHero.cooldowns.W/getContent(1).rules.tickRate);
  const blocked=abilityViewModel({...hero,alive:false,stunned:true,mana:0,castSlot:'R',cooldowns:{...hero.cooldowns,Q:60}},getContent(1));
  assert.deepEqual(blocked[0].reasons,['dead','stunned','casting','cooldown','mana']); assert.equal(blocked[0].cooldownTicks,60); assert.equal(blocked[0].cooldownSeconds,60/getContent(1).rules.tickRate); assert.ok(blocked[3].casting);
  assert.throws(()=>iconUrl('projectile'),/semantic/); assert.throws(()=>iconUrl('targeted','untrusted'),/theme/);
});

test('asset loader rejects a missing required clip',async()=>{
  await assert.rejects(loadCharacterAssets(async()=>({animations:[]})),/Missing clip/);
});

test('failed source load cleans partial geometry/material/texture, successful source ownership stays explicit', async () => {
  const geometry=new BoxGeometry(), texture=new Texture(), material=new MeshStandardMaterial({map:texture});
  const scene=new Group(); scene.add(new Mesh(geometry,material));
  const events={geometry:0,material:0,texture:0};
  for(const [key,resource] of Object.entries({geometry,material,texture})) resource.addEventListener('dispose',()=>events[key]++);
  await assert.rejects(loadCharacterAssets(url=>{if(url.includes('amber')) throw new Error('load failed'); return {scene,animations:[{name:'idle'},{name:'walk'}]};}),/load failed/);
  assert.deepEqual(events,{geometry:1,material:1,texture:1});
  const other=new Group(); const shared=new BoxGeometry(); other.add(new Mesh(shared,new MeshStandardMaterial()));
  let disposed=0; shared.addEventListener('dispose',()=>disposed++);
  disposeCharacterAssets({blue:{scene:other},amber:{scene:other}}); assert.equal(disposed,1);
});
