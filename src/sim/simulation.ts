import type {
  AbilitySlot,
  CombatEffect,
  ContentCatalog,
  ContentVersion,
  StructureDefinition,
  TeamId,
  UnitStats,
  Vec2,
} from '../content/types.js';
import { getContent } from '../content/catalog.js';
import { hashValue } from './hash.js';
import {
  add,
  clamp,
  copyVec,
  distance,
  distanceToSegment,
  isFiniteVec,
  length,
  normalize,
  projectPointOnSegment,
  scale,
  sub,
} from './math.js';
import type { Navigation } from './navigation.js';
import { SeededRng } from './rng.js';
import type {
  AbilityStats,
  ActiveStatus,
  CastState,
  CommandResult,
  DelayedAreaEntity,
  Diagnostics,
  Entity,
  HeroEntity,
  HeroSnapshot,
  MatchStats,
  MinionEntity,
  ProjectileEntity,
  PresentationEvent,
  Replay,
  SimCommand,
  SimState,
  SimStatus,
  Snapshot,
  StructureEntity,
  ZoneEntity,
} from './types.js';

interface UnitAttackIntent { sourceId: number; targetId: number; damage: number; }

export interface SimulationOptions {
  seed: number;
  contentVersion: ContentVersion;
  navigation: Navigation;
  heroesPerTeam?: number;
  heroIdsByTeam?: readonly [readonly string[], readonly string[]];
  maxMatchSeconds?: number;
}

export interface SimulationConfigSummary {
  seed: number;
  contentVersion: ContentVersion;
  heroesPerTeam: number;
  heroIdsByTeam: readonly [readonly string[], readonly string[]];
  maxMatchSeconds: number;
}

const ALL_SLOTS: readonly AbilitySlot[] = ['Q', 'W', 'E', 'R'];

function otherTeam(team: TeamId): TeamId {
  return team === 0 ? 1 : 0;
}

function makeAbilityStats(): AbilityStats {
  return { casts: 0, hitCasts: 0, heroHits: 0, damage: 0, heroDamage: 0 };
}

function makeMatchStats(catalog: ContentCatalog): MatchStats {
  const abilities: Record<string, AbilityStats> = {};
  for (const id of Object.keys(catalog.abilities)) {
    abilities[id] = makeAbilityStats();
  }
  return {
    abilities,
    basicAttackDamage: 0,
    basicAttackHeroDamage: 0,
    damageByTeam: [0, 0],
    minionKills: [0, 0],
    heroKills: [0, 0],
    structureKills: [0, 0],
    deaths: [0, 0],
  };
}

function copyMatchStats(stats: MatchStats): MatchStats {
  const abilities: Record<string, AbilityStats> = {};
  for (const [id, ability] of Object.entries(stats.abilities)) {
    abilities[id] = { ...ability };
  }
  return {
    abilities,
    basicAttackDamage: stats.basicAttackDamage,
    basicAttackHeroDamage: stats.basicAttackHeroDamage,
    damageByTeam: [stats.damageByTeam[0], stats.damageByTeam[1]],
    minionKills: [stats.minionKills[0], stats.minionKills[1]],
    heroKills: [stats.heroKills[0], stats.heroKills[1]],
    structureKills: [stats.structureKills[0], stats.structureKills[1]],
    deaths: [stats.deaths[0], stats.deaths[1]],
  };
}

function copyDiagnostics(diagnostics: Diagnostics): Diagnostics {
  return {
    pathFailures: diagnostics.pathFailures,
    commandRejections: diagnostics.commandRejections,
    rejectionReasons: { ...diagnostics.rejectionReasons },
    stuckEvents: diagnostics.stuckEvents.map((event) => ({
      ...event,
      position: copyVec(event.position),
    })),
  };
}

export class Simulation {
  readonly catalog: ContentCatalog;
  readonly navigation: Navigation;
  readonly seed: number;
  readonly config: SimulationConfigSummary;
  readonly state: SimState;

  private stepEvents: PresentationEvent[] = [];

  private readonly rng: SeededRng;
  private readonly maxMatchSeconds: number;
  private readonly tickRate: number;
  private readonly dt: number;
  private readonly stuckSince = new Map<number, { x: number; z: number; tick: number }>();

  constructor(options: SimulationOptions) {
    this.seed = options.seed >>> 0;
    this.catalog = getContent(options.contentVersion);
    this.navigation = options.navigation;
    this.tickRate = this.catalog.rules.tickRate;
    this.dt = 1 / this.tickRate;
    this.maxMatchSeconds = options.maxMatchSeconds ?? this.catalog.rules.maxMatchSeconds;

    const heroesPerTeam = options.heroesPerTeam ?? 1;
    if (!Number.isInteger(heroesPerTeam) || heroesPerTeam < 1) {
      throw new Error('heroesPerTeam must be a positive integer');
    }
    const heroIdsByTeam: [readonly string[], readonly string[]] = [
      normalizeHeroIds(options.heroIdsByTeam?.[0], heroesPerTeam, this.catalog, 0),
      normalizeHeroIds(options.heroIdsByTeam?.[1], heroesPerTeam, this.catalog, 1),
    ];
    this.config = {
      seed: this.seed,
      contentVersion: options.contentVersion,
      heroesPerTeam,
      heroIdsByTeam,
      maxMatchSeconds: this.maxMatchSeconds,
    };

    this.rng = new SeededRng(this.seed);
    this.state = {
      tick: 0,
      timeSeconds: 0,
      status: 'running',
      winner: null,
      endReason: 'running',
      rngState: this.rng.state,
      nextEntityId: 1,
      nextCastId: 1,
      nextProjectileId: 1,
      nextZoneId: 1,
      nextDelayedId: 1,
      entities: [],
      projectiles: [],
      zones: [],
      delayedAreas: [],
      stats: makeMatchStats(this.catalog),
      waveNumber: 0,
      nextWaveTick: Math.max(1, Math.round(this.catalog.rules.waves.firstWaveTime * this.tickRate)),
      diagnostics: { pathFailures: 0, commandRejections: 0, rejectionReasons: {}, stuckEvents: [] },
    };

    this.createStructures();
    for (const team of [0, 1] as const) {
      for (let slotIndex = 0; slotIndex < heroesPerTeam; slotIndex += 1) {
        const heroId = heroIdsByTeam[team][slotIndex];
        if (!heroId) {
          throw new Error(`missing hero id for team ${team} slot ${slotIndex}`);
        }
        this.createHero(team, slotIndex, heroId);
      }
    }
  }

  get tickRateHz(): number {
    return this.tickRate;
  }

  get timeSeconds(): number {
    return this.state.timeSeconds;
  }

  get status(): SimStatus {
    return this.state.status;
  }

  isComplete(): boolean {
    return this.state.status !== 'running';
  }

  step(commands: readonly SimCommand[]): CommandResult[] {
    if (this.state.status !== 'running') {
      this.state.diagnostics.commandRejections += commands.length;
      return commands.map((command) => ({
        command,
        accepted: false,
        reason: 'matchEnded',
      }));
    }

    this.stepEvents = [];
    this.state.tick += 1;
    this.state.timeSeconds = this.state.tick / this.tickRate;

    const results: CommandResult[] = [];
    for (const command of commands) {
      results.push(this.applyCommand(command));
    }

    this.advanceCasts();
    this.advanceProjectiles();
    this.advanceZones();
    this.advanceDelayedAreas();
    this.updateUnits();
    this.updateStructures();
    this.updateRespawns();
    this.updateEconomy();
    this.updateWaves();
    this.recomputeStructureVulnerability();
    this.cleanup();
    this.checkEndCondition();
    this.updateStuckDiagnostics();

    return results;
  }

  private emit(event: PresentationEvent extends infer E ? E extends PresentationEvent ? Omit<E, 'tick' | 'ordinal'> : never : never): void {
    this.stepEvents.push({ ...event, tick: this.state.tick, ordinal: this.stepEvents.length } as PresentationEvent);
  }

  private castEvent(hero: HeroEntity, cast: CastState, type: 'castStarted' | 'castResolved'): void {
    this.emit({ type, castId: cast.id, heroId: hero.id, abilityId: cast.abilityId, slot: cast.slot });
  }

  private cancelledCast(hero: HeroEntity, cast: CastState | null, reason: Extract<PresentationEvent, { type: 'castCancelled' }>['reason']): void {
    if (cast) this.emit({ type: 'castCancelled', castId: cast.id, heroId: hero.id, abilityId: cast.abilityId, slot: cast.slot, reason });
  }

  finalHash(): string {
    return hashValue(this.state);
  }

  createReplay(timedCommands: Replay['commands']): Replay {
    return {
      formatVersion: timedCommands.some(entry => entry.command.type === 'attackMove') ? 2 : 1,
      contentVersion: this.catalog.version,
      seed: this.seed,
      heroesPerTeam: this.config.heroesPerTeam,
      heroIdsByTeam: this.config.heroIdsByTeam,
      maxMatchSeconds: this.maxMatchSeconds,
      commands: timedCommands,
      finalHash: this.finalHash(),
      status: this.state.status,
      winner: this.state.winner,
      durationSeconds: this.state.timeSeconds,
    };
  }

