import type {
  AbilityDefinition,
  ContentCatalog,
  ContentVersion,
  HeroDefinition,
  ItemDefinition,
  MapDefinition,
  MatchRules,
  MinionDefinition,
  StructureDefinition,
  UnitStats,
} from './types.js';

const waveRules = {
  firstWaveTime: 8,
  interval: 25,
  meleeCount: 4,
  rangedCount: 1,
  siegeEvery: 3,
  siegeStartWave: 3,
  laneOffsets: [-1.8, -0.9, 0, 0.9, 1.8, -2.7],
} as const;

const rules: MatchRules = {
  tickRate: 30,
  maxMatchSeconds: 20 * 60,
  waves: waveRules,
  minionAggroRange: 7,
  towerAggroMemorySeconds: 2.5,
  towerAggroRadius: 11,
  structureTargetingIntervalTicks: 12,
  heroXpAuraRange: 9,
  passiveGoldPerSecond: 2,
  passiveXpPerSecond: 2.5,
  heroRespawnBaseSeconds: 7,
  heroRespawnPerLevelSeconds: 1.25,
  xpLevels: [0, 180, 380, 620, 900, 1220, 1580, 1980, 2420, 2900, 3420, 4000],
  minionHpPerWave: 0.055,
  minionDamagePerWave: 0.045,
};

const items: Readonly<Record<string, ItemDefinition>> = {
  sunsteel_blade: {
    id: 'sunsteel_blade',
    name: 'Sunsteel Blade',
    cost: 800,
    maxHp: 0,
    maxMana: 0,
    attackDamage: 18,
    armor: 0,
    magicResist: 0,
    moveSpeed: 0,
    attackSpeedPercent: 0.12,
    cooldownRate: 0,
  },
  warden_plate: {
    id: 'warden_plate',
    name: 'Warden Plate',
    cost: 750,
    maxHp: 240,
    maxMana: 0,
    attackDamage: 0,
    armor: 18,
    magicResist: 8,
    moveSpeed: 0,
    attackSpeedPercent: 0,
    cooldownRate: 0,
  },
  wayfarer_boots: {
    id: 'wayfarer_boots',
    name: 'Wayfarer Boots',
    cost: 600,
    maxHp: 100,
    maxMana: 0,
    attackDamage: 0,
    armor: 0,
    magicResist: 0,
    moveSpeed: 0.7,
    attackSpeedPercent: 0,
    cooldownRate: 0.1,
  },
};

const minions: Readonly<Record<'melee' | 'ranged' | 'siege', MinionDefinition>> = {
  melee: {
    kind: 'melee',
    name: 'Furrow Guard',
    maxHp: 360,
    attackDamage: 20,
    armor: 2,
    magicResist: 0,
    attackRange: 1.6,
    attackInterval: 1.1,
    moveSpeed: 4.1,
    radius: 0.45,
    bountyGold: 24,
    bountyXp: 28,
    structureDamageMultiplier: 1,
  },
  ranged: {
    kind: 'ranged',
    name: 'Furrow Slinger',
    maxHp: 260,
    attackDamage: 23,
    armor: 0,
    magicResist: 0,
    attackRange: 5.6,
    attackInterval: 1.3,
    moveSpeed: 4,
    radius: 0.4,
    bountyGold: 20,
    bountyXp: 24,
    structureDamageMultiplier: 0.8,
  },
  siege: {
    kind: 'siege',
    name: 'Furrow Ram',
    maxHp: 650,
    attackDamage: 40,
    armor: 8,
    magicResist: 0,
    attackRange: 6.5,
    attackInterval: 1.6,
    moveSpeed: 3.6,
    radius: 0.7,
    bountyGold: 45,
    bountyXp: 50,
    structureDamageMultiplier: 1.8,
  },
};

function structure(
  id: string,
  team: 0 | 1,
  kind: StructureDefinition['kind'],
  name: string,
  x: number,
  maxHp: number,
  armor: number,
  magicResist: number,
  attackRange: number,
  attackDamage: number,
  attackInterval: number,
  bountyGold: number,
  bountyXp: number,
  radius: number,
  requiresDestroyed: readonly string[],
): StructureDefinition {
  return {
    id,
    team,
    kind,
    name,
    position: { x, z: 0 },
    radius,
    maxHp,
    armor,
    magicResist,
    attackRange,
    attackDamage,
    attackInterval,
    bountyGold,
    bountyXp,
    requiresDestroyed,
  };
}

