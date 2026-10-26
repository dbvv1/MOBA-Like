import * as THREE from 'three';
export type CombatTextures={release:THREE.Texture;dispose():void};
/** One shared source texture, owned by one world, never by a burst. */
export async function loadCombatTextures():Promise<CombatTextures|undefined>{
  // This cosmetic source must not stop an otherwise playable match.
  const release=await new THREE.TextureLoader().loadAsync(new URL('../../asset-pipeline/combat-vfx/source/trace_02.png',import.meta.url).href).catch(()=>undefined);
  if(!release)return undefined;
  release.colorSpace=THREE.SRGBColorSpace;
  // Sample the useful authored streak rather than stretching its empty margins.
  release.offset.set(200/512,80/512);release.repeat.set(112/512,400/512);
  let disposed=false;return {release,dispose(){if(disposed)return;disposed=true;release.dispose();}};
}
