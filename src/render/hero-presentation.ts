import type {CharacterAssets} from '../../asset-pipeline/presentation/adapter.js';
import type {BattleAssets} from './battle-assets.js';

export type HeroSource='baseline'|'death-contact';
export const VEYRA_MOTION_OPTIONS={recoilLayer:'torso-additive',firstDrawRelease:.1} as const;

/** Part of the existing full Camera + Q/W trial, never a fourth public entry.
 * Ambiguous queries, the default page and quiet standards retain the old source. */
export function heroSourceForEntry(search:string,candidateEntry=false):HeroSource{
  const query=new URLSearchParams(search);
  const exactly=(name:string,value:string)=>{
    const values=query.getAll(name);return values.length===1&&values[0]===value;
  };
  return candidateEntry&&exactly('commands','buffer-v1')&&exactly('audio','critical-v1')&&
    exactly('camera','hold-follow-v1')&&exactly('lighting','forest-light-v1')&&
    (!query.has('materials')||exactly('materials','baseline'))?'death-contact':'baseline';
}

/** Shared by the real world and CPU consumer tests; no alternate animator. */
export function heroPresentationAssets(assets:BattleAssets):CharacterAssets{
  return {blue:assets.models['hero-teal']!,amber:assets.models['hero-rust']!,
    byDefinition:{veyra:{blue:assets.models['veyra-teal']!,amber:assets.models['veyra-rust']!,motionOptions:VEYRA_MOTION_OPTIONS}}};
}