  snapshot(): Snapshot {
    const heroes: HeroSnapshot[] = [];
    for (const entity of this.state.entities) {
      if (entity.kind !== 'hero') {
        continue;
      }
      heroes.push({
        id: entity.id,
        team: entity.team,
        definitionId: entity.definitionId,
        name: entity.name,
        position: copyVec(entity.position),
        hp: entity.hp,
        maxHp: entity.maxHp,
        mana: entity.mana,
        maxMana: entity.stats.maxMana,
        shield: entity.shield,
        level: entity.level,
        xp: entity.xp,
        gold: entity.gold,
        items: [...entity.items],
        alive: entity.alive,
        respawnAtTick: entity.respawnAtTick,
        cooldowns: { ...entity.cooldowns },
        castSlot: entity.cast?.slot ?? null,
        targetId: entity.targetId,
        moveGoal: entity.moveGoal ? copyVec(entity.moveGoal) : null,
        stunned: this.isStunned(entity),
        slowed: this.slowPercent(entity),
        kills: entity.kills,
        deaths: entity.deaths,
      });
    }

    return {
      events: this.stepEvents.map(event => ({ ...event })),
      tick: this.state.tick,
      timeSeconds: this.state.timeSeconds,
      status: this.state.status,
      winner: this.state.winner,
      endReason: this.state.endReason,
      contentVersion: this.catalog.version,
      heroes,
      entities: this.state.entities.map((entity) => ({
        id: entity.id,
        team: entity.team,
        kind: entity.kind,
        ...(entity.kind === 'structure' ? { structureKind: entity.structureKind } : {}),
        ...(entity.kind === 'minion' ? { minionKind: entity.minionKind } : {}),
        name: entity.name,
        position: copyVec(entity.position),
        radius: entity.radius,
        hp: entity.hp,
        maxHp: entity.maxHp,
        alive: entity.alive,
        invulnerable: entity.kind === 'structure' ? entity.invulnerable : false,
      })),
      projectiles: this.state.projectiles.map((projectile) => ({
        id: projectile.id,
        team: projectile.team,
        abilityId: projectile.abilityId,
        position: copyVec(projectile.position),
        direction: copyVec(projectile.direction),
        width: projectile.width,
      })),
      delayedAreas: this.state.delayedAreas.map((area) => ({
        id: area.id,
        team: area.team,
        abilityId: area.abilityId,
        position: copyVec(area.position),
        radius: area.radius,
        triggerTick: area.triggerTick,
      })),
      zones: this.state.zones.map((zone) => ({
        id: zone.id,
        team: zone.team,
        abilityId: zone.abilityId,
        position: copyVec(zone.position),
        radius: zone.radius,
        expiresTick: zone.expiresTick,
      })),
      stats: copyMatchStats(this.state.stats),
      diagnostics: copyDiagnostics(this.state.diagnostics),
    };
  }

  getHero(team: TeamId, slotIndex = 0): HeroEntity | null {
    return (
      this.state.entities.find(
        (entity): entity is HeroEntity =>
          entity.kind === 'hero' && entity.team === team && entity.slotIndex === slotIndex,
      ) ?? null
    );
  }

  getEntityById(id: number): Entity | null {
    return this.state.entities.find((entity) => entity.id === id) ?? null;
  }

  getAbilityStats(abilityId: string): AbilityStats | null {
    return this.state.stats.abilities[abilityId] ?? null;
  }

  private createStructures(): void {
    for (const def of this.catalog.map.structures) {
      const entity: StructureEntity = {
        id: this.state.nextEntityId++,
        kind: 'structure',
        team: def.team,
        definitionId: def.id,
        structureKind: def.kind,
        name: def.name,
        position: copyVec(def.position),
        facing: { x: def.team === 0 ? 1 : -1, z: 0 },
        radius: def.radius,
        hp: def.maxHp,
        maxHp: def.maxHp,
        armor: def.armor,
        magicResist: def.magicResist,
        alive: true,
        invulnerable: def.requiresDestroyed.length > 0,
        attackRange: def.attackRange,
        attackDamage: def.attackDamage,
        attackInterval: def.attackInterval,
        targetId: null,
        moveGoal: null,
        path: [],
        pathIndex: 0,
        pathRefreshTick: 0,
        attackCooldown: 0,
        statuses: [],
        aggroHeroId: null,
        aggroUntilTick: 0,
        targetRefreshTick: 0,
      };
      this.state.entities.push(entity);
    }
  }

