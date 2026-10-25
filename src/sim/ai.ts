import type {
  AbilityDefinition,
  AbilitySlot,
  Difficulty,
  DifficultyTuning,
  Vec2,
} from '../content/types.js';
import { SeededRng } from './rng.js';
import type { Simulation } from './simulation.js';
import type { Entity, HeroEntity, MinionEntity, SimCommand, StructureEntity } from './types.js';
import { add, clamp, copyVec, distance, normalize, rotate, scale, sub } from './math.js';

type Intent = 'retreat' | 'fight' | 'farm' | 'push' | 'defend' | 'advance';

interface TrackedPosition {
  position: Vec2;
  velocity: Vec2;
  tick: number;
}

export interface HeroBotOptions {
  team: 0 | 1;
  slotIndex: number;
  difficulty: Difficulty;
  seed: number;
}

/**
 * Utility-driven bot. It observes the current simulation, chooses an intent,
 * then emits ordinary SimCommands. It never mutates state and never receives a
 * stat modifier from its difficulty: reaction delay, aim error, decision
 * cadence and noise are the only differences.
 */
export class HeroBot {
  readonly team: 0 | 1;
  readonly slotIndex: number;
  readonly difficulty: Difficulty;
  readonly tuning: DifficultyTuning;

  private readonly rng: SeededRng;
  private nextDecisionTick = 0;
  private intent: Intent = 'advance';
  private firstSeen = new Map<number, number>();
  private tracked = new Map<number, TrackedPosition>();

  constructor(options: HeroBotOptions) {
    this.team = options.team;
    this.slotIndex = options.slotIndex;
    this.difficulty = options.difficulty;
    this.rng = new SeededRng(options.seed);
    this.tuning = {
      reactionTicks: 0,
      decisionTicks: 0,
      aimErrorRadians: 0,
      aimErrorMeters: 0,
      decisionNoise: 0,
      castSkipChance: 0,
      comboChance: 0,
      mistakeChance: 0,
    };
  }

  think(sim: Simulation): SimCommand[] {
    const hero = sim.getHero(this.team, this.slotIndex);
    if (!hero || !hero.alive || sim.status !== 'running') {
      return [];
    }
    const tuning = sim.catalog.difficulty[this.difficulty];
    Object.assign(this.tuning, tuning);
    const tick = sim.state.tick;
    const commands: SimCommand[] = [];

    const buy = this.itemCommand(sim, hero);
    if (buy) {
      commands.push(buy);
    }

    if (hero.cast || this.isStunned(hero)) {
      return commands;
    }

    this.observeEnemies(sim, tick);

    if (tick < this.nextDecisionTick) {
      return commands;
    }
    this.nextDecisionTick = tick + Math.max(1, tuning.decisionTicks);
    if (this.rng.next() < tuning.mistakeChance) {
      const choices: Intent[] = ['retreat', 'fight', 'farm', 'push', 'defend', 'advance'];
      this.intent = this.rng.pick(choices);
    } else {
      this.intent = this.chooseIntent(sim, hero, tick);
    }

    switch (this.intent) {
      case 'retreat':
        commands.push(...this.retreat(sim, hero));
        break;
      case 'fight':
        commands.push(...this.fight(sim, hero));
        break;
      case 'farm':
        commands.push(...this.farm(sim, hero));
        break;
      case 'push':
        commands.push(...this.push(sim, hero));
        break;
      case 'defend':
        commands.push(...this.defend(sim, hero));
        break;
      case 'advance':
        commands.push(...this.advance(sim, hero));
        break;
      default: {
        const exhaustive: never = this.intent;
        throw new Error(`unhandled intent ${String(exhaustive)}`);
      }
    }
    return commands;
  }

  private itemCommand(sim: Simulation, hero: HeroEntity): SimCommand | null {
    const definition = sim.catalog.heroes[hero.definitionId];
    if (!definition) {
      return null;
    }
    for (const itemId of definition.itemBuild) {
      if (hero.items.includes(itemId)) {
        continue;
      }
      const item = sim.catalog.items[itemId];
      if (item && hero.gold >= item.cost) {
        return { type: 'buyItem', heroId: hero.id, itemId };
      }
    }
    return null;
  }

