import type {CharacterAssets} from '../../asset-pipeline/presentation/adapter.js';
import type {BattleAssets} from './battle-assets.js';
import {isCombatTrial} from '../combat-trial.js';

export type HeroSource='baseline'|'death-contact';
export const MORROW_MOTION_OPTIONS={recoilLayer:'torso-additive',firstDrawRelease:.1} as const;
export const VEYRA_MOTION_OPTIONS={recoilLayer:'torso-additive',firstDrawRelease:.1} as const;

/** Part of the existing full Camera + Q/W trial, never a fourth public entry.
 * Ambiguous queries, the default page and quiet standards retain the old source. */
export function heroSourceForEntry(search:string,candidateEntry=false):HeroSource{
  return isCombatTrial(search,candidateEntry)?'death-contact':'baseline';
}

/** Shared by the real world and CPU consumer tests; no alternate animator. */
export function heroPresentationAssets(assets:BattleAssets,heroSource:HeroSource='baseline'):CharacterAssets{
  return {blue:assets.models['hero-teal']!,amber:assets.models['hero-rust']!,
    byDefinition:{morrow:{blue:assets.models['hero-teal']!,amber:assets.models['hero-rust']!,...(heroSource==='death-contact'?{motionOptions:MORROW_MOTION_OPTIONS}:{})},veyra:{blue:assets.models['veyra-teal']!,amber:assets.models['veyra-rust']!,motionOptions:VEYRA_MOTION_OPTIONS}}};
}