  private createHero(team: TeamId, slotIndex: number, heroId: string): void {
    const def = this.catalog.heroes[heroId];
    if (!def) {
      throw new Error(`unknown hero definition: ${heroId}`);
    }
    const spawn = this.catalog.map.heroSpawns[team][slotIndex] ?? {
      x: this.catalog.map.heroSpawns[team][0]?.x ?? 0,
      z: 0,
    };
    const stats = this.computeHeroStats(def.id, 1, []);
    const entity: HeroEntity = {
      id: this.state.nextEntityId++,
      kind: 'hero',
      team,
      definitionId: def.id,
      slotIndex,
      name: def.name,
      position: this.navigation.closestPoint(spawn) ?? copyVec(spawn),
      facing: { x: team === 0 ? 1 : -1, z: 0 },
      radius: 0.55,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      mana: stats.maxMana,
      armor: stats.armor,
      magicResist: stats.magicResist,
      alive: true,
      targetId: null,
      moveGoal: null,
      path: [],
      pathIndex: 0,
      pathRefreshTick: 0,
      attackCooldown: 0,
      statuses: [],
      level: 1,
      xp: 0,
      gold: 0,
      items: [],
      stats,
      cast: null,
      cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      shield: 0,
      shieldExpiresTick: 0,
      respawnAtTick: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    this.state.entities.push(entity);
  }

  private computeHeroStats(heroId: string, level: number, items: readonly string[]): UnitStats {
    const def = this.catalog.heroes[heroId];
    if (!def) {
      throw new Error(`unknown hero definition: ${heroId}`);
    }
    let maxHp = def.baseStats.maxHp + def.growth.maxHp * (level - 1);
    let maxMana = def.baseStats.maxMana + def.growth.maxMana * (level - 1);
    let attackDamage = def.baseStats.attackDamage + def.growth.attackDamage * (level - 1);
    let armor = def.baseStats.armor + def.growth.armor * (level - 1);
    let magicResist = def.baseStats.magicResist + def.growth.magicResist * (level - 1);
    let moveSpeed = def.baseStats.moveSpeed;
    let attackSpeedPercent = 0;
    let cooldownRate = 0;
    for (const itemId of items) {
      const item = this.catalog.items[itemId];
      if (!item) {
        continue;
      }
      maxHp += item.maxHp;
      maxMana += item.maxMana;
      attackDamage += item.attackDamage;
      armor += item.armor;
      magicResist += item.magicResist;
      moveSpeed += item.moveSpeed;
      attackSpeedPercent += item.attackSpeedPercent;
      cooldownRate += item.cooldownRate;
    }
    return {
      ...def.baseStats,
      maxHp,
      maxMana,
      attackDamage,
      armor,
      magicResist,
      moveSpeed,
      attackInterval: def.baseStats.attackInterval / (1 + attackSpeedPercent),
      cooldownRate,
    };
  }

  private applyCommand(command: SimCommand): CommandResult {
    const fail = (reason: string): CommandResult => {
      this.state.diagnostics.commandRejections += 1;
      this.state.diagnostics.rejectionReasons[reason] =
        (this.state.diagnostics.rejectionReasons[reason] ?? 0) + 1;
      return { command, accepted: false, reason };
    };

    const hero = this.state.entities.find(
      (entity): entity is HeroEntity => entity.kind === 'hero' && entity.id === command.heroId,
    );
    if (!hero) {
      return fail('invalidHero');
    }
    if (this.state.status !== 'running') {
      return fail('matchEnded');
    }
    if (!hero.alive) {
      return fail('heroDead');
    }

    switch (command.type) {
      case 'move':
        return this.commandMove(hero, command.point, fail);
      case 'attackMove': {
        const result = this.commandMove(hero, command.point, fail);
        if (!result.accepted) return result;
        hero.attackMoveGoal = copyVec(hero.moveGoal!);
        return { command: { ...command, point: copyVec(command.point) }, accepted: true, reason: null };
      }
      case 'attack':
        return this.commandAttack(hero, command.targetId, fail);
      case 'stop':
        delete hero.attackMoveGoal;
        hero.targetId = null;
        hero.moveGoal = null;
        hero.path = [];
        hero.pathIndex = 0;
        return { command, accepted: true, reason: null };
      case 'cast':
        return this.commandCast(hero, command, fail);
      case 'buyItem':
        return this.commandBuyItem(hero, command.itemId, fail);
      default: {
        const exhaustive: never = command;
        return fail(`unknownCommand:${String(exhaustive)}`);
      }
    }
  }

  private commandMove(
    hero: HeroEntity,
    point: Vec2,
    fail: (reason: string) => CommandResult,
  ): CommandResult {
    if (!isFiniteVec(point)) {
      return fail('invalidPoint');
    }
    if (this.isStunned(hero)) {
      return fail('stunned');
    }
    const snapped = this.navigation.closestPoint(this.clampToWorld(point));
    if (!snapped) {
      this.state.diagnostics.pathFailures += 1;
      return fail('pathNotFound');
    }
    const path = this.navigation.findPath(hero.position, snapped);
    if (!path.success) {
      this.state.diagnostics.pathFailures += 1;
      return fail('pathNotFound');
    }
    delete hero.attackMoveGoal;
    hero.targetId = null;
    hero.moveGoal = snapped;
    hero.path = path.points;
    hero.pathIndex = 0;
    hero.pathRefreshTick = this.state.tick;
    return { command: { type: 'move', heroId: hero.id, point: copyVec(point) }, accepted: true, reason: null };
  }

  private commandAttack(
    hero: HeroEntity,
    targetId: number,
    fail: (reason: string) => CommandResult,
  ): CommandResult {
    if (this.isStunned(hero)) {
      return fail('stunned');
    }
    const target = this.getEntityById(targetId);
    if (!target || target.team === hero.team) {
      return fail('invalidTarget');
    }
    if (!target.alive) {
      return fail('targetDead');
    }
    if (target.kind === 'structure' && target.invulnerable) {
      return fail('targetInvulnerable');
    }
    delete hero.attackMoveGoal;
    hero.targetId = targetId;
    hero.moveGoal = null;
    hero.path = [];
    hero.pathIndex = 0;
    hero.pathRefreshTick = 0;
    return {
      command: { type: 'attack', heroId: hero.id, targetId },
      accepted: true,
      reason: null,
    };
  }

  private commandCast(
    hero: HeroEntity,
    command: Extract<SimCommand, { type: 'cast' }>,
    fail: (reason: string) => CommandResult,
  ): CommandResult {
    if (this.isStunned(hero)) {
      return fail('stunned');
    }
    if (hero.cast) {
      return fail('alreadyCasting');
    }
    const abilityId = this.catalog.heroes[hero.definitionId]?.abilities[command.slot];
    const ability = abilityId ? this.catalog.abilities[abilityId] : null;
    if (!ability) {
      return fail('unknownAbility');
    }
    if (hero.cooldowns[command.slot] > 0) {
      return fail('cooldown');
    }
    if (hero.mana < ability.manaCost) {
      return fail('mana');
    }

    let targetId: number | null = null;
    let direction: Vec2 | null = null;
    let point: Vec2 | null = null;

    if (ability.targetType === 'enemyUnit') {
      if (command.targetId === null) {
        return fail('targetRequired');
      }
      const target = this.getEntityById(command.targetId);
      if (!target || !target.alive || target.team === hero.team) {
        return fail('invalidTarget');
      }
      if (target.kind === 'structure' && target.invulnerable) {
        return fail('targetInvulnerable');
      }
      if (distance(hero.position, target.position) > ability.range + target.radius) {
        return fail('outOfRange');
      }
      targetId = target.id;
    } else if (ability.targetType === 'direction') {
      if (!isFiniteVec(command.direction) || length(command.direction) < 0.001) {
        return fail('directionRequired');
      }
      direction = normalize(command.direction);
    } else if (ability.targetType === 'point') {
      if (!isFiniteVec(command.point)) {
        return fail('pointRequired');
      }
      const snapped = this.navigation.closestPoint(this.clampToWorld(command.point));
      if (!snapped) {
        this.state.diagnostics.pathFailures += 1;
        return fail('invalidPoint');
      }
      if (distance(hero.position, snapped) > ability.range + 0.25) {
        return fail('outOfRange');
      }
      point = snapped;
    }

    hero.mana -= ability.manaCost;
    const cooldownTicks = Math.max(
      1,
      Math.ceil((ability.cooldown / (1 + hero.stats.cooldownRate)) * this.tickRate),
    );
    hero.cooldowns[command.slot] = cooldownTicks;
    hero.targetId = null;
    hero.moveGoal = null;
    hero.path = [];
    hero.pathIndex = 0;
    const cast: CastState = {
      id: this.state.nextCastId++,
      slot: command.slot,
      abilityId: ability.id,
      remainingTicks: Math.max(0, Math.ceil(ability.castTime * this.tickRate)),
      targetId,
      direction,
      point,
    };
    const stats = this.ensureAbilityStats(ability.id);
    stats.casts += 1;

    this.castEvent(hero, cast, 'castStarted');
    if (cast.remainingTicks <= 0) {
      this.resolveCast(hero, cast);
    } else {
      hero.cast = cast;
    }

    return {
      command: {
        type: 'cast',
        heroId: hero.id,
        slot: command.slot,
        targetId: command.targetId,
        direction: command.direction ? copyVec(command.direction) : null,
        point: command.point ? copyVec(command.point) : null,
      },
      accepted: true,
      reason: null,
    };
  }

  private commandBuyItem(
    hero: HeroEntity,
    itemId: string,
    fail: (reason: string) => CommandResult,
  ): CommandResult {
    const item = this.catalog.items[itemId];
    if (!item) {
      return fail('unknownItem');
    }
    if (hero.items.includes(itemId)) {
      return fail('alreadyOwned');
    }
    if (hero.gold < item.cost) {
      return fail('notEnoughGold');
    }
    const oldStats = hero.stats;
    hero.gold -= item.cost;
    hero.items.push(itemId);
    const nextStats = this.computeHeroStats(hero.definitionId, hero.level, hero.items);
    hero.stats = nextStats;
    hero.maxHp = nextStats.maxHp;
    hero.hp = Math.min(nextStats.maxHp, hero.hp + Math.max(0, nextStats.maxHp - oldStats.maxHp));
    hero.mana = Math.min(nextStats.maxMana, hero.mana + Math.max(0, nextStats.maxMana - oldStats.maxMana));
    hero.armor = nextStats.armor;
    hero.magicResist = nextStats.magicResist;
    return { command: { type: 'buyItem', heroId: hero.id, itemId }, accepted: true, reason: null };
  }

  private advanceCasts(): void {
    for (const entity of this.state.entities) {
      if (entity.kind !== 'hero' || !entity.alive || !entity.cast) {
        continue;
      }
      if (this.isStunned(entity)) {
        this.cancelledCast(entity, entity.cast, 'stunned');
        entity.cast = null;
        continue;
      }
      entity.cast.remainingTicks -= 1;
      if (entity.cast.remainingTicks <= 0) {
        const cast = entity.cast;
        entity.cast = null;
        this.resolveCast(entity, cast);
      }
    }
  }

  private resolveCast(hero: HeroEntity, cast: CastState): void {
    if (!hero.alive || this.isStunned(hero)) {
      this.cancelledCast(hero, cast, hero.alive ? 'stunned' : 'dead');
      return;
    }
    const ability = this.catalog.abilities[cast.abilityId];
    if (!ability) {
      this.cancelledCast(hero, cast, 'missingAbility');
      return;
    }
    const stats = this.ensureAbilityStats(ability.id);

    switch (ability.delivery) {
      case 'unit': {
        const target = cast.targetId === null ? null : this.getEntityById(cast.targetId);
        if (
          !target ||
          !target.alive ||
          target.team === hero.team ||
          (target.kind === 'structure' && target.invulnerable) ||
          distance(hero.position, target.position) > ability.range + target.radius + 1
        ) {
          this.cancelledCast(hero, cast, 'invalidTarget');
          return;
        }
        this.castEvent(hero, cast, 'castResolved');
        hero.facing = normalize(sub(target.position, hero.position));
        const tracker = { hit: false, hitHero: false };
        this.applyEffects(hero, target, ability.effects, ability.id, cast.id, tracker);
        if (tracker.hit) {
          stats.hitCasts += 1;
        }
        return;
      }
      case 'projectile': {
        this.castEvent(hero, cast, 'castResolved');
        const direction = cast.direction ? normalize(cast.direction) : hero.facing;
        hero.facing = direction;
        const projectile: ProjectileEntity = {
          id: this.state.nextProjectileId++,
          team: hero.team,
          sourceHeroId: hero.id,
          abilityId: ability.id,
          castId: cast.id,
          position: add(hero.position, scale(direction, hero.radius + 0.12)),
          direction,
          speed: ability.projectileSpeed,
          width: ability.width,
          remainingDistance: ability.maxDistance || ability.range,
          effects: ability.effects,
          alive: true,
          hitTarget: false,
        };
        this.state.projectiles.push(projectile);
        return;
      }
      case 'dash': {
        const direction = cast.direction ? normalize(cast.direction) : hero.facing;
        const desired = this.clampToWorld(add(hero.position, scale(direction, ability.maxDistance)));
        const destination = this.navigation.closestPoint(desired);
        if (destination) {
          this.castEvent(hero, cast, 'castResolved');
          hero.position = destination;
          hero.facing = direction;
          hero.path = [];
          hero.pathIndex = 0;
          hero.moveGoal = null;
          stats.hitCasts += 1;
        } else {
          this.cancelledCast(hero, cast, 'invalidDestination');
          this.state.diagnostics.pathFailures += 1;
        }
        return;
      }
      case 'zone': {
        if (!cast.point) {
          this.cancelledCast(hero, cast, 'missingPoint');
          return;
        }
        this.castEvent(hero, cast, 'castResolved');
        const zone: ZoneEntity = {
          id: this.state.nextZoneId++,
          team: hero.team,
          sourceHeroId: hero.id,
          abilityId: ability.id,
          castId: cast.id,
          position: copyVec(cast.point),
          radius: ability.radius,
          expiresTick: this.state.tick + Math.max(1, Math.ceil(ability.duration * this.tickRate)),
          nextTickTick: this.state.tick + Math.max(1, Math.ceil(ability.tickInterval * this.tickRate)),
          tickIntervalTicks: Math.max(1, Math.ceil(ability.tickInterval * this.tickRate)),
          effects: ability.effects,
          hitTarget: false,
        };
        this.state.zones.push(zone);
        return;
      }
      case 'delayedArea': {
        if (!cast.point) {
          this.cancelledCast(hero, cast, 'missingPoint');
          return;
        }
        this.castEvent(hero, cast, 'castResolved');
        const delayed: DelayedAreaEntity = {
          id: this.state.nextDelayedId++,
          team: hero.team,
          sourceHeroId: hero.id,
          abilityId: ability.id,
          castId: cast.id,
          position: copyVec(cast.point),
          radius: ability.radius,
          triggerTick: this.state.tick + Math.max(1, Math.ceil(ability.delay * this.tickRate)),
          effects: ability.effects,
          hitTarget: false,
        };
        this.state.delayedAreas.push(delayed);
        return;
      }
      case 'self': {
        this.castEvent(hero, cast, 'castResolved');
        const tracker = { hit: false, hitHero: false };
        this.applyEffects(hero, hero, ability.effects, ability.id, cast.id, tracker);
        stats.hitCasts += 1;
        return;
      }
      case 'instant': {
        this.castEvent(hero, cast, 'castResolved');
        return;
      }
      default: {
        const exhaustive: never = ability.delivery;
        throw new Error(`unhandled delivery ${String(exhaustive)}`);
      }
    }
  }

  private advanceProjectiles(): void {
    const survivors: ProjectileEntity[] = [];
    for (const projectile of this.state.projectiles) {
      if (!projectile.alive) {
        continue;
      }
      const source = this.getEntityById(projectile.sourceHeroId);
      if (!source) {
        continue;
      }
      const stepDistance = Math.min(
        projectile.remainingDistance,
        projectile.speed * this.dt,
      );
      const from = projectile.position;
      const to = add(from, scale(projectile.direction, stepDistance));
      let hit: Entity | null = null;
      let hitT = Number.POSITIVE_INFINITY;
      for (const entity of this.state.entities) {
        if (
          !entity.alive ||
          entity.team === projectile.team ||
          (entity.kind === 'structure' && entity.invulnerable)
        ) {
          continue;
        }
        if (distanceToSegment(entity.position, from, to) <= projectile.width + entity.radius) {
          const t = projectPointOnSegment(entity.position, from, to);
          if (t < hitT) {
            hitT = t;
            hit = entity;
          }
        }
      }

      projectile.position = to;
      projectile.remainingDistance -= stepDistance;
      if (hit) {
        const tracker = { hit: false, hitHero: false };
        this.applyEffects(source, hit, projectile.effects, projectile.abilityId, projectile.castId, tracker);
        if (tracker.hit) {
          const stats = this.ensureAbilityStats(projectile.abilityId);
          if (!projectile.hitTarget) {
            stats.hitCasts += 1;
            projectile.hitTarget = true;
          }
        }
        projectile.alive = false;
        continue;
      }
      if (projectile.remainingDistance <= 0.0001) {
        projectile.alive = false;
        continue;
      }
      survivors.push(projectile);
    }
    this.state.projectiles = survivors;
  }

  private advanceZones(): void {
    const survivors: ZoneEntity[] = [];
    for (const zone of this.state.zones) {
      const source = this.getEntityById(zone.sourceHeroId);
      if (!source) {
        continue;
      }
      while (zone.nextTickTick <= this.state.tick) {
        const dueTick = zone.nextTickTick;
        zone.nextTickTick += zone.tickIntervalTicks;
        if (dueTick > zone.expiresTick) {
          break;
        }
        const tracker = { hit: false, hitHero: false };
        for (const entity of this.state.entities) {
          if (
            !entity.alive ||
            entity.team === zone.team ||
            (entity.kind === 'structure' && entity.invulnerable)
          ) {
            continue;
          }
          if (distance(zone.position, entity.position) <= zone.radius + entity.radius) {
            this.applyEffects(source, entity, zone.effects, zone.abilityId, zone.castId, tracker);
          }
        }
        if (tracker.hit) {
          const stats = this.ensureAbilityStats(zone.abilityId);
          if (!zone.hitTarget) {
            stats.hitCasts += 1;
            zone.hitTarget = true;
          }
        }
      }
      if (this.state.tick <= zone.expiresTick) {
        survivors.push(zone);
      }
    }
    this.state.zones = survivors;
  }

  private advanceDelayedAreas(): void {
    const survivors: DelayedAreaEntity[] = [];
    for (const delayed of this.state.delayedAreas) {
      if (delayed.triggerTick > this.state.tick) {
        survivors.push(delayed);
        continue;
      }
      const source = this.getEntityById(delayed.sourceHeroId);
      if (!source) {
        continue;
      }
      const tracker = { hit: false, hitHero: false };
      for (const entity of this.state.entities) {
        if (
          !entity.alive ||
          entity.team === delayed.team ||
          (entity.kind === 'structure' && entity.invulnerable)
        ) {
          continue;
        }
        if (distance(delayed.position, entity.position) <= delayed.radius + entity.radius) {
          this.applyEffects(source, entity, delayed.effects, delayed.abilityId, delayed.castId, tracker);
        }
      }
      if (tracker.hit) {
        const stats = this.ensureAbilityStats(delayed.abilityId);
        stats.hitCasts += 1;
      }
    }
    this.state.delayedAreas = survivors;
  }

  private applyEffects(
    source: Entity,
    target: Entity,
    effects: readonly CombatEffect[],
    abilityId: string | null,
    _castId: number | null,
    tracker?: { hit: boolean; hitHero: boolean },
  ): void {
    if (!target.alive) {
      return;
    }
    const sourceHero = source.kind === 'hero' ? source : null;
    const level = sourceHero?.level ?? 1;
    const attackDamage = sourceHero?.stats.attackDamage ?? 0;
    const stats = abilityId ? this.ensureAbilityStats(abilityId) : null;

    for (const effect of effects) {
      if (!target.alive) {
        break;
      }
      switch (effect.type) {
        case 'damage': {
          const amount =
            effect.amount + effect.perLevel * (level - 1) + effect.attackRatio * attackDamage;
          const actual = this.dealDamage(source, target, amount, effect.damageType, abilityId);
          if (actual > 0 && stats) {
            stats.damage += actual;
            if (tracker) {
              tracker.hit = true;
              if (target.kind === 'hero') {
                tracker.hitHero = true;
              }
            }
            if (target.kind === 'hero') {
              stats.heroDamage += actual;
              stats.heroHits += 1;
            }
          }
          break;
        }
        case 'slow': {
          if (target.kind !== 'structure') {
            this.addStatus(target, {
              kind: 'slow',
              percent: effect.percent,
              expiresTick: this.state.tick + Math.max(1, Math.ceil(effect.duration * this.tickRate)),
              sourceId: source.id,
            });
            if (tracker && target.team !== source.team) {
              tracker.hit = true;
            }
          }
          break;
        }
        case 'stun': {
          if (target.kind !== 'structure') {
            this.addStatus(target, {
              kind: 'stun',
              percent: 0,
              expiresTick: this.state.tick + Math.max(1, Math.ceil(effect.duration * this.tickRate)),
              sourceId: source.id,
            });
            if (target.kind === 'hero') {
              this.cancelledCast(target, target.cast, 'stunned');
              target.cast = null;
              target.path = [];
              target.pathIndex = 0;
            }
            if (tracker && target.team !== source.team) {
              tracker.hit = true;
            }
          }
          break;
        }
        case 'shield': {
          if (target.kind === 'hero') {
            const amount = effect.amount + effect.perLevel * (level - 1) + effect.maxHpRatio * target.maxHp;
            target.shield += amount;
            target.shieldExpiresTick = Math.max(
              target.shieldExpiresTick,
              this.state.tick + Math.max(1, Math.ceil(effect.duration * this.tickRate)),
            );
          }
          break;
        }
        case 'speed': {
          if (target.kind !== 'structure') {
            this.addStatus(target, {
              kind: 'speed',
              percent: effect.percent,
              expiresTick: this.state.tick + Math.max(1, Math.ceil(effect.duration * this.tickRate)),
              sourceId: source.id,
            });
          }
          break;
        }
        default: {
          const exhaustive: never = effect;
          throw new Error(`unhandled effect ${String(exhaustive)}`);
        }
      }
    }

  }

  private dealDamage(
    source: Entity,
    target: Entity,
    rawDamage: number,
    damageType: 'physical' | 'magic' | 'true',
    abilityId: string | null,
  ): number {
    if (!target.alive || rawDamage <= 0) {
      return 0;
    }
    if (target.kind === 'structure' && target.invulnerable) {
      return 0;
    }
    const resistance =
      damageType === 'physical'
        ? target.armor
        : damageType === 'magic'
          ? target.magicResist
          : 0;
    const mitigated = rawDamage * (100 / (100 + Math.max(0, resistance)));
    if (mitigated <= 0) {
      return 0;
    }

    this.state.stats.damageByTeam[source.team] += mitigated;
    if (abilityId) {
      // Ability damage is recorded by applyEffects, where the target type is known.
    } else if (source.kind === 'hero') {
      this.state.stats.basicAttackDamage += mitigated;
      if (target.kind === 'hero') {
        this.state.stats.basicAttackHeroDamage += mitigated;
      }
    }

    const hpBefore = target.hp;
    let shieldAbsorbed = 0;
    let remaining = mitigated;
    if (target.kind === 'hero' && target.shield > 0 && target.shieldExpiresTick > this.state.tick) {
      const absorbed = Math.min(target.shield, remaining);
      shieldAbsorbed = absorbed;
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      target.hp -= remaining;
    }

    if (target.kind === 'hero') this.emit({ type: 'heroDamaged', targetId: target.id, sourceId: source.id, hpDamage: Math.min(Math.max(0, hpBefore), remaining), shieldAbsorbed, abilityId });

    if (source.kind === 'hero' && target.kind === 'hero' && source.team !== target.team) {
      this.notifyTowerAggro(source, target);
    }

    if (target.hp <= 0) {
      this.handleDeath(target, source);
    }
    return mitigated;
  }

  private notifyTowerAggro(attacker: HeroEntity, victim: HeroEntity): void {
    for (const entity of this.state.entities) {
      if (
        entity.kind !== 'structure' ||
        entity.team !== victim.team ||
        !entity.alive ||
        entity.structureKind === 'barracks' ||
        entity.attackRange <= 0
      ) {
        continue;
      }
      if (distance(entity.position, victim.position) <= entity.attackRange + 2.5) {
        entity.aggroHeroId = attacker.id;
        entity.aggroUntilTick =
          this.state.tick + Math.ceil(this.catalog.rules.towerAggroMemorySeconds * this.tickRate);
        entity.targetRefreshTick = 0;
      }
    }
  }

  private handleDeath(target: Entity, source: Entity): void {
    if (!target.alive) return;
    this.markDeath(target);
    this.awardDeathRewards(target, source);
  }

  private markDeath(target: Entity): void {
    if (!target.alive) {
      return;
    }
    target.alive = false;
    target.hp = 0;
    target.targetId = null;
    target.moveGoal = null;
    target.path = [];
    target.pathIndex = 0;
    target.statuses = [];
    if (target.kind === 'hero') {
      delete target.attackMoveGoal;
      this.cancelledCast(target, target.cast, 'dead');
      target.cast = null;
      target.shield = 0;
      target.deaths += 1;
      target.respawnAtTick =
        this.state.tick +
        Math.ceil(
          (this.catalog.rules.heroRespawnBaseSeconds +
            this.catalog.rules.heroRespawnPerLevelSeconds * (target.level - 1)) *
            this.tickRate,
        );
      this.state.stats.deaths[target.team] += 1;
    }
    if (target.kind === 'structure') {
      this.state.stats.structureKills[otherTeam(target.team)] += 1;
      this.recomputeStructureVulnerability();
    }
    if (target.kind === 'minion') {
      this.state.stats.minionKills[otherTeam(target.team)] += 1;
    }

  }

  private awardDeathRewards(target: Entity, source: Entity, keepDeadHpZero = false): void {
    const sourceHero = source.kind === 'hero' ? source : null;
    if (target.kind === 'hero') {
      this.state.stats.heroKills[otherTeam(target.team)] += 1;
      if (sourceHero) {
        sourceHero.kills += 1;
        sourceHero.gold += 280 + target.level * 20;
        this.grantXp(sourceHero, 160 + target.level * 12, keepDeadHpZero);
      } else {
        for (const hero of this.heroesOfTeam(otherTeam(target.team))) {
          hero.gold += 150;
          this.grantXp(hero, 100, keepDeadHpZero);
        }
      }
      return;
    }

    if (target.kind === 'minion') {
      const def = this.catalog.minions[target.minionKind];
      if (sourceHero) {
        sourceHero.gold += def.bountyGold;
        this.grantXp(sourceHero, def.bountyXp, keepDeadHpZero);
        this.grantNearbyXp(target, sourceHero, def.bountyXp * 0.5);
      } else {
        this.grantNearbyXp(target, null, def.bountyXp);
      }
      return;
    }

    if (target.kind === 'structure') {
      const def = this.structureDefinition(target.definitionId);
      if (sourceHero) {
        sourceHero.gold += def.bountyGold;
        this.grantXp(sourceHero, def.bountyXp, keepDeadHpZero);
      }
      for (const hero of this.heroesOfTeam(otherTeam(target.team))) {
        if (hero !== sourceHero) {
          hero.gold += 60;
          this.grantXp(hero, 60, keepDeadHpZero);
        }
      }
    }
  }

  private grantNearbyXp(dead: Entity, exclude: HeroEntity | null, amount: number): void {
    if (amount <= 0) {
      return;
    }
    for (const hero of this.heroesOfTeam(otherTeam(dead.team))) {
      if (hero === exclude || !hero.alive) {
        continue;
      }
      if (distance(hero.position, dead.position) <= this.catalog.rules.heroXpAuraRange) {
        this.grantXp(hero, amount);
      }
    }
  }

  private grantXp(hero: HeroEntity, amount: number, keepDeadHpZero = false): void {
    hero.xp += amount;
    while (hero.level < this.catalog.rules.xpLevels.length) {
      const nextThreshold = this.catalog.rules.xpLevels[hero.level];
      if (nextThreshold === undefined || hero.xp < nextThreshold) {
        break;
      }
      const oldStats = hero.stats;
      hero.level += 1;
      const nextStats = this.computeHeroStats(hero.definitionId, hero.level, hero.items);
      hero.stats = nextStats;
      hero.maxHp = nextStats.maxHp;
      if (!keepDeadHpZero || hero.alive) hero.hp = Math.min(nextStats.maxHp, hero.hp + (nextStats.maxHp - oldStats.maxHp));
      hero.mana = Math.min(nextStats.maxMana, hero.mana + (nextStats.maxMana - oldStats.maxMana));
      hero.armor = nextStats.armor;
      hero.magicResist = nextStats.magicResist;
    }
  }

  private updateUnits(): void {
    if (this.catalog.rules.stagedUnitPhase) { this.updateUnitsStaged(); return; }
    for (const entity of this.state.entities) {
      if (!entity.alive || entity.kind === 'structure') {
        continue;
      }
      this.cleanupStatuses(entity);
      entity.attackCooldown = Math.max(0, entity.attackCooldown - 1);

      if (this.isStunned(entity)) {
        continue;
      }
      if (entity.kind === 'hero' && entity.cast) {
        continue;
      }

      if (entity.kind === 'minion' && this.state.tick >= entity.targetRefreshTick) {
        this.refreshMinionTarget(entity);
        entity.targetRefreshTick = this.state.tick + 6;
      }

      if (entity.kind === 'hero' && entity.attackMoveGoal) this.updateAttackMove(entity);
      this.validateTarget(entity);
      const target = entity.targetId === null ? null : this.getEntityById(entity.targetId);
      if (target && target.alive) {
        const range = this.attackRange(entity);
        const reachable = range + target.radius;
        if (distance(entity.position, target.position) <= reachable) {
          entity.path = [];
          entity.pathIndex = 0;
          entity.facing = normalize(sub(target.position, entity.position));
          if (entity.attackCooldown <= 0) {
            this.basicAttack(entity, target);
          }
          continue;
        }
        if (entity.kind === 'hero') {
          this.ensureChasePath(entity, target.position);
        } else {
          this.ensureChasePath(entity, target.position);
        }
        this.moveAlongPath(entity);
        continue;
      }

      if (entity.kind === 'minion') {
        const objective = this.minionObjective(entity);
        if (objective) {
          if (distance(entity.position, objective.position) <= this.attackRange(entity) + objective.radius) {
            entity.targetId = objective.id;
            continue;
          }
          this.ensureChasePath(entity, objective.position);
        }
      }

      if (entity.moveGoal && entity.pathIndex >= entity.path.length) {
        entity.moveGoal = null;
      }
      if (entity.pathIndex < entity.path.length) {
        this.moveAlongPath(entity);
      } else if (entity.kind === 'hero' && entity.moveGoal) {
        this.ensureChasePath(entity, entity.moveGoal);
        this.moveAlongPath(entity);
      }
    }
  }

  private unitPhaseCopy(entity: Entity): Entity {
    // Only these nested values can be changed by planning; paths/statuses are replaced,
    // not edited, and no rewards or commands run until every plan has been collected.
    return { ...entity, position: copyVec(entity.position), facing: copyVec(entity.facing) };
  }

  private updateUnitsStaged(): void {
    const readEntities = this.state.entities.map(entity => this.unitPhaseCopy(entity)).sort((a, b) => a.id - b.id);
    const readById = new Map(readEntities.map(entity => [entity.id, entity]));
    const liveById = new Map(this.state.entities.map(entity => [entity.id, entity]));
    const attacks: UnitAttackIntent[] = [];
    // Planning order deliberately follows storage order; eligibility only reads the
    // canonical entry snapshot, so reversing this order must not change the result.
    const plans: Entity[] = [];
    for (const live of this.state.entities) {
      if (!live.alive || live.kind === 'structure') continue;
      const planned = this.unitPhaseCopy(readById.get(live.id)!);
      this.planUnitPhase(planned, readEntities, readById, attacks);
      plans.push(planned);
    }
    for (const planned of plans) {
      const live = liveById.get(planned.id)!;
      Object.assign(live, planned);
      // Object.assign does not propagate deletion of an optional order field.
      if (live.kind === 'hero' && planned.kind === 'hero' && !planned.attackMoveGoal) delete live.attackMoveGoal;
    }

    const damage = new Map<number, { hp: number; shield: number; killerId: number | null }>();
    // A target's contenders are enemies from one team: this preserves stable
    // effective-hit crossing-zero credit, not a largest-contribution economy.
    attacks.sort((a, b) => a.sourceId - b.sourceId || a.targetId - b.targetId);
    for (const attack of attacks) {
      const source = liveById.get(attack.sourceId)!;
      this.emit({ type: 'basicAttack', sourceId: attack.sourceId, targetId: attack.targetId });
      const target = readById.get(attack.targetId)!;
      if (!target.alive || (target.kind === 'structure' && target.invulnerable) || attack.damage <= 0) continue;
      let tally = damage.get(target.id);
      if (!tally) {
        tally = { hp: target.hp, shield: target.kind === 'hero' && target.shieldExpiresTick > this.state.tick ? target.shield : 0, killerId: null };
        damage.set(target.id, tally);
      }
      // All committed swings consume cooldown, but later impacts on an already
      // lethally damaged target do not add corpse damage or replace the last hit.
      if (tally.hp <= 0) continue;
      const mitigated = attack.damage * (100 / (100 + Math.max(0, target.armor)));
      this.state.stats.damageByTeam[source.team] += mitigated;
      if (source.kind === 'hero') {
        this.state.stats.basicAttackDamage += mitigated;
        if (target.kind === 'hero') this.state.stats.basicAttackHeroDamage += mitigated;
      }
      const absorbed = Math.min(tally.shield, mitigated);
      if (target.kind === 'hero') this.emit({ type: 'heroDamaged', targetId: target.id, sourceId: source.id, hpDamage: Math.min(tally.hp, mitigated - absorbed), shieldAbsorbed: absorbed, abilityId: null });
      tally.shield -= absorbed;
      tally.hp -= mitigated - absorbed;
      if (tally.hp <= 0) tally.killerId = source.id;
      const liveTarget = liveById.get(target.id)!;
      if (source.kind === 'hero' && liveTarget.kind === 'hero') this.notifyTowerAggro(source, liveTarget);
    }
    const deaths: { live: Entity; rewardTarget: Entity; source: Entity }[] = [];
    for (const [id, tally] of [...damage].sort(([a], [b]) => a - b)) {
      const live = liveById.get(id)!;
      live.hp = tally.hp;
      if (live.kind === 'hero') live.shield = tally.shield;
      if (tally.killerId !== null) {
        // Freeze victim level/bounty data before any kill reward can level another
        // victim. XP-aura positions are sampled after the common movement commit.
        deaths.push({ live, rewardTarget: { ...readById.get(id)!, position: copyVec(live.position) }, source: liveById.get(tally.killerId)! });
      }
    }
    for (const death of deaths) this.markDeath(death.live);
    for (const death of deaths) this.awardDeathRewards(death.rewardTarget, death.source, true);
  }

  private planUnitPhase(entity: Entity, readEntities: readonly Entity[], readById: ReadonlyMap<number, Entity>, attacks: UnitAttackIntent[]): void {
      if (!entity.alive || entity.kind === 'structure') {
        return;
      }
      this.cleanupStatuses(entity);
      entity.attackCooldown = Math.max(0, entity.attackCooldown - 1);

      if (this.isStunned(entity)) {
        return;
      }
      if (entity.kind === 'hero' && entity.cast) {
        return;
      }

      if (entity.kind === 'minion' && this.state.tick >= entity.targetRefreshTick) {
        this.refreshMinionTarget(entity, readEntities);
        entity.targetRefreshTick = this.state.tick + 6;
      }

      if (entity.kind === 'hero' && entity.attackMoveGoal) {
        this.updateAttackMove(entity, readEntities);
      }

      this.validateTarget(entity, readEntities);
      const target = entity.targetId === null ? null : readById.get(entity.targetId) ?? null;
      if (target && target.alive) {
        const range = this.attackRange(entity);
        const reachable = range + target.radius;
        if (distance(entity.position, target.position) <= reachable) {
          entity.path = [];
          entity.pathIndex = 0;
          entity.facing = normalize(sub(target.position, entity.position));
          if (entity.attackCooldown <= 0) {
            attacks.push({ sourceId: entity.id, targetId: target.id, damage: this.basicAttackDamage(entity, target) });
            entity.attackCooldown = this.basicAttackIntervalTicks(entity);
          }
          return;
        }
        if (entity.kind === 'hero') {
          this.ensureChasePath(entity, target.position);
        } else {
          this.ensureChasePath(entity, target.position);
        }
        this.moveAlongPath(entity);
        return;
      }

      if (entity.kind === 'minion') {
        const objective = this.minionObjective(entity, readEntities);
        if (objective) {
          if (distance(entity.position, objective.position) <= this.attackRange(entity) + objective.radius) {
            entity.targetId = objective.id;
            return;
          }
          this.ensureChasePath(entity, objective.position);
        }
      }

      if (entity.moveGoal && entity.pathIndex >= entity.path.length) {
        entity.moveGoal = null;
      }
      if (entity.pathIndex < entity.path.length) {
        this.moveAlongPath(entity);
      } else if (entity.kind === 'hero' && entity.moveGoal) {
        this.ensureChasePath(entity, entity.moveGoal);
        this.moveAlongPath(entity);
      }
  }

  private updateAttackMove(hero: HeroEntity, readEntities: readonly Entity[] = this.state.entities): void {
    const goal = hero.attackMoveGoal;
    if (!goal) return;
    const acquireRange = hero.stats.attackRange + 2;
    let nearest: Entity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of readEntities) {
      if (!candidate.alive || candidate.team === hero.team ||
          (candidate.kind === 'structure' && candidate.invulnerable)) continue;
      const d = distance(hero.position, candidate.position);
      if (d <= acquireRange + candidate.radius &&
          (d < bestDistance || (d === bestDistance && candidate.id < (nearest?.id ?? Infinity)))) {
        nearest = candidate;
        bestDistance = d;
      }
    }
    hero.targetId = nearest?.id ?? null;
    if (nearest) return;
    if (distance(hero.position, goal) <= 0.15) {
      delete hero.attackMoveGoal;
      hero.moveGoal = null;
      hero.path = [];
      hero.pathIndex = 0;
      return;
    }
    this.ensureChasePath(hero, goal);
  }

