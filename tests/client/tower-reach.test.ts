import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {towerReach,createTowerReach} from '../../src/render/tower-reach.js';
import {makeSim,hero} from '../helpers.js';
import {getContent} from '../../src/content/index.js';
import {battleMessage} from '../../src/ui/battle-state.js';
async function approach(){const sim=await makeSim(10);const player=hero(sim,0);const tower=sim.state.entities.find(e=>e.kind==='structure'&&e.team===1&&e.structureKind==='tower')!;const definition=getContent(10).map.structures.find(e=>e.name===tower.name)!;player.position={x:tower.position.x-definition.attackRange-player.radius+.2,z:tower.position.z};return{sim,player,tower,definition};}
describe('tower approach feedback',()=>{
  it('marks catalog reach plus player radius, not an invented aggro or safety state',async()=>{
    const {sim,player,tower,definition}=await approach(),snapshot=sim.snapshot(),before=JSON.stringify(snapshot);const reach=towerReach(snapshot,player.id,getContent(10)).find(r=>r.id===tower.id)!;
    expect(reach.radius).toBe(definition.attackRange+player.radius);expect(reach.inside).toBe(true);expect(reach.firedAtPlayer).toBe(false);expect(battleMessage(snapshot,snapshot.heroes[0]!,getContent(10)).label).toBe('ENEMY TOWER RANGE');expect(JSON.stringify(snapshot)).toBe(before);
    player.position.x-=1;expect(battleMessage(sim.snapshot(),sim.snapshot().heroes[0]!,getContent(10)).label).toBe('TOWER AHEAD');player.position.x-=5;expect(towerReach(sim.snapshot(),player.id,getContent(10)).some(r=>r.id===tower.id)).toBe(false);
  });
  it('requires a real committed tower attack on this player for the fire flash',async()=>{
    const {sim,player,tower}=await approach(),snapshot=sim.snapshot();const event={type:'basicAttack' as const,tick:snapshot.tick,ordinal:0,sourceId:tower.id,targetId:player.id};
    expect(towerReach({...snapshot,events:[event]},player.id,getContent(10))[0]!.firedAtPlayer).toBe(true);
    expect(towerReach({...snapshot,events:[{...event,targetId:hero(sim,1).id}]},player.id,getContent(10))[0]!.firedAtPlayer).toBe(false);
  });
  it('keeps the dashed reach separate from the short fire flash and removes dead/terminal boundaries',async()=>{
    const {sim,player,tower}=await approach(),snapshot=sim.snapshot(),scene=new THREE.Scene();const feedback=createTowerReach(scene,getContent(10));
    feedback.sync(snapshot,player.id);feedback.draw(0);const line=feedback.root.getObjectByName(`tower-reach-${tower.id}`) as THREE.Mesh;expect(line.geometry.getAttribute('position').count).toBe(384);expect(line.scale.x).toBe(towerReach(snapshot,player.id,getContent(10))[0]!.radius);
    const shot={...snapshot,tick:snapshot.tick+1,events:[{type:'basicAttack' as const,tick:snapshot.tick+1,ordinal:0,sourceId:tower.id,targetId:player.id}]};feedback.sync(shot,player.id);feedback.draw(0);expect((line.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff654f);
    for(let i=0;i<4;i++){feedback.sync(shot,player.id);feedback.draw(.1);}expect((line.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffe2a6);expect((line.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(.85);
    feedback.sync({...snapshot,tick:snapshot.tick+2,entities:snapshot.entities.map(e=>e.id===tower.id?{...e,alive:false}:e)},player.id);expect(feedback.root.children.length).toBe(0);
    feedback.sync({...snapshot,tick:snapshot.tick+3,status:'victory'},player.id);expect(feedback.root.children.length).toBe(0);feedback.dispose();expect(scene.children).toEqual([]);
  });
});