const blueGuardIds = ['blue-outer-tower', 'blue-inner-tower', 'blue-barracks'] as const;
const redGuardIds = ['red-outer-tower', 'red-inner-tower', 'red-barracks'] as const;

const map: MapDefinition = {
  name: 'Ashen Furrow',
  world: { minX: -108, maxX: 108, minZ: -9, maxZ: 9 },
  laneWidth: 12,
  heroSpawns: {
    0: [
      { x: -94, z: 1.2 },
      { x: -94, z: -1.8 },
      { x: -96, z: 3.8 },
    ],
    1: [
      { x: 94, z: -1.2 },
      { x: 94, z: 1.8 },
      { x: 96, z: -3.8 },
    ],
  },
  minionSpawns: {
    0: { x: -77, z: 0 },
    1: { x: 77, z: 0 },
  },
  structures: [
    structure('blue-base', 0, 'base', 'Blue Heartwood', -101, 2600, 35, 35, 9, 110, 1, 0, 0, 4.5, blueGuardIds),
    structure('blue-barracks', 0, 'barracks', 'Blue Barracks', -82, 1500, 15, 0, 0, 0, 1, 180, 150, 2.6, []),
    structure('blue-inner-tower', 0, 'tower', 'Blue Inner Tower', -56, 1600, 25, 20, 8.8, 85, 0.95, 150, 100, 2.4, []),
    structure('blue-outer-tower', 0, 'tower', 'Blue Outer Tower', -28, 1400, 20, 15, 8.5, 75, 0.95, 150, 100, 2.4, []),
    structure('red-base', 1, 'base', 'Red Heartwood', 101, 2600, 35, 35, 9, 110, 1, 0, 0, 4.5, redGuardIds),
    structure('red-barracks', 1, 'barracks', 'Red Barracks', 82, 1500, 15, 0, 0, 0, 1, 180, 150, 2.6, []),
    structure('red-inner-tower', 1, 'tower', 'Red Inner Tower', 56, 1600, 25, 20, 8.8, 85, 0.95, 150, 100, 2.4, []),
    structure('red-outer-tower', 1, 'tower', 'Red Outer Tower', 28, 1400, 20, 15, 8.5, 75, 0.95, 150, 100, 2.4, []),
  ],
  pushOrder: {
    0: ['red-outer-tower', 'red-inner-tower', 'red-barracks', 'red-base'],
    1: ['blue-outer-tower', 'blue-inner-tower', 'blue-barracks', 'blue-base'],
  },
};

const difficulty = {
  low: {
    reactionTicks: 45,
    decisionTicks: 30,
    aimErrorRadians: 0.7,
    aimErrorMeters: 3.6,
    decisionNoise: 0.9,
    castSkipChance: 0.5,
    comboChance: 0.3,
    mistakeChance: 0.1,
  },
  normal: {
    reactionTicks: 12,
    decisionTicks: 12,
    aimErrorRadians: 0.16,
    aimErrorMeters: 1,
    decisionNoise: 0.25,
    castSkipChance: 0.1,
    comboChance: 0.75,
    mistakeChance: 0.015,
  },
  high: {
    reactionTicks: 4,
    decisionTicks: 6,
    aimErrorRadians: 0.04,
    aimErrorMeters: 0.35,
    decisionNoise: 0.07,
    castSkipChance: 0,
    comboChance: 0.95,
    mistakeChance: 0,
  },
} as const;

const veyraBaseStats: UnitStats = {
  maxHp: 720,
  maxMana: 330,
  hpRegen: 3,
  manaRegen: 8,
  attackDamage: 54,
  attackRange: 5.2,
  attackInterval: 0.85,
  armor: 16,
  magicResist: 24,
  moveSpeed: 7,
  cooldownRate: 0,
};

const morrowBaseStats: UnitStats = {
  maxHp: 820,
  maxMana: 300,
  hpRegen: 4,
  manaRegen: 7,
  attackDamage: 50,
  attackRange: 5.8,
  attackInterval: 0.95,
  armor: 20,
  magicResist: 28,
  moveSpeed: 6.8,
  cooldownRate: 0,
};