  private refreshMinionTarget(minion: MinionEntity, readEntities: readonly Entity[] = this.state.entities): void {
    let best: Entity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const aggroRange = this.catalog.rules.minionAggroRange;
    for (const entity of readEntities) {
      if (
        !entity.alive ||
        entity.team === minion.team ||
        (entity.kind === 'structure' && entity.invulnerable)
      ) {
        continue;
      }
      const dist = distance(minion.position, entity.position);
      if (dist <= aggroRange + entity.radius && dist < bestDistance) {
        best = entity;
        bestDistance = dist;
      }
    }
    if (best) {
      minion.targetId = best.id;
      return;
    }
    const objective = this.minionObjective(minion, readEntities);
    if (objective && distance(minion.position, objective.position) <= this.attackRange(minion) + objective.radius) {
      minion.targetId = objective.id;
    }
  }

  private minionObjective(minion: MinionEntity, readEntities: readonly Entity[] = this.state.entities): StructureEntity | null {
    for (const id of this.catalog.map.pushOrder[minion.team]) {
      const entity = readEntities.find(
        (candidate): candidate is StructureEntity =>
          candidate.kind === 'structure' && candidate.definitionId === id,
      );
      if (!entity || !entity.alive || entity.invulnerable) {
        continue;
      }
      return entity;
    }
    return null;
  }

