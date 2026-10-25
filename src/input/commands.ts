import type {AbilitySlot, ContentCatalog, Vec2} from '../content/types.js';
import type {HeroSnapshot, SimCommand, Snapshot} from '../sim/types.js';

export type Aim = {point:Vec2|null; entityId:number|null};
export function commandForCast(hero:HeroSnapshot, slot:AbilitySlot, aim:Aim, snapshot:Snapshot, catalog:ContentCatalog):SimCommand|null {
  const definition=catalog.heroes[hero.definitionId];
  const ability=definition && catalog.abilities[definition.abilities[slot]];
  if(!ability || !hero.alive) return null;
  const base={type:'cast' as const,heroId:hero.id,slot,targetId:null,direction:null,point:null};
  switch(ability.targetType){
    case 'self': return base;
    case 'enemyUnit': {
      const target=snapshot.entities.find(entity=>entity.id===aim.entityId && entity.team!==hero.team && entity.alive);
      return target?{...base,targetId:target.id}:null;
    }
    case 'point': return validPoint(aim.point)?{...base,point:{...aim.point}}:null;
    case 'direction': {
      if(!validPoint(aim.point))return null;
      const x=aim.point.x-hero.position.x,z=aim.point.z-hero.position.z,length=Math.hypot(x,z);
      return length>1e-6?{...base,direction:{x:x/length,z:z/length}}:null;
    }
  }
}
export function validPoint(point:Vec2|null):point is Vec2 {return point!==null && Number.isFinite(point.x)&&Number.isFinite(point.z);}
export function moveCommand(heroId:number,point:Vec2|null):SimCommand|null {return validPoint(point)?{type:'move',heroId,point:{...point}}:null;}
export function isInputElement(target:EventTarget|null):boolean {
  // Avoid requiring DOM globals in pure Node tests.
  const element=target as {tagName?:string;isContentEditable?:boolean}|null;
  return Boolean(element?.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(element?.tagName??''));
}
