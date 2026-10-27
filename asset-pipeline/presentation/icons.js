const semanticNames = new Set(['targeted', 'displacement', 'persistent-effect', 'control', 'directional-projectile', 'self-shield']);
export function abilitySemantic(ability) {
  if (ability.delivery === 'dash') return 'displacement';
  if (ability.delivery === 'zone' && ability.duration > 0) return 'persistent-effect';
  if (ability.effects.some(effect => effect.type === 'stun')) return 'control';
  if (ability.delivery === 'unit' && ability.targetType === 'enemyUnit') return 'targeted';
  if (ability.delivery === 'projectile' && ability.targetType === 'direction') return 'directional-projectile';
  if (ability.delivery === 'self' && ability.targetType === 'self' && ability.effects.some(effect => effect.type === 'shield')) return 'self-shield';
  return null; // Unsupported delivery/target combinations keep their text label, not guessed art.
}
export function iconUrl(semantic, theme = 'dark') {
  if (!semanticNames.has(semantic) || !['bright', 'dark'].includes(theme)) throw new Error('Unknown icon semantic or theme');
  return new URL(`../icons/exported/${theme}/${semantic}.svg`, import.meta.url).href;
}
export function abilityViewModel(hero, catalog, theme = 'dark') {
  const definition = catalog.heroes[hero.definitionId];
  if (!definition) throw new Error(`Unknown hero definition: ${hero.definitionId}`);
  return Object.entries(definition.abilities).map(([slot, abilityId]) => {
    const ability = catalog.abilities[abilityId];
    if (!ability) throw new Error(`Unknown ability: ${abilityId}`);
    const semantic = abilitySemantic(ability);
    const cooldown = hero.cooldowns[slot];
    const casting = hero.castSlot === slot;
    const reasons = [];
    if (!hero.alive) reasons.push('dead');
    if (hero.stunned) reasons.push('stunned');
    if (hero.castSlot !== null) reasons.push('casting');
    if (cooldown > 0) reasons.push('cooldown');
    if (hero.mana < ability.manaCost) reasons.push('mana');
    return {slot, abilityId, name: ability.name, semantic, icon: semantic ? iconUrl(semantic, theme) : null,
      cooldownTicks: cooldown, cooldownSeconds: cooldown / catalog.rules.tickRate, casting, disabled: reasons.length > 0, reasons};
  });
}