  private updateStructures(): void {
    for (const entity of this.state.entities) {
      if (!entity.alive || entity.kind !== 'structure' || entity.attackRange <= 0) {
        continue;
      }
      entity.attackCooldown = Math.max(0, entity.attackCooldown - 1);
      if (this.state.tick >= entity.targetRefreshTick) {
        this.refreshStructureTarget(entity);
        entity.targetRefreshTick = this.state.tick + this.catalog.rules.structureTargetingIntervalTicks;
      }
      const target = entity.targetId === null ? null : this.getEntityById(entity.targetId);
      if (!target || !target.alive) {
        entity.targetId = null;
        continue;
      }
        if (distance(entity.position, target.position) <= entity.attackRange + target.radius) {
          entity.facing = normalize(sub(target.position, entity.position));
          if (entity.attackCooldown <= 0) {
            this.emit({ type: 'basicAttack', sourceId: entity.id, targetId: target.id });
            this.dealDamage(entity, target, entity.attackDamage, 'physical', null);
            entity.attackCooldown = Math.max(1, Math.ceil(entity.attackInterval * this.tickRate));
          }
        }
    }
  }

  private refreshStructureTarget(structure: StructureEntity): void {
    if (structure.aggroHeroId !== null) {
      if (this.state.tick > structure.aggroUntilTick) {
        structure.aggroHeroId = null;
      } else {
        const hero = this.getEntityById(structure.aggroHeroId);
        if (
          hero &&
          hero.alive &&
          hero.kind === 'hero' &&
          distance(structure.position, hero.position) <= structure.attackRange + hero.radius
        ) {
          structure.targetId = hero.id;
          return;
        }
        structure.aggroHeroId = null;
      }
    }

    let bestMinion: Entity | null = null;
    let bestMinionDistance = Number.POSITIVE_INFINITY;
    let bestHero: Entity | null = null;
    let bestHeroDistance = Number.POSITIVE_INFINITY;
    for (const entity of this.state.entities) {
      if (
        !entity.alive ||
        entity.team === structure.team ||
        entity.kind === 'structure' ||
        distance(structure.position, entity.position) > structure.attackRange + entity.radius
      ) {
        continue;
      }
      const dist = distance(structure.position, entity.position);
      if (entity.kind === 'minion' && dist < bestMinionDistance) {
        bestMinion = entity;
        bestMinionDistance = dist;
      } else if (entity.kind === 'hero' && dist < bestHeroDistance) {
        bestHero = entity;
        bestHeroDistance = dist;
      }
    }
    structure.targetId = (bestMinion ?? bestHero)?.id ?? null;
  }

