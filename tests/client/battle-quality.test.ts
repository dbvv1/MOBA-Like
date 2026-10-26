import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {battleCue,createBattleAudio} from '../../src/audio/battle.js';
import {battleMessage} from '../../src/ui/battle-state.js';
import {createBattlefield,battleAssetId} from '../../src/render/battlefield.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createImpacts} from '../../src/render/impact.js';
import {makeSim,hero} from '../helpers.js';
import {getContent} from '../../src/content/catalog.js';
import type {PresentationEvent} from '../../src/sim/types.js';

describe('basic battle read-only consumers',()=>{
  it('loads every real bundled GLB and uses real living entities with interpolated ground roots',async()=>{
    const {PNG}=createRequire(import.meta.url)('pngjs') as {PNG:{sync:{read(bytes:Buffer):{data:Uint8Array;width:number;height:number}}}};
    const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_embedded_PNG',async loadTexture(index:number){
      const texture=parser.json.textures[index],image=parser.json.images[texture.source];
      if(image.mimeType!=='image/png')throw new Error('CPU test only decodes embedded PNG');
      const bytes=await parser.getDependency('bufferView',image.bufferView);const png=PNG.sync.read(Buffer.from(bytes));
      const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;
    }}));
    const assets=await loadBattleAssets(async url=>{const path=url.split('?')[0]!;const bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
    const sim=await makeSim(8,61);while(!sim.snapshot().entities.some(entity=>entity.kind==='minion')&&sim.state.tick<1800)sim.step([]);const field=createBattlefield(getContent(8),assets),snapshot=sim.snapshot(),before=JSON.stringify(snapshot);
    expect(snapshot.entities.some(entity=>entity.kind==='minion')).toBe(true);
    field.sync(snapshot);field.advance(.03,.5);
    for(const entity of snapshot.entities.filter(e=>e.kind!=='hero'&&e.alive)){
      const root=field.root.getObjectByName(`entity-${entity.id}`)!;expect(root).toBeDefined();expect(root.position.y).toBe(0);expect(root.userData['simEntityId']).toBe(entity.id);expect(assets.models[battleAssetId(entity)]).toBeDefined();
    }
    expect(JSON.stringify(snapshot)).toBe(before);
    const tower=snapshot.entities.find(entity=>entity.kind==='structure'&&entity.structureKind==='tower')!;
    const towerRoot=field.root.getObjectByName(`entity-${tower.id}`)!;const heading=towerRoot.rotation.y;
    field.sync({...snapshot,tick:snapshot.tick+1,events:[{type:'basicAttack',tick:snapshot.tick+1,ordinal:0,sourceId:tower.id,targetId:snapshot.heroes[0]!.id}]});
    expect(towerRoot.rotation.y).toBe(heading);
    const troop=snapshot.entities.find(entity=>entity.kind==='minion')!;
    field.sync({...snapshot,tick:snapshot.tick+2,timeSeconds:snapshot.timeSeconds+1/30,events:[{type:'basicAttack',tick:snapshot.tick+2,ordinal:0,sourceId:troop.id,targetId:snapshot.heroes[1]!.id}]});
    const troopRoot=field.root.getObjectByName(`entity-${troop.id}`)!,strikeHeading=troopRoot.rotation.y;
    field.sync({...snapshot,tick:snapshot.tick+3,timeSeconds:snapshot.timeSeconds+2/30,events:[],entities:snapshot.entities.map(entity=>entity.id===troop.id?{...entity,position:{x:entity.position.x,z:entity.position.z+.05}}:entity)});
    expect(troopRoot.rotation.y).toBe(strikeHeading); // contact displacement must not turn the committed swing sideways
    const changed={...snapshot,tick:snapshot.tick+4,entities:snapshot.entities.map(entity=>entity.id===troop.id?{...entity,alive:false}:entity)};field.sync(changed);expect(field.root.getObjectByName(`entity-${troop.id}`)).toBeUndefined();
    field.dispose();
    const moving=createBattlefield(getContent(8),assets);moving.sync(sim.snapshot());sim.step([]);
    const moved=sim.snapshot().entities.find(entity=>entity.id===troop.id)!;expect(moved.position.x).not.toBe(troop.position.x);
    sim.state.status='timeout';moving.sync(sim.snapshot());
    for(const alpha of [.9,.1,.5,0,.99]){moving.advance(.016,alpha);expect(moving.root.getObjectByName(`entity-${troop.id}`)!.position.x).toBe(moved.position.x);}
    moving.dispose();assets.dispose();assets.dispose();
  });
  it('routes confirmed hit versus shield, never cast start/cancel as impact audio',async()=>{
    const sim=await makeSim(8,61),blue=hero(sim,0),snap=sim.snapshot();
    const base={tick:1,ordinal:0,targetId:blue.id,sourceId:blue.id,abilityId:null};
    expect(battleCue({...base,type:'heroDamaged',hpDamage:10,shieldAbsorbed:0},snap,blue.id)?.kind).toBe('hit');
    expect(battleCue({...base,type:'heroDamaged',hpDamage:0,shieldAbsorbed:10},snap,blue.id)?.kind).toBe('shield');
    const tower=snap.entities.find(entity=>entity.kind==='structure')!;expect(battleCue({type:'basicAttack',tick:1,ordinal:2,sourceId:tower.id,targetId:blue.id},snap,blue.id)).toBeNull();
    const muted=createBattleAudio(false);expect(muted.enabled).toBe(false);muted.dispose();
    expect(battleCue({type:'castStarted',tick:1,ordinal:1,heroId:blue.id,castId:1,abilityId:'test',slot:'Q'},snap,blue.id)).toBeNull();
  });
  it('deduplicates each actual impact and expires all transient geometry',async()=>{
    const sim=await makeSim(8,61),blue=hero(sim,0),scene=new THREE.Scene(),effects=createImpacts(scene);
    const event:PresentationEvent={type:'heroDamaged',tick:1,ordinal:0,targetId:blue.id,sourceId:blue.id,abilityId:null,hpDamage:10,shieldAbsorbed:0};
    const snap={...sim.snapshot(),events:[event]};effects.sync(snap);effects.sync(snap);expect(scene.children[0]!.children).toHaveLength(1);
    for(let i=0;i<5;i++)effects.draw(.1);expect(scene.children[0]!.children).toHaveLength(0);effects.dispose();expect(scene.children).toHaveLength(0);
  });
  it('describes enemy tower RANGE, not an invented aggro lock, and dead heroes get respawn context',async()=>{
    const sim=await makeSim(8,61),catalog=getContent(8),blue=hero(sim,0);const tower=sim.state.entities.find(e=>e.kind==='structure'&&e.structureKind==='tower'&&e.team===1)!;
    blue.position={...tower.position};let snap=sim.snapshot();expect(battleMessage(snap,snap.heroes[0]!,catalog).label).toBe('ENEMY TOWER RANGE');
    blue.alive=false;snap=sim.snapshot();expect(battleMessage(snap,snap.heroes[0]!,catalog).label).toBe('RETURNING TO THE FIELD');
  });
});