  private observeEnemies(sim: Simulation, tick: number): void {
    const ownHero = sim.getHero(this.team, this.slotIndex);
    if (!ownHero) {
      return;
    }
    const seen = new Set<number>();
    for (const entity of sim.state.entities) {
      if (!entity.alive || entity.team === this.team || entity.kind === 'structure') {
        continue;
      }
      seen.add(entity.id);
      if (entity.kind === 'hero') {
        if (distance(entity.position, ownHero.position) <= 16) {
          if (!this.firstSeen.has(entity.id)) {
            this.firstSeen.set(entity.id, tick);
          }
        } else if (tick - (this.firstSeen.get(entity.id) ?? tick) > 90) {
          this.firstSeen.delete(entity.id);
        }
      }
      const previous = this.tracked.get(entity.id);
      let velocity: Vec2 = { x: 0, z: 0 };
      if (previous && tick > previous.tick) {
        const dt = (tick - previous.tick) / sim.catalog.rules.tickRate;
        if (dt > 0) {
          velocity = scale(sub(entity.position, previous.position), 1 / dt);
          if (Math.hypot(velocity.x, velocity.z) > 30) {
            velocity = { x: 0, z: 0 };
          }
        }
      }
      this.tracked.set(entity.id, { position: copyVec(entity.position), velocity, tick });
    }
    for (const id of this.tracked.keys()) {
      if (!seen.has(id)) {
        this.tracked.delete(id);
      }
    }
  }