  private validateTarget(entity: Entity, readEntities: readonly Entity[] = this.state.entities): void {
    if (entity.targetId === null) {
      return;
    }
    const target = readEntities.find(candidate => candidate.id === entity.targetId);
    if (
      !target ||
      !target.alive ||
      target.team === entity.team ||
      (target.kind === 'structure' && target.invulnerable)
    ) {
      entity.targetId = null;
    }
  }

  private basicAttack(source: Entity, target: Entity): void {
    if (source.kind === 'structure') return;
    this.emit({ type: 'basicAttack', sourceId: source.id, targetId: target.id });
    this.dealDamage(source, target, this.basicAttackDamage(source, target), 'physical', null);
    source.attackCooldown = this.basicAttackIntervalTicks(source);
  }

  private basicAttackDamage(source: Entity, target: Entity): number {
    return source.kind === 'hero'
        ? source.stats.attackDamage
        : source.kind === 'minion'
          ? this.catalog.minions[source.minionKind].attackDamage *
            (1 + this.catalog.rules.minionDamagePerWave * (source.wave - 1)) *
            (target.kind === 'structure'
              ? this.catalog.minions[source.minionKind].structureDamageMultiplier
              : 1)
          : 0;
  }

  private basicAttackIntervalTicks(source: HeroEntity | MinionEntity): number {
    const interval =
      source.kind === 'hero'
        ? source.stats.attackInterval
        : this.catalog.minions[source.minionKind].attackInterval;
    return Math.max(1, Math.ceil(interval * this.tickRate));
  }

