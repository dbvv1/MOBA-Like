import type {ContentCatalog} from '../content/types.js';
import type {HeroSnapshot,Snapshot} from '../sim/types.js';
export function battleMessage(snapshot:Snapshot,hero:HeroSnapshot,catalog:ContentCatalog){
  if(snapshot.status!=='running')return {tone:'end',label:snapshot.winner===hero.team?'VICTORY':'MATCH ENDED',hint:'Restart to enter a new battle.'};
  if(!hero.alive)return {tone:'danger',label:'RETURNING TO THE FIELD',hint:`Respawn in ${Math.max(0,Math.ceil((hero.respawnAtTick-snapshot.tick)/catalog.rules.tickRate))}s`};
  let nearby=false;
  const danger=snapshot.entities.some(entity=>{
    if(!entity.alive||entity.team===hero.team||entity.kind!=='structure'||entity.structureKind!=='tower')return false;
    const definition=catalog.map.structures.find(value=>value.name===entity.name&&value.team===entity.team);
    if(!definition)return false;
    const distance=Math.hypot(hero.position.x-entity.position.x,hero.position.z-entity.position.z),reach=definition.attackRange+(snapshot.entities.find(value=>value.id===hero.id)?.radius??0);
    if(distance<=reach+5)nearby=true;
    return distance<=reach;
  });
  if(danger)return {tone:'danger',label:'ENEMY TOWER RANGE',hint:'Dashed boundary shows reach, not current aggro. Stay with your minions.'};
  if(hero.hp/hero.maxHp<.25)return {tone:'danger',label:'LOW HEALTH',hint:'Make space before the next exchange.'};
  if(nearby)return {tone:'normal',label:'TOWER AHEAD',hint:'Dashed boundary marks tower reach, not who it is targeting.'};
  return {tone:'normal',label:'ADVANCE WITH YOUR WAVE',hint:'Push through the towers to destroy the enemy Heartwood.'};
}
