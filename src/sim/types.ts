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
  | { type: 'attackMove'; heroId: number; point: Vec2 }
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
  formatVersion: 1 | 2;
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
  attackMoveGoal?: Vec2;
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
  readonly id: number;
  readonly team: TeamId;
  readonly definitionId: string;
  readonly name: string;
  readonly position: Readonly<Vec2>;
  readonly hp: number;
  readonly maxHp: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly shield: number;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly items: readonly string[];
  readonly alive: boolean;
  readonly respawnAtTick: number;
  readonly cooldowns: Readonly<Record<AbilitySlot, number>>;
  readonly castSlot: AbilitySlot | null;
  readonly targetId: number | null;
  readonly moveGoal: Readonly<Vec2> | null;
  readonly stunned: boolean;
  readonly slowed: number;
  readonly kills: number;
  readonly deaths: number;
}

export interface EntitySnapshot {
  readonly id: number;
  readonly team: TeamId;
  readonly kind: Entity['kind'];
  readonly structureKind?: StructureKind;
  readonly minionKind?: MinionKind;
  readonly name: string;
  readonly position: Readonly<Vec2>;
  readonly radius: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly invulnerable: boolean;
}

export interface SnapshotAbilityStats {
  readonly casts: number;
  readonly hitCasts: number;
  readonly heroHits: number;
  readonly damage: number;
  readonly heroDamage: number;
}

export interface SnapshotMatchStats {
  readonly abilities: Readonly<Record<string, SnapshotAbilityStats>>;
  readonly basicAttackDamage: number;
  readonly basicAttackHeroDamage: number;
  readonly damageByTeam: readonly [number, number];
  readonly minionKills: readonly [number, number];
  readonly heroKills: readonly [number, number];
  readonly structureKills: readonly [number, number];
  readonly deaths: readonly [number, number];
}

export interface SnapshotStuckEvent {
  readonly tick: number;
  readonly entityId: number;
  readonly entityName: string;
  readonly team: TeamId;
  readonly position: Readonly<Vec2>;
  readonly secondsStationary: number;
}

export interface SnapshotDiagnostics {
  readonly pathFailures: number;
  readonly commandRejections: number;
  readonly rejectionReasons: Readonly<Record<string, number>>;
  readonly stuckEvents: readonly SnapshotStuckEvent[];
}

/** Derived output for one completed logic tick; never part of authoritative state/hash. */
export type PresentationEvent = Readonly<{ tick: number; ordinal: number } & (
  | { type: 'castStarted' | 'castResolved'; castId: number; heroId: number; abilityId: string; slot: AbilitySlot }
  | { type: 'castCancelled'; castId: number; heroId: number; abilityId: string; slot: AbilitySlot;
      reason: 'stunned' | 'dead' | 'missingAbility' | 'invalidTarget' | 'missingPoint' | 'invalidDestination' }
  | { type: 'basicAttack'; sourceId: number; targetId: number }
  | { type: 'heroDamaged'; targetId: number; sourceId: number; hpDamage: number; shieldAbsorbed: number; abilityId: string | null }
)>;

export interface Snapshot {
  readonly events: readonly PresentationEvent[];
  readonly tick: number;
  readonly timeSeconds: number;
  readonly status: SimStatus;
  readonly winner: TeamId | null;
  readonly endReason: string;
  readonly contentVersion: ContentVersion;
  readonly heroes: readonly HeroSnapshot[];
  readonly entities: readonly EntitySnapshot[];
  readonly projectiles: readonly {
    readonly id: number;
    readonly team: TeamId;
    readonly abilityId: string;
    readonly position: Readonly<Vec2>;
    readonly direction: Readonly<Vec2>;
    readonly width: number;
  }[];
  readonly delayedAreas: readonly {
    readonly id: number;
    readonly team: TeamId;
    readonly abilityId: string;
    readonly position: Readonly<Vec2>;
    readonly radius: number;
    readonly triggerTick: number;
  }[];
  readonly zones: readonly {
    readonly id: number;
    readonly team: TeamId;
    readonly abilityId: string;
    readonly position: Readonly<Vec2>;
    readonly radius: number;
    readonly expiresTick: number;
  }[];
  readonly stats: SnapshotMatchStats;
  readonly diagnostics: SnapshotDiagnostics;
}
