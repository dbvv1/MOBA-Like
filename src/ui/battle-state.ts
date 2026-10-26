import type {ContentCatalog} from '../content/types.js';
import type {HeroSnapshot,Snapshot} from '../sim/types.js';
export function battleMessage(snapshot:Snapshot,hero:HeroSnapshot,catalog:ContentCatalog){
  if(snapshot.status!=='running')return {tone:'end',label:snapshot.winner===hero.team?'VICTORY':'MATCH ENDED',hint:'Restart to enter a new battle.'};
  if(!hero.alive)return {tone:'danger',label:'RETURNING TO THE FIELD',hint:`Respawn in ${Math.max(0,Math.ceil((hero.respawnAtTick-snapshot.tick)/catalog.rules.tickRate))}s`};
  const danger=snapshot.entities.some(entity=>{
    if(!entity.alive||entity.team===hero.team||entity.kind!=='structure'||entity.structureKind!=='tower')return false;
    const definition=catalog.map.structures.find(value=>value.name===entity.name&&value.team===entity.team);
    return definition&&Math.hypot(hero.position.x-entity.position.x,hero.position.z-entity.position.z)<=definition.attackRange+(snapshot.entities.find(value=>value.id===hero.id)?.radius??0);
  });
  if(danger)return {tone:'danger',label:'ENEMY TOWER RANGE',hint:'Stay with your minions. Attacking a hero can draw tower fire.'};
  if(hero.hp/hero.maxHp<.25)return {tone:'danger',label:'LOW HEALTH',hint:'Make space before the next exchange.'};
  return {tone:'normal',label:'ADVANCE WITH YOUR WAVE',hint:'Push through the towers to destroy the enemy Heartwood.'};
}
