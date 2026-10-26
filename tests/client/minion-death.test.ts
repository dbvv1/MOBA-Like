import {describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createBattlefield} from '../../src/render/battlefield.js';
import {createHealthBars} from '../../src/render/health.js';
import {pickLivingEntity} from '../../src/render/picking.js';
import {FixedClock} from '../../src/render/clock.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim,hero,place} from '../helpers.js';
import type {ContentVersion} from '../../src/content/types.js';

async function arena(version:ContentVersion=10){
 const sim=await makeSim(version,61);while(!sim.state.entities.some(e=>e.kind==='minion'))sim.step([]);
 const victim=sim.state.entities.find(e=>e.kind==='minion'&&e.team===1)!;victim.hp=1;place(victim,{x:0,z:0});
 const blue=hero(sim,0);place(blue,{x:-1,z:0});blue.attackCooldown=0;return{sim,blue,victim};
}
async function assets(){
 const {PNG}=createRequire(import.meta.url)('pngjs');const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){const texture=parser.json.textures[index],image=parser.json.images[texture.source];const bytes=await parser.getDependency('bufferView',image.bufferView);const png=PNG.sync.read(Buffer.from(bytes));const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;}}));
 return loadBattleAssets(async url=>{const path=url.split('?')[0]!;const bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
}
describe('authoritative minion death presentation',()=>{
 for(const version of [8,9,10] as const)it(`v${version} emits once at actual removal, independently copied and outside state hash`,async()=>{
  const {sim,blue,victim}=await arena(version);const gold=blue.gold;
  sim.step([{type:'attack',heroId:blue.id,targetId:victim.id}]);const snapshot=sim.snapshot(),event=snapshot.events.find(e=>e.type==='minionDied');expect(event).toMatchObject({entityId:victim.id});expect(sim.getEntityById(victim.id)).toBeNull();expect(blue.gold).toBeGreaterThan(gold);
  const hash=sim.finalHash();if(event?.type==='minionDied')(event.position as {x:number}).x=999;expect(sim.finalHash()).toBe(hash);expect(sim.snapshot().events.find(e=>e.type==='minionDied')).not.toEqual(event);
  sim.step([]);expect(sim.snapshot().events.some(e=>e.type==='minionDied'&&e.entityId===victim.id)).toBe(false);
 });
 it('plays real death once, immediately removes picking/health, pauses with zero draw time and releases the bounded tail',async()=>{
  const loaded=await assets(),{sim,blue,victim}=await arena();const field=createBattlefield(getContent(10),loaded),scene=new THREE.Scene(),bars=createHealthBars(scene);field.sync(sim.snapshot());bars.sync(sim.snapshot(),field.root);
  const body=field.root.getObjectByName(`entity-${victim.id}`)!;expect(scene.getObjectByName(`health-${victim.id}`)).toBeDefined();const skeletons=new Set<THREE.Skeleton>();body.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});const releases=[...skeletons].map(s=>vi.spyOn(s,'dispose'));
  sim.step([{type:'attack',heroId:blue.id,targetId:victim.id}]);const dead=sim.snapshot(),hash=sim.finalHash();field.sync(dead);field.sync(dead);bars.sync(dead,field.root);expect(body.parent).toBe(field.root);expect(body.userData['simEntityId']).toBeUndefined();expect(scene.getObjectByName(`health-${victim.id}`)).toBeUndefined();expect(pickLivingEntity([{object:body} as THREE.Intersection],dead)).toBeNull();
  field.advance(.4,.5);const bone=body.getObjectByName('Root')!;const pose=bone.quaternion.clone();for(let i=0;i<20;i++)field.advance(0,i/20);expect(bone.quaternion.equals(pose)).toBe(true);expect(body.parent).toBe(field.root);
  expect(sim.finalHash()).toBe(hash);sim.step([]);field.sync({...sim.snapshot(),status:'timeout'});expect(body.parent).toBe(field.root);field.advance(.9,.5);expect(body.parent).toBeNull();expect(releases.every(spy=>spy.mock.calls.length===1)).toBe(true);expect(hash).not.toBe(sim.finalHash());
  field.dispose();expect(releases.every(spy=>spy.mock.calls.length===1)).toBe(true);bars.dispose();loaded.dispose();
 });
 it('retains an earlier-tick death across a real multi-step client frame',async()=>{
  const loaded=await assets(),{sim,blue,victim}=await arena(),field=createBattlefield(getContent(10),loaded);field.sync(sim.snapshot());let first=true;
  new FixedClock(1/30).advance(.15,()=>{sim.step(first?[{type:'attack',heroId:blue.id,targetId:victim.id}]:[]);first=false;field.sync(sim.snapshot());});
  expect(sim.snapshot().events.some(e=>e.type==='minionDied'&&e.entityId===victim.id)).toBe(false);expect(field.root.getObjectByName(`entity-${victim.id}`)).toBeDefined();field.advance(.15,.5);expect(field.root.getObjectByName(`entity-${victim.id}`)).toBeDefined();field.dispose();loaded.dispose();
 });
 it('does not create corpses from an initial dead snapshot and dispose/restart leaves no tail',async()=>{
  const loaded=await assets(),{sim,blue,victim}=await arena(),field=createBattlefield(getContent(10),loaded);field.sync(sim.snapshot());sim.step([{type:'attack',heroId:blue.id,targetId:victim.id}]);field.sync(sim.snapshot());expect(field.root.getObjectByName(`entity-${victim.id}`)).toBeDefined();field.dispose();expect(field.root.children).toHaveLength(0);
  const restarted=createBattlefield(getContent(10),loaded);restarted.sync(sim.snapshot());expect(restarted.root.getObjectByName(`entity-${victim.id}`)).toBeUndefined();restarted.dispose();loaded.dispose();
 });
});
