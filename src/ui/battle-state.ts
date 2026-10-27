import type {ContentCatalog,TeamId} from '../content/types.js';
import type {HeroSnapshot,Snapshot} from '../sim/types.js';

/** Describe the recorded outcome from the player's perspective, not a fixed team. */
export function matchResult(snapshot:Pick<Snapshot,'status'|'winner'|'endReason'>,playerTeam:TeamId){
  if(snapshot.status==='running')return null;
  const label=snapshot.winner===null
    ?snapshot.status==='timeout'?'TIME LIMIT':'MATCH ENDED'
    :snapshot.winner===playerTeam?'VICTORY':'DEFEAT';
  let reason:string;
  switch(snapshot.endReason){
    case 'blueBaseDestroyed':
    case 'redBaseDestroyed':{
      const destroyedTeam=snapshot.endReason==='blueBaseDestroyed'?0:1;
      reason=destroyedTeam===playerTeam?'Your Heartwood was destroyed.':'The enemy Heartwood was destroyed.';
      break;
    }
    case 'mutualBaseDestruction':
      // The simulation records a winner for this case; do not invent a draw.
      reason='Both Heartwoods were destroyed.';
      break;
    case 'maxMatchSeconds':reason='No winner was decided before the time limit.';break;
    default:reason=snapshot.winner===null?'No winner was declared.':snapshot.winner===playerTeam?'Your team won.':'The enemy team won.';
  }
  return {label,hint:`${reason} Restart to play again.`,announcement:`${label}. ${reason}`};
}

export function battleMessage(snapshot:Snapshot,hero:HeroSnapshot,catalog:ContentCatalog){
  const result=matchResult(snapshot,hero.team);
  if(result)return {tone:'end',label:result.label,hint:result.hint};
  if(!hero.alive)return {tone:'danger',label:'RETURNING TO THE FIELD',hint:`Respawn in ${Math.max(0,Math.ceil((hero.respawnAtTick-snapshot.tick)/catalog.rules.tickRate))}s`};
  if(hero.stunned)return {tone:'danger',label:'STUNNED',hint:'Movement, attacks and skills are blocked. Stop still cancels your prior order.'};
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