function damageAbility(
  id: string,
  heroId: string,
  slot: AbilityDefinition['slot'],
  name: string,
  description: string,
  targetType: AbilityDefinition['targetType'],
  delivery: AbilityDefinition['delivery'],
  values: Partial<AbilityDefinition> & { damage: number; perLevel: number; attackRatio: number },
): AbilityDefinition {
  return {
    id,
    heroId,
    slot,
    name,
    description,
    targetType,
    delivery,
    castTime: values.castTime ?? 0.15,
    cooldown: values.cooldown ?? 5,
    manaCost: values.manaCost ?? 40,
    range: values.range ?? 9.5,
    radius: values.radius ?? 0,
    width: values.width ?? 0,
    projectileSpeed: values.projectileSpeed ?? 0,
    maxDistance: values.maxDistance ?? 0,
    delay: values.delay ?? 0,
    duration: values.duration ?? 0,
    tickInterval: values.tickInterval ?? 0,
    effects: [
      ...(values.effects ?? []),
      {
        type: 'damage',
        amount: values.damage,
        perLevel: values.perLevel,
        attackRatio: values.attackRatio,
        damageType: 'magic',
      },
    ],
  };
}

const veyraQTargeted = damageAbility(
  'veyra.q',
  'veyra',
  'Q',
  'Rift Lancet',
  'A targeted lance of pale fire. Requires an enemy unit.',
  'enemyUnit',
  'unit',
  {
    castTime: 0.18,
    cooldown: 4.5,
    manaCost: 40,
    range: 9.5,
    damage: 55,
    perLevel: 6,
    attackRatio: 0.55,
  },
);

const veyraQProjectile = damageAbility(
  'veyra.q',
  'veyra',
  'Q',
  'Rift Lancet',
  'A direction-fired lance of pale fire. It strikes the first enemy in its path.',
  'direction',
  'projectile',
  {
    castTime: 0.15,
    cooldown: 4.5,
    manaCost: 40,
    range: 11.5,
    width: 1.1,
    projectileSpeed: 26,
    maxDistance: 11.5,
    damage: 55,
    perLevel: 6,
    attackRatio: 0.55,
  },
);

const veyraW: AbilityDefinition = {
  id: 'veyra.w',
  heroId: 'veyra',
  slot: 'W',
  name: 'Slipstream',
  description: 'Dash a short distance in the chosen direction.',
  targetType: 'direction',
  delivery: 'dash',
  castTime: 0,
  cooldown: 8,
  manaCost: 30,
  range: 0,
  radius: 0,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 7,
  delay: 0,
  duration: 0,
  tickInterval: 0,
  effects: [],
};

const veyraE: AbilityDefinition = {
  id: 'veyra.e',
  heroId: 'veyra',
  slot: 'E',
  name: 'Cinder Bloom',
  description: 'Grow a burning patch that damages and slows enemies for 4 seconds.',
  targetType: 'point',
  delivery: 'zone',
  castTime: 0.15,
  cooldown: 10,
  manaCost: 55,
  range: 9,
  radius: 3.2,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 0,
  delay: 0,
  duration: 4,
  tickInterval: 0.5,
  effects: [
    {
      type: 'damage',
      amount: 12,
      perLevel: 1.2,
      attackRatio: 0.1,
      damageType: 'magic',
    },
    { type: 'slow', percent: 0.25, duration: 0.7 },
  ],
};

const veyraR: AbilityDefinition = {
  id: 'veyra.r',
  heroId: 'veyra',
  slot: 'R',
  name: 'Skyfall Seal',
  description: 'Call down a delayed seal that damages and stuns enemies in an area.',
  targetType: 'point',
  delivery: 'delayedArea',
  castTime: 0.25,
  cooldown: 50,
  manaCost: 100,
  range: 12,
  radius: 3,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 0,
  delay: 0.65,
  duration: 0,
  tickInterval: 0,
  effects: [
    {
      type: 'damage',
      amount: 130,
      perLevel: 10,
      attackRatio: 0.6,
      damageType: 'magic',
    },
    { type: 'stun', duration: 1.4 },
  ],
};

const morrowQ = damageAbility(
  'morrow.q',
  'morrow',
  'Q',
  'Briar Volley',
  'Fire a thorn volley in a direction, striking the first enemy and slowing it.',
  'direction',
  'projectile',
  {
    castTime: 0.15,
    cooldown: 5,
    manaCost: 40,
    range: 11,
    width: 1.2,
    projectileSpeed: 25,
    maxDistance: 11,
    damage: 50,
    perLevel: 5,
    attackRatio: 0.45,
    effects: [{ type: 'slow', percent: 0.3, duration: 2 }],
  },
);

const morrowW: AbilityDefinition = {
  id: 'morrow.w',
  heroId: 'morrow',
  slot: 'W',
  name: 'Barkguard',
  description: 'Wrap yourself in living bark, gaining a shield and brief movement speed.',
  targetType: 'self',
  delivery: 'self',
  castTime: 0,
  cooldown: 12,
  manaCost: 50,
  range: 0,
  radius: 0,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 0,
  delay: 0,
  duration: 0,
  tickInterval: 0,
  effects: [
    { type: 'shield', amount: 90, perLevel: 15, maxHpRatio: 0.15, duration: 3 },
    { type: 'speed', percent: 0.2, duration: 2 },
  ],
};

