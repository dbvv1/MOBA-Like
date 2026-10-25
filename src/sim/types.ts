import type {
  AbilitySlot,
  CombatEffect,
  ContentVersion,
  MinionKind,
  StructureKind,
  TeamId,
  UnitStats,
  Vec2,
} from '../content/types.js';

export type SimStatus = 'running' | 'blueWin' | 'redWin' | 'timeout';

export type SimCommand =
  | { type: 'move'; heroId: number; point: Vec2 }
  | { type: 'attack'; heroId: number; targetId: number }
  | { type: 'stop'; heroId: number }
  | {
      type: 'cast';
      heroId: number;
      slot: AbilitySlot;
      targetId: number | null;
      direction: Vec2 | null;
      point: Vec2 | null;
    }
  | { type: 'buyItem'; heroId: number; itemId: string };

export interface CommandResult {
  command: SimCommand;
  accepted: boolean;
  reason: string | null;
}

export interface TimedCommand {
  tick: number;
  command: SimCommand;
}

export interface Replay {
  formatVersion: 1;
  contentVersion: ContentVersion;
  seed: number;
  heroesPerTeam: number;
  heroIdsByTeam: readonly [readonly string[], readonly string[]];
  maxMatchSeconds: number;
  commands: readonly TimedCommand[];
  finalHash: string;
  status: SimStatus;
  winner: TeamId | null;
  durationSeconds: number;
}

export interface ActiveStatus {
  kind: 'slow' | 'speed' | 'stun';
  percent: number;
  expiresTick: number;
  sourceId: number;
}

export interface CastState {
  id: number;
  slot: AbilitySlot;
  abilityId: string;
  remainingTicks: number;
  targetId: number | null;
  direction: Vec2 | null;
  point: Vec2 | null;
}

interface EntityBase {
  id: number;
  team: TeamId;
  name: string;
  position: Vec2;
  facing: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  armor: number;
  magicResist: number;
  alive: boolean;
  targetId: number | null;
  moveGoal: Vec2 | null;
  path: Vec2[];
  pathIndex: number;
  pathRefreshTick: number;
  attackCooldown: number;
  statuses: ActiveStatus[];
}

export interface HeroEntity extends EntityBase {
  kind: 'hero';
  definitionId: string;
  slotIndex: number;
  level: number;
  xp: number;
  gold: number;
  mana: number;
  items: string[];
  stats: UnitStats;
  cast: CastState | null;
  cooldowns: Record<AbilitySlot, number>;
  shield: number;
  shieldExpiresTick: number;
  respawnAtTick: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface MinionEntity extends EntityBase {
  kind: 'minion';
  definitionId: string;
  minionKind: MinionKind;
  wave: number;
  targetRefreshTick: number;
}

export interface StructureEntity extends EntityBase {
  kind: 'structure';
  definitionId: string;
  structureKind: StructureKind;
  invulnerable: boolean;
  attackRange: number;
  attackDamage: number;
  attackInterval: number;
  aggroHeroId: number | null;
  aggroUntilTick: number;
  targetRefreshTick: number;
}

export type Entity = HeroEntity | MinionEntity | StructureEntity;

export interface ProjectileEntity {
  id: number;
  team: TeamId;
  sourceHeroId: number;
  abilityId: string;
  castId: number;
  position: Vec2;
  direction: Vec2;
  speed: number;
  width: number;
  remainingDistance: number;
  effects: readonly CombatEffect[];
  alive: boolean;
  hitTarget: boolean;
}

export interface ZoneEntity {
  id: number;
  team: TeamId;
  sourceHeroId: number;
  abilityId: string;
  castId: number;
  position: Vec2;
  radius: number;
  expiresTick: number;
  nextTickTick: number;
  tickIntervalTicks: number;
  effects: readonly CombatEffect[];
  hitTarget: boolean;
}

export interface DelayedAreaEntity {
  id: number;
  team: TeamId;
  sourceHeroId: number;
  abilityId: string;
  castId: number;
  position: Vec2;
  radius: number;
  triggerTick: number;
  effects: readonly CombatEffect[];
  hitTarget: boolean;
}

export interface AbilityStats {
  casts: number;
  hitCasts: number;
  heroHits: number;
  damage: number;
  heroDamage: number;
}

export interface MatchStats {
  abilities: Record<string, AbilityStats>;
  basicAttackDamage: number;
  basicAttackHeroDamage: number;
  damageByTeam: [number, number];
  minionKills: [number, number];
  heroKills: [number, number];
  structureKills: [number, number];
  deaths: [number, number];
}

export interface StuckEvent {
  tick: number;
  entityId: number;
  entityName: string;
  team: TeamId;
  position: Vec2;
  secondsStationary: number;
}

export interface Diagnostics {
  pathFailures: number;
  commandRejections: number;
  rejectionReasons: Record<string, number>;
  stuckEvents: StuckEvent[];
}

export interface SimState {
  tick: number;
  timeSeconds: number;
  status: SimStatus;
  winner: TeamId | null;
  endReason: string;
  rngState: number;
  nextEntityId: number;
  nextCastId: number;
  nextProjectileId: number;
  nextZoneId: number;
  nextDelayedId: number;
  entities: Entity[];
  projectiles: ProjectileEntity[];
  zones: ZoneEntity[];
  delayedAreas: DelayedAreaEntity[];
  stats: MatchStats;
  waveNumber: number;
  nextWaveTick: number;
  diagnostics: Diagnostics;
}

export interface HeroSnapshot {
  id: number;
  team: TeamId;
  definitionId: string;
  name: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  shield: number;
  level: number;
  xp: number;
  gold: number;
  items: string[];
  alive: boolean;
  respawnAtTick: number;
  cooldowns: Record<AbilitySlot, number>;
  castSlot: AbilitySlot | null;
  targetId: number | null;
  moveGoal: Vec2 | null;
  stunned: boolean;
  slowed: number;
  kills: number;
  deaths: number;
}

export interface EntitySnapshot {
  id: number;
  team: TeamId;
  kind: Entity['kind'];
  structureKind?: StructureKind;
  minionKind?: MinionKind;
  name: string;
  position: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  invulnerable: boolean;
}

export interface Snapshot {
  tick: number;
  timeSeconds: number;
  status: SimStatus;
  winner: TeamId | null;
  endReason: string;
  contentVersion: ContentVersion;
  heroes: HeroSnapshot[];
  entities: EntitySnapshot[];
  projectiles: {
    id: number;
    team: TeamId;
    abilityId: string;
    position: Vec2;
  }[];
  zones: { id: number; team: TeamId; abilityId: string; position: Vec2; radius: number; expiresTick: number }[];
  stats: MatchStats;
  diagnostics: Diagnostics;
}