  private attackRange(entity: Entity): number {
    if (entity.kind === 'hero') {
      return entity.stats.attackRange;
    }
    if (entity.kind === 'minion') {
      return this.catalog.minions[entity.minionKind].attackRange;
    }
    return entity.attackRange;
  }

  private ensureChasePath(entity: Entity, goal: Vec2): void {
    if (entity.kind === 'structure') {
      return;
    }
    const needsNew =
      !entity.moveGoal ||
      distance(entity.moveGoal, goal) > 1.25 ||
      this.state.tick - entity.pathRefreshTick >= 18 ||
      entity.pathIndex >= entity.path.length;
    if (!needsNew) {
      return;
    }
    const path = this.navigation.findPath(entity.position, goal);
    if (!path.success) {
      this.state.diagnostics.pathFailures += 1;
      entity.moveGoal = null;
      entity.path = [];
      entity.pathIndex = 0;
      return;
    }
    entity.moveGoal = copyVec(goal);
    entity.path = path.points;
    entity.pathIndex = 0;
    entity.pathRefreshTick = this.state.tick;
  }

  private moveAlongPath(entity: Entity): void {
    if (entity.kind === 'structure' || entity.pathIndex >= entity.path.length) {
      return;
    }
    const speed = this.effectiveMoveSpeed(entity);
    let remaining = speed * this.dt;
    while (remaining > 0 && entity.pathIndex < entity.path.length) {
      const waypoint = entity.path[entity.pathIndex];
      if (!waypoint) {
        break;
      }
      const dist = distance(entity.position, waypoint);
      if (dist <= 0.001) {
        entity.pathIndex += 1;
        continue;
      }
      if (dist <= remaining) {
        entity.facing = normalize(sub(waypoint, entity.position));
        entity.position = copyVec(waypoint);
        entity.pathIndex += 1;
        remaining -= dist;
      } else {
        entity.facing = normalize(sub(waypoint, entity.position));
        entity.position = add(entity.position, scale(entity.facing, remaining));
        remaining = 0;
      }
    }
    if (entity.pathIndex >= entity.path.length && entity.targetId === null) {
      entity.moveGoal = null;
    }
  }

  private effectiveMoveSpeed(entity: Entity): number {
    if (entity.kind === 'structure') {
      return 0;
    }
    const base =
      entity.kind === 'hero'
        ? entity.stats.moveSpeed
        : this.catalog.minions[entity.minionKind].moveSpeed;
    const slow = this.slowPercent(entity);
    let speedBonus = 0;
    for (const status of entity.statuses) {
      if (status.kind === 'speed' && status.expiresTick > this.state.tick) {
        speedBonus = Math.max(speedBonus, status.percent);
      }
    }
    return base * Math.max(0.1, (1 - slow) * (1 + speedBonus));
  }

  private addStatus(entity: HeroEntity | MinionEntity, status: ActiveStatus): void {
    const existing = entity.statuses.find(
      (candidate) => candidate.kind === status.kind && candidate.sourceId === status.sourceId,
    );
    if (existing) {
      existing.expiresTick = Math.max(existing.expiresTick, status.expiresTick);
      existing.percent = Math.max(existing.percent, status.percent);
      return;
    }
    entity.statuses.push(status);
  }

  private cleanupStatuses(entity: HeroEntity | MinionEntity): void {
    entity.statuses = entity.statuses.filter((status) => status.expiresTick > this.state.tick);
    if (entity.kind === 'hero' && entity.shieldExpiresTick <= this.state.tick) {
      entity.shield = 0;
    }
  }

  private isStunned(entity: HeroEntity | MinionEntity): boolean {
    return entity.statuses.some(
      (status) => status.kind === 'stun' && status.expiresTick > this.state.tick,
    );
  }

  private slowPercent(entity: HeroEntity | MinionEntity): number {
    let slow = 0;
    for (const status of entity.statuses) {
      if (status.kind === 'slow' && status.expiresTick > this.state.tick) {
        slow = Math.max(slow, status.percent);
      }
    }
    return slow;
  }

  private updateRespawns(): void {
    for (const entity of this.state.entities) {
      if (
        entity.kind !== 'hero' ||
        entity.alive ||
        this.state.tick < entity.respawnAtTick
      ) {
        continue;
      }
      const spawn =
        this.catalog.map.heroSpawns[entity.team][entity.slotIndex] ??
        this.catalog.map.heroSpawns[entity.team][0] ?? { x: 0, z: 0 };
      entity.alive = true;
      entity.position = this.navigation.closestPoint(spawn) ?? copyVec(spawn);
      entity.facing = { x: entity.team === 0 ? 1 : -1, z: 0 };
      entity.hp = entity.stats.maxHp;
      entity.mana = entity.stats.maxMana;
      entity.shield = 0;
      entity.shieldExpiresTick = 0;
      entity.statuses = [];
      delete entity.attackMoveGoal;
      entity.targetId = null;
      entity.moveGoal = null;
      entity.path = [];
      entity.pathIndex = 0;
      entity.cast = null;
    }
  }