const morrowE: AbilityDefinition = {
  id: 'morrow.e',
  heroId: 'morrow',
  slot: 'E',
  name: 'Rootsong',
  description: 'Seed a humming ring that damages and slows enemies for 4.5 seconds.',
  targetType: 'point',
  delivery: 'zone',
  castTime: 0.15,
  cooldown: 11,
  manaCost: 60,
  range: 8.5,
  radius: 3.2,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 0,
  delay: 0,
  duration: 4.5,
  tickInterval: 0.5,
  effects: [
    {
      type: 'damage',
      amount: 10,
      perLevel: 1,
      attackRatio: 0.1,
      damageType: 'magic',
    },
    { type: 'slow', percent: 0.2, duration: 0.7 },
  ],
};

const morrowR: AbilityDefinition = {
  id: 'morrow.r',
  heroId: 'morrow',
  slot: 'R',
  name: 'Verdant Grasp',
  description: 'A delayed ring of roots that damages and stuns enemies in an area.',
  targetType: 'point',
  delivery: 'delayedArea',
  castTime: 0.25,
  cooldown: 55,
  manaCost: 105,
  range: 11,
  radius: 3,
  width: 0,
  projectileSpeed: 0,
  maxDistance: 0,
  delay: 0.7,
  duration: 0,
  tickInterval: 0,
  effects: [
    {
      type: 'damage',
      amount: 100,
      perLevel: 9,
      attackRatio: 0.5,
      damageType: 'magic',
    },
    { type: 'stun', duration: 1.6 },
  ],
};

const veyra = (q: AbilityDefinition): HeroDefinition => ({
  id: 'veyra',
  name: 'Veyra',
  title: 'the Rift Gardener',
  baseStats: veyraBaseStats,
  growth: {
    maxHp: 78,
    maxMana: 28,
    attackDamage: 4.8,
    armor: 2.2,
    magicResist: 1.2,
  },
  abilities: { Q: q.id, W: veyraW.id, E: veyraE.id, R: veyraR.id },
  itemBuild: ['sunsteel_blade', 'wayfarer_boots', 'warden_plate'],
});

const morrow: HeroDefinition = {
  id: 'morrow',
  name: 'Morrow',
  title: 'the Briar Sentinel',
  baseStats: morrowBaseStats,
  growth: {
    maxHp: 95,
    maxMana: 24,
    attackDamage: 4,
    armor: 3,
    magicResist: 1.5,
  },
  abilities: { Q: morrowQ.id, W: morrowW.id, E: morrowE.id, R: morrowR.id },
  itemBuild: ['warden_plate', 'sunsteel_blade', 'wayfarer_boots'],
};

function catalog(version: ContentVersion): ContentCatalog {
  if (version === 1) {
    return {
      version,
      heroes: { veyra: veyra(veyraQTargeted) },
      abilities: {
        [veyraQTargeted.id]: veyraQTargeted,
        [veyraW.id]: veyraW,
        [veyraE.id]: veyraE,
        [veyraR.id]: veyraR,
      },
      items,
      minions,
      map,
      rules,
      difficulty,
      defaultHeroId: 'veyra',
    };
  }

  if (version === 2) {
    return {
      version,
      heroes: { veyra: veyra(veyraQProjectile), morrow },
      abilities: {
        [veyraQProjectile.id]: veyraQProjectile,
        [veyraW.id]: veyraW,
        [veyraE.id]: veyraE,
        [veyraR.id]: veyraR,
        [morrowQ.id]: morrowQ,
        [morrowW.id]: morrowW,
        [morrowE.id]: morrowE,
        [morrowR.id]: morrowR,
      },
      items,
      minions,
      map,
      rules,
      difficulty,
      defaultHeroId: 'veyra',
    };
  }

  throw new Error(`unknown content version: ${String(version)}`);
}

export const CONTENT_VERSIONS: readonly ContentVersion[] = [1, 2] as const;

export function getContent(version: ContentVersion): ContentCatalog {
  if (version !== 1 && version !== 2) {
    throw new Error(`unknown content version: ${String(version)}`);
  }
  return catalog(version);
}

export type { AbilityDefinition, ContentCatalog, HeroDefinition, ItemDefinition, MapDefinition };
