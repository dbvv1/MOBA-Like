import type {AbilityDefinition,AbilitySlot,ContentCatalog} from '../../src/content/types.js';
import type {HeroSnapshot} from '../../src/sim/types.js';
export interface AbilityView {slot:AbilitySlot;abilityId:string;name:string;semantic:string|null;icon:string|null;cooldownTicks:number;cooldownSeconds:number;casting:boolean;disabled:boolean;reasons:string[]}
export function abilitySemantic(ability:AbilityDefinition):string|null;
export function iconUrl(semantic:string,theme?:'bright'|'dark'):string;
export function abilityViewModel(hero:HeroSnapshot,catalog:ContentCatalog,theme?:'bright'|'dark'):AbilityView[];
