import type {ContentCatalog} from '../content/types.js';

/** Stable definition IDs; choosing a hero configures the next match, never mutates a live one. */
export function heroChoices(catalog:ContentCatalog){
  return Object.values(catalog.heroes).map(hero=>({id:hero.id,name:hero.name,title:hero.title,
    skills:(['Q','W','E','R'] as const).map(slot=>`${slot}: ${catalog.abilities[hero.abilities[slot]]!.name}`).join(' · ')}));
}
export function matchHeroes(catalog:ContentCatalog,playerId:string):[string[],string[]]{
  if(!Object.hasOwn(catalog.heroes,playerId))throw new Error(`Unknown player hero: ${playerId}`);
  // Keep the existing opponent and difficulty. Selection is not a new game mode.
  return [[playerId],['veyra']];
}
export function createHeroSelection(select:HTMLSelectElement,details:HTMLElement,catalog:ContentCatalog){
  const choices=heroChoices(catalog);
  select.replaceChildren(...choices.map(hero=>{const option=document.createElement('option');option.value=hero.id;option.textContent=hero.name;return option;}));
  select.value='veyra';
  const update=()=>{const hero=choices.find(hero=>hero.id===select.value);details.textContent=hero?`${hero.title} · ${hero.skills}. Applies when you restart; current match is unchanged.`:'';};
  select.addEventListener('change',update);update();
  return {read:()=>matchHeroes(catalog,select.value),setBusy:(busy:boolean)=>{select.disabled=busy;}};
}
