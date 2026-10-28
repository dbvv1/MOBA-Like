export type TeamId = 0 | 1;
export type ContentVersion = 1 | 2 | 7 | 8 | 9 | 10;
export type AbilitySlot = 'Q' | 'W' | 'E' | 'R';
export type DamageType = 'physical' | 'magic' | 'true';
export type Difficulty = 'low' | 'normal' | 'high';
export type StructureKind = 'base' | 'barracks' | 'tower';
export type MinionKind = 'melee' | 'ranged' | 'siege';

export interface Vec2 {
  x: number;
  z: number;
}

export interface UnitStats {
  maxHp: number;
  maxMana: number;
  hpRegen: number;
  manaRegen: number;
  attackDamage: number;
  attackRange: number;
  attackInterval: number;
  armor: number;
  magicResist: number;
  moveSpeed: number;
  cooldownRate: number;
}

export interface HeroGrowth {
  maxHp: number;
  maxMana: number;
  attackDamage: number;
  armor: number;
  magicResist: number;
}

export type CombatEffect =
  | {
      type: 'damage';
      amount: number;
      perLevel: number;
      attackRatio: number;
      damageType: DamageType;
    }
  | { type: 'slow'; percent: number; duration: number }
  | { type: 'stun'; duration: number }
  | { type: 'shield'; amount: number; perLevel: number; maxHpRatio: number; duration: number }
  | { type: 'speed'; percent: number; duration: number };

export type AbilityDelivery =
  | 'unit'
  | 'projectile'
  | 'dash'
  | 'zone'
  | 'delayedArea'
  | 'self'
  | 'instant';

export type AbilityTargetType = 'enemyUnit' | 'direction' | 'point' | 'self';

export interface AbilityDefinition {
  id: string;
  heroId: string;
  slot: AbilitySlot;
  name: string;
  description: string;
  targetType: AbilityTargetType;
  delivery: AbilityDelivery;
  castTime: number;
  cooldown: number;
  manaCost: number;
  range: number;
  radius: number;
  width: number;
  projectileSpeed: number;
  maxDistance: number;
  delay: number;
  duration: number;
  tickInterval: number;
  effects: readonly CombatEffect[];
}

export interface HeroDefinition {
  id: string;
  name: string;
  title: string;
  baseStats: UnitStats;
  growth: HeroGrowth;
  abilities: Readonly<Record<AbilitySlot, string>>;
  itemBuild: readonly string[];
}

export interface ItemDefinition {
  id: string;
  name: string;
  cost: number;
  maxHp: number;
  maxMana: number;
  attackDamage: number;
  armor: number;
  magicResist: number;
  moveSpeed: number;
  attackSpeedPercent: number;
  cooldownRate: number;
}

export interface MinionDefinition {
  kind: MinionKind;
  name: string;
  maxHp: number;
  attackDamage: number;
  armor: number;
  magicResist: number;
  attackRange: number;
  attackInterval: number;
  moveSpeed: number;
  radius: number;
  bountyGold: number;
  bountyXp: number;
  structureDamageMultiplier: number;
}

export interface StructureDefinition {
  id: string;
  team: TeamId;
  kind: StructureKind;
  name: string;
  position: Vec2;
  radius: number;
  maxHp: number;
  armor: number;
  magicResist: number;
  attackRange: number;
  attackDamage: number;
  attackInterval: number;
  bountyGold: number;
  bountyXp: number;
  requiresDestroyed: readonly string[];
}

export interface WaveRules {
  firstWaveTime: number;
  interval: number;
  meleeCount: number;
  rangedCount: number;
  siegeEvery: number;
  siegeStartWave: number;
  laneOffsets: readonly number[];
}

export interface MatchRules {
  /** Ignore destroyed tower anchors; versions 1/2 retain their original AI inputs. */
  liveTowerAnchors?: boolean;
  /** A new life must reacquire targets before its difficulty reaction timer is ready. */
  resetReactionOnDeath?: boolean;
  stagedUnitPhase?: boolean;
  minionContactSpacing?: boolean;
  tickRate: number;
  maxMatchSeconds: number;
  waves: WaveRules;
  minionAggroRange: number;
  towerAggroMemorySeconds: number;
  towerAggroRadius: number;
  structureTargetingIntervalTicks: number;
  heroXpAuraRange: number;
  passiveGoldPerSecond: number;
  passiveXpPerSecond: number;
  heroRespawnBaseSeconds: number;
  heroRespawnPerLevelSeconds: number;
  xpLevels: readonly number[];
  minionHpPerWave: number;
  minionDamagePerWave: number;
}

export interface MapDefinition {
  name: string;
  world: { minX: number; maxX: number; minZ: number; maxZ: number };
  laneWidth: number;
  heroSpawns: Readonly<Record<TeamId, readonly Vec2[]>>;
  minionSpawns: Readonly<Record<TeamId, Vec2>>;
  structures: readonly StructureDefinition[];
  pushOrder: Readonly<Record<TeamId, readonly string[]>>;
}

export interface DifficultyTuning {
  reactionTicks: number;
  decisionTicks: number;
  aimErrorRadians: number;
  aimErrorMeters: number;
  decisionNoise: number;
  castSkipChance: number;
  comboChance: number;
  mistakeChance: number;
}

export interface ContentCatalog {
  version: ContentVersion;
  heroes: Readonly<Record<string, HeroDefinition>>;
  abilities: Readonly<Record<string, AbilityDefinition>>;
  items: Readonly<Record<string, ItemDefinition>>;
  minions: Readonly<Record<MinionKind, MinionDefinition>>;
  map: MapDefinition;
  rules: MatchRules;
  difficulty: Readonly<Record<Difficulty, DifficultyTuning>>;
  defaultHeroId: string;
}