  private updateEconomy(): void {
    const goldPerTick = this.catalog.rules.passiveGoldPerSecond * this.dt;
    const xpPerTick = this.catalog.rules.passiveXpPerSecond * this.dt;
    for (const entity of this.state.entities) {
      if (entity.kind !== 'hero') {
        continue;
      }
      entity.gold += goldPerTick;
      if (entity.alive) {
        this.grantXp(entity, xpPerTick);
        entity.hp = Math.min(entity.stats.maxHp, entity.hp + entity.stats.hpRegen * this.dt);
        entity.mana = Math.min(entity.stats.maxMana, entity.mana + entity.stats.manaRegen * this.dt);
      }
      for (const slot of ALL_SLOTS) {
        entity.cooldowns[slot] = Math.max(0, entity.cooldowns[slot] - 1);
      }
    }
  }

  private updateWaves(): void {
    const waves = this.catalog.rules.waves;
    while (this.state.tick >= this.state.nextWaveTick && this.state.timeSeconds <= this.maxMatchSeconds) {
      this.state.waveNumber += 1;
      const wave = this.state.waveNumber;
      for (const team of [0, 1] as const) {
        const barracksId = `${team === 0 ? 'blue' : 'red'}-barracks`;
        const barracks = this.state.entities.find(
          (entity): entity is StructureEntity =>
            entity.kind === 'structure' && entity.definitionId === barracksId,
        );
        if (!barracks || !barracks.alive) {
          continue;
        }
        this.spawnWave(team, wave);
      }
      this.state.nextWaveTick += Math.max(1, Math.round(waves.interval * this.tickRate));
    }
  }

  private spawnWave(team: TeamId, wave: number): void {
    const waves = this.catalog.rules.waves;
    const spawn = this.catalog.map.minionSpawns[team];
    const kinds: ('melee' | 'ranged' | 'siege')[] = [];
    for (let i = 0; i < waves.meleeCount; i += 1) {
      kinds.push('melee');
    }
    for (let i = 0; i < waves.rangedCount; i += 1) {
      kinds.push('ranged');
    }
    if (wave >= waves.siegeStartWave && wave % waves.siegeEvery === 0) {
      kinds.push('siege');
    }
    kinds.forEach((kind, index) => {
      const def = this.catalog.minions[kind];
      const offset = waves.laneOffsets[index] ?? 0;
      const hpFactor = 1 + this.catalog.rules.minionHpPerWave * (wave - 1);
      const hp = def.maxHp * hpFactor;
      const minion: MinionEntity = {
        id: this.state.nextEntityId++,
        kind: 'minion',
        team,
        definitionId: def.kind,
        minionKind: kind,
        name: def.name,
        position: { x: spawn.x, z: clamp(spawn.z + offset, -5.5, 5.5) },
        facing: { x: team === 0 ? 1 : -1, z: 0 },
        radius: def.radius,
        hp,
        maxHp: hp,
        armor: def.armor,
        magicResist: def.magicResist,
        alive: true,
        targetId: null,
        moveGoal: null,
        path: [],
        pathIndex: 0,
        pathRefreshTick: 0,
        attackCooldown: 0,
        statuses: [],
        wave,
        targetRefreshTick: 0,
      };
      this.state.entities.push(minion);
    });
  }

  private recomputeStructureVulnerability(): void {
    for (const entity of this.state.entities) {
      if (entity.kind !== 'structure') {
        continue;
      }
      const def = this.structureDefinition(entity.definitionId);
      if (def.requiresDestroyed.length === 0) {
        entity.invulnerable = false;
        continue;
      }
      entity.invulnerable = def.requiresDestroyed.some((requiredId) => {
        const required = this.state.entities.find(
          (candidate): candidate is StructureEntity =>
            candidate.kind === 'structure' && candidate.definitionId === requiredId,
        );
        return !required || required.alive;
      });
    }
  }

  private cleanup(): void {
    const removedEntityIds: number[] = [];
    this.state.entities = this.state.entities.filter((entity) => {
      if (entity.kind === 'minion' && !entity.alive) {
        removedEntityIds.push(entity.id);
        return false;
      }
      return true;
    });
    for (const id of removedEntityIds) {
      this.stuckSince.delete(id);
    }
    this.state.projectiles = this.state.projectiles.filter((projectile) => projectile.alive);
  }

  private checkEndCondition(): void {
    if (this.state.status !== 'running') {
      return;
    }
    const blueBase = this.baseOfTeam(0);
    const redBase = this.baseOfTeam(1);
    const blueBaseDown = !blueBase || !blueBase.alive;
    const redBaseDown = !redBase || !redBase.alive;
    if (blueBaseDown || redBaseDown) {
      if (blueBaseDown && redBaseDown) {
        this.state.status = 'blueWin';
        this.state.winner = 0;
        this.state.endReason = 'mutualBaseDestruction';
      } else if (redBaseDown) {
        this.state.status = 'blueWin';
        this.state.winner = 0;
        this.state.endReason = 'redBaseDestroyed';
      } else {
        this.state.status = 'redWin';
        this.state.winner = 1;
        this.state.endReason = 'blueBaseDestroyed';
      }
      return;
    }
    if (this.state.timeSeconds >= this.maxMatchSeconds) {
      this.state.status = 'timeout';
      this.state.winner = null;
      this.state.endReason = 'maxMatchSeconds';
    }
  }

  private updateStuckDiagnostics(): void {
    for (const entity of this.state.entities) {
      if (!entity.alive || entity.kind === 'structure') {
        continue;
      }
      const wantsToMove = this.wantsToMove(entity);
      if (!wantsToMove) {
        this.stuckSince.delete(entity.id);
        continue;
      }
      const previous = this.stuckSince.get(entity.id);
      if (!previous) {
        this.stuckSince.set(entity.id, { x: entity.position.x, z: entity.position.z, tick: this.state.tick });
        continue;
      }
      if (distance(previous, entity.position) > 0.02) {
        this.stuckSince.set(entity.id, { x: entity.position.x, z: entity.position.z, tick: this.state.tick });
        continue;
      }
      if (this.state.tick - previous.tick >= 10 * this.tickRate) {
        this.state.diagnostics.stuckEvents.push({
          tick: this.state.tick,
          entityId: entity.id,
          entityName: entity.name,
          team: entity.team,
          position: copyVec(entity.position),
          secondsStationary: (this.state.tick - previous.tick) / this.tickRate,
        });
        previous.tick = this.state.tick;
      }
    }
  }

  private wantsToMove(entity: HeroEntity | MinionEntity): boolean {
    if (entity.kind === 'hero' && entity.cast) {
      return false;
    }
    if (this.isStunned(entity)) {
      return false;
    }
    if (entity.pathIndex < entity.path.length) {
      return true;
    }
    if (entity.targetId !== null) {
      const target = this.getEntityById(entity.targetId);
      if (target && target.alive) {
        return distance(entity.position, target.position) > this.attackRange(entity) + target.radius;
      }
    }
    return false;
  }

  private ensureAbilityStats(abilityId: string): AbilityStats {
    let stats = this.state.stats.abilities[abilityId];
    if (!stats) {
      stats = makeAbilityStats();
      this.state.stats.abilities[abilityId] = stats;
    }
    return stats;
  }

  private heroesOfTeam(team: TeamId): HeroEntity[] {
    return this.state.entities.filter(
      (entity): entity is HeroEntity => entity.kind === 'hero' && entity.team === team,
    );
  }

  private baseOfTeam(team: TeamId): StructureEntity | null {
    return (
      this.state.entities.find(
        (entity): entity is StructureEntity =>
          entity.kind === 'structure' &&
          entity.team === team &&
          entity.structureKind === 'base',
      ) ?? null
    );
  }

  private structureDefinition(id: string): StructureDefinition {
    const def = this.catalog.map.structures.find((candidate) => candidate.id === id);
    if (!def) {
      throw new Error(`unknown structure definition: ${id}`);
    }
    return def;
  }

  private clampToWorld(point: Vec2): Vec2 {
    return {
      x: clamp(point.x, this.catalog.map.world.minX, this.catalog.map.world.maxX),
      z: clamp(point.z, this.catalog.map.world.minZ, this.catalog.map.world.maxZ),
    };
  }

  nextRandom(): number {
    const value = this.rng.next();
    this.state.rngState = this.rng.state;
    return value;
  }
}

function normalizeHeroIds(
  requested: readonly string[] | undefined,
  heroesPerTeam: number,
  catalog: ContentCatalog,
  team: TeamId,
): readonly string[] {
  const result: string[] = [];
  for (let index = 0; index < heroesPerTeam; index += 1) {
    const id = requested?.[index] ?? catalog.defaultHeroId;
    if (!catalog.heroes[id]) {
      throw new Error(`content v${catalog.version} has no hero '${id}' (team ${team}, slot ${index})`);
    }
    result.push(id);
  }
  return result;
}
