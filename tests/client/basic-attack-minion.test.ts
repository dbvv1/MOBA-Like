import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createBattlefield} from '../../src/render/battlefield.js';
import {createEffects} from '../../src/render/effects.js';
import {createImpacts} from '../../src/render/impact.js';
import {makeSim} from '../helpers.js';
import type {PresentationEvent} from '../../src/sim/types.js';
async function assets(){
  const {PNG}=createRequire(import.meta.url)('pngjs');
  const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){const texture=parser.json.textures[index],image=parser.json.images[texture.source];const bytes=await parser.getDependency('bufferView',image.bufferView);const png=PNG.sync.read(Buffer.from(bytes));const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;}}));
  return loadBattleAssets(async url=>{const path=url.split('?')[0]!;const bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
}
it('v11 troop preparation retains attack heading under contact displacement; buildings never rotate their whole root',async()=>{
  const sim=await makeSim(11);while(!sim.snapshot().entities.some(e=>e.kind==='minion'))sim.step([]);
  const snapshot=sim.snapshot(),minion=snapshot.entities.find(e=>e.kind==='minion'&&e.team===0)!,target=snapshot.entities.find(e=>e.kind==='minion'&&e.team===1)!,tower=snapshot.entities.find(e=>e.structureKind==='tower')!;
  const loaded=await assets(),field=createBattlefield(sim.catalog,loaded);field.sync(snapshot);
  const towerRoot=field.root.getObjectByName(`entity-${tower.id}`)!,initialTowerYaw=towerRoot.rotation.y;
  const tick=snapshot.tick+1,time=tick/sim.tickRateHz;
  const start=(id:number,castId:number):PresentationEvent=>({type:'castStarted',action:'basicAttack',castId,heroId:id,abilityId:'basicAttack',slot:null,targetId:target.id,windupTicks:9,tick,ordinal:castId});
  const positions=snapshot.entities.map(e=>e.id===minion.id?{...e,position:{x:0,z:0}}:e.id===target.id?{...e,position:{x:1,z:0}}:e);
  field.sync({...snapshot,tick,timeSeconds:time,entities:positions,events:[start(minion.id,1),start(tower.id,2)]});field.advance(1/30,1);
  const actor=field.root.getObjectByName(`entity-${minion.id}`)!;expect(actor.rotation.y).toBeCloseTo(Math.PI/2);expect(towerRoot.rotation.y).toBe(initialTowerYaw);
  field.sync({...snapshot,tick:tick+1,timeSeconds:time+1/30,entities:positions.map(e=>e.id===minion.id?{...e,position:{x:0,z:.05}}:e),events:[]});field.advance(1/30,1);
  expect(actor.rotation.y).toBeCloseTo(Math.atan2(1,-.05));expect(towerRoot.rotation.y).toBe(initialTowerYaw);
  field.dispose();loaded.dispose();
});
it('tower source streak and first projectile share one launch height',async()=>{
  const sim=await makeSim(11),tower=sim.state.entities.find(e=>e.kind==='structure'&&e.team===1&&e.structureKind==='tower')!,player=sim.getHero(0)!;
  player.position={x:tower.position.x-5,z:0};player.path=[];player.targetId=null;player.stats.hpRegen=0;
  for(let i=0;i<60&&!sim.snapshot().events.some(e=>e.type==='basicAttack'&&e.sourceId===tower.id);i++)sim.step([]);
  const snapshot=sim.snapshot(),scene=new THREE.Scene(),effects=createEffects(scene),impacts=createImpacts(scene);effects.sync(snapshot);impacts.sync(snapshot);
  const projectile=snapshot.projectiles.find(p=>p.basicAttack?.sourceId===tower.id)!;expect(projectile).toBeDefined();
  const shot=effects.root.getObjectByName(`projectile-${projectile.id}`)!,streak=scene.getObjectByName('unit-release-trail')!;expect(shot.position.y).toBe(streak.position.y);
  const launchHeight=shot.position.y;sim.step([]);effects.sync(sim.snapshot());effects.draw(1);expect(shot.position.y).toBeLessThan(launchHeight);expect(shot.position.y).toBeGreaterThan(1.2);
  effects.dispose();impacts.dispose();
});