  private chooseIntent(sim: Simulation, hero: HeroEntity, tick: number): Intent {
    const tuning = sim.catalog.difficulty[this.difficulty];
    const hpRatio = hero.hp / hero.stats.maxHp;
    const enemyHeroes = this.enemyHeroes(sim, 17);
    const readyHeroes = enemyHeroes.filter((enemy) => this.isReactionReady(enemy.id, tick));
    const enemyMinions = this.enemyMinions(sim, 13);
    const ownMinions = this.ownMinions(sim, 14);
    const nextStructure = this.nextEnemyStructure(sim);
    const ownThreat = this.threatenedOwnStructure(sim);
    const nearOwnTower = this.nearFriendlyTower(sim, hero.position);
    const nearEnemyTower = this.nearEnemyTower(sim, hero.position);
    const alliedMinionsNearStructure = nextStructure
      ? this.ownMinions(sim, 13, nextStructure.position).length
      : 0;

    const averageEnemyHp =
      enemyHeroes.length > 0
        ? enemyHeroes.reduce((sum, enemy) => sum + enemy.hp / enemy.stats.maxHp, 0) / enemyHeroes.length
        : 1;

    let retreat =
      (hpRatio < 0.58 ? (0.58 - hpRatio) * 5.5 : 0) +
      (enemyHeroes.length > 0 ? 0.75 : 0) +
      (hpRatio < 0.3 ? 1.8 : 0) -
      Math.min(0.5, ownMinions.length * 0.08) -
      (nearOwnTower ? 0.45 : 0);
    let fight =
      readyHeroes.length > 0
        ? 1.55 +
          (hpRatio - averageEnemyHp) * 0.9 +
          (ownMinions.length - enemyMinions.length) * 0.045 +
          (nearOwnTower ? 0.35 : 0) -
          (nearEnemyTower ? 0.85 : 0)
        : -2;
    const farm = enemyMinions.length > 0 ? 0.95 + (enemyHeroes.length === 0 ? 0.35 : 0) : -0.4;
    const push =
      nextStructure && nextStructure.kind === 'structure'
        ? 0.72 +
          Math.min(1, alliedMinionsNearStructure * 0.12) +
          (enemyHeroes.length === 0 ? 0.55 : 0) -
          (nearEnemyTower ? 0.3 : 0)
        : -1;
    const defend = ownThreat ? 1.1 + (hpRatio > 0.35 ? 0.25 : -0.3) : -0.5;
    const advance = 0.48;

    const scores: Record<Intent, number> = { retreat, fight, farm, push, defend, advance };
    for (const key of Object.keys(scores) as Intent[]) {
      scores[key] += (this.rng.next() * 2 - 1) * tuning.decisionNoise;
    }

    if (hpRatio < 0.22 && enemyHeroes.some((enemy) => distance(enemy.position, hero.position) < 11)) {
      return 'retreat';
    }

    let best: Intent = 'advance';
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const key of Object.keys(scores) as Intent[]) {
      if (scores[key] > bestScore) {
        best = key;
        bestScore = scores[key];
      }
    }
    return best;
  }

  private retreat(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const commands: SimCommand[] = [];
    const threats = this.enemyHeroes(sim, 14);
    const nearest = threats.sort((a, b) => distance(a.position, hero.position) - distance(b.position, hero.position))[0];
    if (nearest) {
      const away = normalize(sub(hero.position, nearest.position));
      const q = this.ability(sim, hero, 'Q');
      const w = this.ability(sim, hero, 'W');
      if (q && this.canUse(hero, q) && nearest.hp / nearest.stats.maxHp < 0.55) {
        const cast =
          q.targetType === 'enemyUnit'
            ? this.castAtUnit(hero, q, nearest)
            : this.castAtDirection(sim, hero, q, nearest);
        if (cast) {
          commands.push(cast);
        }
      }
      if (commands.length === 0 && w && this.canUse(hero, w) && distance(hero.position, nearest.position) < 9) {
        commands.push({
          type: 'cast',
          heroId: hero.id,
          slot: 'W',
          targetId: null,
          direction: w.targetType === 'direction' ? away : null,
          point: null,
        });
      }
    }
    const base = this.ownBase(sim);
    const goal = base
      ? add(base.position, { x: hero.team === 0 ? 12 : -12, z: 0 })
      : { x: hero.team === 0 ? -90 : 90, z: 0 };
    commands.push({ type: 'move', heroId: hero.id, point: goal });
    return commands;
  }

  private fight(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const tick = sim.state.tick;
    const enemies = this.enemyHeroes(sim, 18).filter((enemy) => this.isReactionReady(enemy.id, tick));
    if (enemies.length === 0) {
      return this.farm(sim, hero);
    }
    const target = enemies.sort((a, b) => {
      const scoreA = distance(hero.position, a.position) + (a.hp / a.stats.maxHp) * 4;
      const scoreB = distance(hero.position, b.position) + (b.hp / b.stats.maxHp) * 4;
      return scoreA - scoreB;
    })[0];
    if (!target) {
      return this.advance(sim, hero);
    }
    return this.engageHero(sim, hero, target);
  }

  private engageHero(sim: Simulation, hero: HeroEntity, target: HeroEntity): SimCommand[] {
    const commands: SimCommand[] = [];
    const tuning = sim.catalog.difficulty[this.difficulty];
    const dist = distance(hero.position, target.position);
    const q = this.ability(sim, hero, 'Q');
    const w = this.ability(sim, hero, 'W');
    const e = this.ability(sim, hero, 'E');
    const r = this.ability(sim, hero, 'R');
    const targetHpRatio = target.hp / target.stats.maxHp;
    const heroHpRatio = hero.hp / hero.stats.maxHp;
    let cast: SimCommand | null = null;

    if (r && this.canUse(hero, r) && dist <= r.range && (targetHpRatio < 0.72 || heroHpRatio < 0.62)) {
      if (this.rng.next() < tuning.comboChance) {
        cast = this.castAtPoint(sim, hero, r, target);
      }
    }

    if (
      !cast &&
      e &&
      this.canUse(hero, e) &&
      dist <= e.range &&
      !this.hasOwnZoneNear(sim, hero, target.position)
    ) {
      if (this.rng.next() < tuning.comboChance) {
        cast = this.castAtPoint(sim, hero, e, target);
      }
    }

    if (!cast && q && this.canUse(hero, q) && dist <= q.range) {
      if (q.targetType === 'enemyUnit') {
        cast = this.castAtUnit(hero, q, target);
      } else if (this.rng.next() < tuning.comboChance) {
        cast = this.castAtDirection(sim, hero, q, target);
      }
    }

    if (!cast && w && this.canUse(hero, w)) {
      if (w.targetType === 'self') {
        if (heroHpRatio < 0.82 && hero.shield <= 0) {
          cast = { type: 'cast', heroId: hero.id, slot: 'W', targetId: null, direction: null, point: null };
        }
      } else if (dist > hero.stats.attackRange + 1.2 && dist < w.maxDistance + 3) {
        if (this.rng.next() < tuning.comboChance) {
          cast = {
            type: 'cast',
            heroId: hero.id,
            slot: 'W',
            targetId: null,
            direction: this.aimDirection(sim, hero, target, w),
            point: null,
          };
        }
      }
    }

    if (cast) {
      commands.push(cast);
    }

    if (dist <= 17) {
      commands.push({ type: 'attack', heroId: hero.id, targetId: target.id });
    } else {
      commands.push({ type: 'move', heroId: hero.id, point: target.position });
    }
    return commands;
  }

  private farm(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const minions = this.enemyMinions(sim, 12);
    if (minions.length === 0) {
      return this.advance(sim, hero);
    }
    const target = minions.sort((a, b) => {
      const lowHp = a.hp - b.hp;
      return lowHp !== 0 ? lowHp : distance(hero.position, a.position) - distance(hero.position, b.position);
    })[0];
    if (!target) {
      return this.advance(sim, hero);
    }
    const commands: SimCommand[] = [];
    const q = this.ability(sim, hero, 'Q');
    const e = this.ability(sim, hero, 'E');
    const nearby = minions.filter((minion) => distance(minion.position, target.position) < 3.5).length;
    if (e && this.canUse(hero, e) && nearby >= 2) {
      const cast = this.castAtPoint(sim, hero, e, target);
      if (cast) {
        commands.push(cast);
      }
    } else if (q && this.canUse(hero, q) && distance(hero.position, target.position) <= q.range) {
      const cast =
        q.targetType === 'enemyUnit'
          ? this.castAtUnit(hero, q, target)
          : this.castAtDirection(sim, hero, q, target);
      if (cast) {
        commands.push(cast);
      }
    }
    commands.push({ type: 'attack', heroId: hero.id, targetId: target.id });
    return commands;
  }

  private push(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const structure = this.nextEnemyStructure(sim);
    if (!structure) {
      return this.advance(sim, hero);
    }
    const danger = this.enemyHeroes(sim, 11);
    const allies = this.ownMinions(sim, 12, structure.position);
    if (allies.length === 0 && danger.length > 0 && structure.hp / structure.maxHp > 0.35) {
      return this.advance(sim, hero);
    }
    const commands: SimCommand[] = [];
    if (danger.length === 0) {
      const q = this.ability(sim, hero, 'Q');
      if (q && this.canUse(hero, q) && distance(hero.position, structure.position) <= q.range) {
        const cast =
          q.targetType === 'enemyUnit'
            ? this.castAtUnit(hero, q, structure)
            : this.castAtDirection(sim, hero, q, structure);
        if (cast) {
          commands.push(cast);
        }
      }
    }
    commands.push({ type: 'attack', heroId: hero.id, targetId: structure.id });
    return commands;
  }

  private defend(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const threat = this.threatenedOwnStructure(sim);
    const center = threat?.position ?? this.ownBase(sim)?.position ?? hero.position;
    const enemies = sim.state.entities.filter(
      (entity): entity is Entity =>
        entity.alive &&
        entity.team !== this.team &&
        entity.kind !== 'structure' &&
        distance(entity.position, center) <= 15,
    );
    if (enemies.length === 0) {
      return this.advance(sim, hero);
    }
    const target = enemies.sort(
      (a, b) => distance(a.position, hero.position) - distance(b.position, hero.position),
    )[0];
    if (!target) {
      return this.advance(sim, hero);
    }
    if (target.kind === 'hero') {
      return this.engageHero(sim, hero, target);
    }
    const commands: SimCommand[] = [{ type: 'attack', heroId: hero.id, targetId: target.id }];
    const e = this.ability(sim, hero, 'E');
    if (e && this.canUse(hero, e) && distance(hero.position, target.position) <= e.range) {
      const cast = this.castAtPoint(sim, hero, e, target);
      if (cast) {
        commands.unshift(cast);
      }
    }
    return commands;
  }

  private advance(sim: Simulation, hero: HeroEntity): SimCommand[] {
    const ownMinions = this.ownMinions(sim, 28);
    const nextStructure = this.nextEnemyStructure(sim);
    const commands: SimCommand[] = [];
    if (nextStructure && ownMinions.length === 0) {
      const safe = this.safePushPoint(sim, hero);
      commands.push({ type: 'move', heroId: hero.id, point: safe });
      return commands;
    }
    if (ownMinions.length > 0) {
      const front = ownMinions.sort((a, b) =>
        this.team === 0 ? b.position.x - a.position.x : a.position.x - b.position.x,
      )[0];
      if (front) {
        const behind = add(
          front.position,
          { x: this.team === 0 ? -2.2 : 2.2, z: clamp(-front.position.z * 0.1, -1.2, 1.2) },
        );
        commands.push({ type: 'move', heroId: hero.id, point: behind });
        return commands;
      }
    }
    commands.push({ type: 'move', heroId: hero.id, point: this.stagingPoint(sim, hero) });
    return commands;
  }

  private safePushPoint(sim: Simulation, hero: HeroEntity): Vec2 {
    const ownMinions = this.ownMinions(sim, 30);
    if (ownMinions.length > 0) {
      const front = ownMinions.sort((a, b) =>
        this.team === 0 ? b.position.x - a.position.x : a.position.x - b.position.x,
      )[0];
      if (front) {
        return add(front.position, { x: this.team === 0 ? -2.5 : 2.5, z: 0 });
      }
    }
    const ownTower = this.ownOuterTower(sim);
    if (ownTower) {
      return add(ownTower.position, { x: this.team === 0 ? -3 : 3, z: 0 });
    }
    return this.stagingPoint(sim, hero);
  }

  private stagingPoint(sim: Simulation, hero: HeroEntity): Vec2 {
    const base = this.ownBase(sim);
    if (base) {
      return add(base.position, { x: hero.team === 0 ? 12 : -12, z: 0 });
    }
    return { x: hero.team === 0 ? -85 : 85, z: 0 };
  }

  private castAtUnit(
    hero: HeroEntity,
    ability: AbilityDefinition,
    target: Entity,
  ): SimCommand | null {
    if (distance(hero.position, target.position) > ability.range + target.radius) {
      return null;
    }
    if (target.kind === 'structure' && target.invulnerable) {
      return null;
    }
    return {
      type: 'cast',
      heroId: hero.id,
      slot: ability.slot,
      targetId: target.id,
      direction: null,
      point: null,
    };
  }

  private castAtDirection(
    sim: Simulation,
    hero: HeroEntity,
    ability: AbilityDefinition,
    target: Entity,
  ): SimCommand | null {
    if (
      distance(hero.position, target.position) >
      Math.max(ability.range, ability.maxDistance) + target.radius
    ) {
      return null;
    }
    return {
      type: 'cast',
      heroId: hero.id,
      slot: ability.slot,
      targetId: null,
      direction: this.aimDirection(sim, hero, target, ability),
      point: null,
    };
  }

  private castAtPoint(
    sim: Simulation,
    hero: HeroEntity,
    ability: AbilityDefinition,
    target: Entity,
  ): SimCommand | null {
    const point = this.aimPoint(sim, hero, target, ability);
    if (!point) {
      return null;
    }
    if (distance(hero.position, point) > ability.range + 0.8) {
      return null;
    }
    return {
      type: 'cast',
      heroId: hero.id,
      slot: ability.slot,
      targetId: null,
      direction: null,
      point,
    };
  }

  private aimPoint(
    sim: Simulation,
    hero: HeroEntity,
    target: Entity,
    ability: AbilityDefinition,
  ): Vec2 | null {
    const tuning = sim.catalog.difficulty[this.difficulty];
    const travel = Math.max(0.1, ability.delay + ability.castTime + 0.15);
    const predicted = this.predict(target, travel);
    const dx = (this.rng.next() * 2 - 1) * tuning.aimErrorMeters;
    const dz = (this.rng.next() * 2 - 1) * tuning.aimErrorMeters;
    let point = add(predicted, { x: dx, z: dz });

    const dist = distance(hero.position, point);
    const maxRange = Math.max(0.5, ability.range - 0.15);
    if (dist > maxRange) {
      point = add(hero.position, scale(normalize(sub(point, hero.position)), maxRange));
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      return null;
    }
    return point;
  }

  private aimDirection(
    sim: Simulation,
    hero: HeroEntity,
    target: Entity,
    ability: AbilityDefinition,
  ): Vec2 {
    const tuning = sim.catalog.difficulty[this.difficulty];
    const travel = Math.max(0.05, ability.maxDistance / Math.max(1, ability.projectileSpeed) + ability.castTime);
    const predicted = this.predict(target, travel);
    const raw = normalize(sub(predicted, hero.position));
    const error = (this.rng.next() * 2 - 1) * tuning.aimErrorRadians;
    return rotate(raw, error);
  }

  private predict(target: Entity, seconds: number): Vec2 {
    if (target.kind === 'structure' || this.difficulty === 'low') {
      return copyVec(target.position);
    }
    const tracked = this.tracked.get(target.id);
    if (!tracked) {
      return copyVec(target.position);
    }
    const leadScale = this.difficulty === 'high' ? 1 : 0.6;
    return add(target.position, scale(tracked.velocity, seconds * leadScale));
  }

  private ability(sim: Simulation, hero: HeroEntity, slot: AbilitySlot): AbilityDefinition | null {
    const id = sim.catalog.heroes[hero.definitionId]?.abilities[slot];
    return id ? sim.catalog.abilities[id] ?? null : null;
  }

  private canUse(hero: HeroEntity, ability: AbilityDefinition): boolean {
    return hero.cooldowns[ability.slot] <= 0 && hero.mana >= ability.manaCost;
  }

  private isReactionReady(id: number, tick: number): boolean {
    const first = this.firstSeen.get(id);
    return first !== undefined && tick - first >= this.tuning.reactionTicks;
  }

  private isStunned(hero: HeroEntity): boolean {
    return hero.statuses.some((status) => status.kind === 'stun');
  }

  private hasOwnZoneNear(sim: Simulation, hero: HeroEntity, point: Vec2): boolean {
    return sim.state.zones.some(
      (zone) =>
        zone.sourceHeroId === hero.id && distance(zone.position, point) <= zone.radius + 0.6,
    );
  }

  private enemyHeroes(sim: Simulation, range: number): HeroEntity[] {
    const hero = sim.getHero(this.team, this.slotIndex);
    if (!hero) {
      return [];
    }
    return sim.state.entities.filter(
      (entity): entity is HeroEntity =>
        entity.kind === 'hero' &&
        entity.alive &&
        entity.team !== this.team &&
        distance(entity.position, hero.position) <= range,
    );
  }

  private enemyMinions(sim: Simulation, range: number): MinionEntity[] {
    const hero = sim.getHero(this.team, this.slotIndex);
    if (!hero) {
      return [];
    }
    return sim.state.entities.filter(
      (entity): entity is MinionEntity =>
        entity.kind === 'minion' &&
        entity.alive &&
        entity.team !== this.team &&
        distance(entity.position, hero.position) <= range,
    );
  }

  private ownMinions(sim: Simulation, range: number, around?: Vec2): MinionEntity[] {
    const hero = sim.getHero(this.team, this.slotIndex);
    if (!hero) {
      return [];
    }
    const center = around ?? hero.position;
    return sim.state.entities.filter(
      (entity): entity is MinionEntity =>
        entity.kind === 'minion' &&
        entity.alive &&
        entity.team === this.team &&
        distance(entity.position, center) <= range,
    );
  }

  private nextEnemyStructure(sim: Simulation): StructureEntity | null {
    for (const id of sim.catalog.map.pushOrder[this.team]) {
      const entity = sim.state.entities.find(
        (candidate): candidate is StructureEntity =>
          candidate.kind === 'structure' && candidate.definitionId === id,
      );
      if (entity && entity.alive && !entity.invulnerable) {
        return entity;
      }
    }
    return null;
  }

  private threatenedOwnStructure(sim: Simulation): StructureEntity | null {
    for (const entity of sim.state.entities) {
      if (!entity.alive || entity.kind !== 'structure' || entity.team !== this.team) {
        continue;
      }
      const threatened = sim.state.entities.some(
        (candidate) =>
          candidate.alive &&
          candidate.team !== this.team &&
          candidate.kind !== 'structure' &&
          distance(candidate.position, entity.position) <= 13,
      );
      if (threatened) {
        return entity;
      }
    }
    return null;
  }

  private ownBase(sim: Simulation): StructureEntity | null {
    return (
      sim.state.entities.find(
        (entity): entity is StructureEntity =>
          entity.kind === 'structure' &&
          entity.team === this.team &&
          entity.structureKind === 'base',
      ) ?? null
    );
  }

  private ownOuterTower(sim: Simulation): StructureEntity | null {
    const id = this.team === 0 ? 'blue-outer-tower' : 'red-outer-tower';
    return (
      sim.state.entities.find(
        (entity): entity is StructureEntity =>
          entity.kind === 'structure' && entity.definitionId === id,
      ) ?? null
    );
  }

  private nearFriendlyTower(sim: Simulation, point: Vec2): boolean {
    return sim.state.entities.some(
      (entity) =>
        entity.kind === 'structure' &&
        entity.alive &&
        entity.team === this.team &&
        entity.attackRange > 0 &&
        distance(entity.position, point) <= entity.attackRange + 1,
    );
  }

  private nearEnemyTower(sim: Simulation, point: Vec2): boolean {
    return sim.state.entities.some(
      (entity) =>
        entity.kind === 'structure' &&
        entity.alive &&
        entity.team !== this.team &&
        entity.attackRange > 0 &&
        distance(entity.position, point) <= entity.attackRange + 1.5,
    );
  }
}
