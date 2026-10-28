import type {AbilityTargetType} from '../content/types.js';

const targeting:Record<AbilityTargetType,string>={
  enemyUnit:'Enemy target: select the skill, then left-click an enemy.',
  direction:'Direction: select the skill, then left-click the ground to aim.',
  point:'Ground target: select the skill, then left-click a point.',
  self:'Self: selecting the skill casts immediately.'
};
export function skillDescription(name:string,targetType:AbilityTargetType,reasons:readonly string[]):string {
  return `${name} — ${targeting[targetType]} State: ${reasons.length?reasons.join(', '):'ready to aim'}. Range and target rules still apply.`;
}
