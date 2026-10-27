import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/sim/simulation.js';
import {replayMatch, runBotMatch} from '../src/sim/runner.js';
import type {Entity, MinionEntity, PresentationEvent, SimCommand, TimedCommand} from '../src/sim/types.js';
import {hero, makeSim, place, stepMany, structure, testNavigation} from './helpers.js';

type AttackHit = Extract<PresentationEvent, {type: 'basicAttackHit'}>;

async function arena() {
  const sim = await makeSim(11);
  const blue = hero(sim, 0), red = hero(sim, 1);
  place(blue, {x: 0, z: 0});
  place(red, {x: 5, z: 0});
  blue.stats.hpRegen = red.stats.hpRegen = 0;
  return {sim, blue, red};
}

function collectUntil(sim: Simulation, predicate: (events: readonly PresentationEvent[]) => boolean, maxTicks = 120) {
  const events: PresentationEvent[] = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    sim.step([]);
    events.push(...sim.snapshot().events);
    if (predicate(events)) return events;
  }
  throw new Error(`Expected attack event did not occur in ${maxTicks} ticks`);
}

function start(sim: Simulation, source: Entity, target: Entity) {
  expect(source.kind).toBe('hero');
  expect(sim.step([{type: 'attack', heroId: source.id, targetId: target.id}])[0]?.accepted).toBe(true);
  expect(source.basicAttack).toBeDefined();
  return {...source.basicAttack!};
}

function launch(sim: Simulation, source: Entity, target: Entity) {
  const attack = start(sim, source, target);
  const events = collectUntil(sim, batch => batch.some(e => e.type === 'basicAttack' && e.sourceId === source.id));
  const shot = events.find(e => e.type === 'basicAttack' && e.sourceId === source.id)!;
  expect(shot).toMatchObject({attackId: attack.id, delivery: 'projectile', targetId: target.id});
  expect(sim.state.projectiles.some(p => p.basicAttack?.targetId === target.id)).toBe(true);
  return {attack, events, shot};
}

function attackHits(events: readonly PresentationEvent[], sourceId: number): AttackHit[] {
  return events.filter((event): event is AttackHit => event.type === 'basicAttackHit' && event.sourceId === sourceId);
}

async function minionArena() {
  const sim = await makeSim(11);
  stepMany(sim, Math.ceil(sim.catalog.rules.waves.firstWaveTime * sim.tickRateHz) + 1);
  const minions = sim.state.entities.filter((e): e is MinionEntity => e.kind === 'minion');
  const blue = minions.find(e => e.team === 0 && e.minionKind === 'melee')!;
  const red = minions.find(e => e.team === 1 && e.minionKind === 'melee')!;
  sim.state.entities = sim.state.entities.filter(e => e.kind !== 'minion' || e.id === blue.id || e.id === red.id);
  place(blue, {x: 0, z: 0});
  place(red, {x: 1, z: 0});
  blue.targetId = red.id;
  red.targetId = blue.id;
  blue.targetRefreshTick = red.targetRefreshTick = 10000;
  blue.attackCooldown = red.attackCooldown = 0;
  return {sim, blue, red};
}

describe('v11 authoritative basic attack cycle', () => {
  it('prepares without damage, commits a projectile, and confirms damage only at contact', async () => {
    const {sim, blue, red} = await arena();
    const hp = red.hp, attack = start(sim, blue, red);
    expect(attack.windupTicks).toBeGreaterThan(0);
    expect(attack.commitTick).toBeGreaterThan(sim.state.tick);
    expect(red.hp).toBe(hp);
    expect(blue.attackCooldown).toBe(0);
    expect(sim.state.projectiles).toHaveLength(0);
    expect(sim.snapshot().events).toEqual([expect.objectContaining({
      type: 'castStarted', action: 'basicAttack', castId: attack.id,
      heroId: blue.id, targetId: red.id, slot: null, windupTicks: attack.windupTicks,
    })]);
    while (sim.state.tick < attack.commitTick - 1) {
      sim.step([]);
      expect(red.hp).toBe(hp);
      expect(sim.snapshot().events.some(e => e.type === 'basicAttack')).toBe(false);
    }
    sim.step([]);
    const submitted = sim.snapshot().events;
    expect(submitted).toEqual(expect.arrayContaining([
      expect.objectContaining({type: 'castResolved', action: 'basicAttack', castId: attack.id}),
      expect.objectContaining({type: 'basicAttack', attackId: attack.id, delivery: 'projectile'}),
    ]));
    expect(red.hp).toBe(hp);
    expect(attackHits(submitted, blue.id)).toHaveLength(0);
    expect(blue.basicAttack).toBeUndefined();
    expect(blue.attackCooldown).toBeGreaterThan(0);
    const submittedAt = sim.state.tick;
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    expect(attackHits(events, blue.id)).toHaveLength(1);
    expect(attackHits(events, blue.id)[0]).toMatchObject({attackId: attack.id, targetId: red.id, targetTeam: 1, shieldAbsorbed: 0});
    expect(attackHits(events, blue.id)[0]!.tick).toBeGreaterThan(submittedAt);
    expect(attackHits(events, blue.id)[0]!.hpDamage).toBeGreaterThan(0);
    expect(red.hp).toBeLessThan(hp);
  });

  for (const order of ['move', 'stop', 'cast'] as const) {
    it(`${order} accepted on the commit tick cancels preparation without spending the attack interval`, async () => {
      const {sim, blue, red} = await arena();
      const hp = red.hp, attack = start(sim, blue, red);
      while (sim.state.tick < attack.commitTick - 1) sim.step([]);
      const command: SimCommand = order === 'move'
        ? {type: 'move', heroId: blue.id, point: {x: -5, z: 0}}
        : order === 'stop' ? {type: 'stop', heroId: blue.id}
        : {type: 'cast', heroId: blue.id, slot: 'Q', direction: {x: 0, z: 1}, targetId: null, point: null};
      expect(sim.step([command])[0]?.accepted).toBe(true);
      const events = [...sim.snapshot().events];
      expect(events).toContainEqual(expect.objectContaining({type: 'castCancelled', action: 'basicAttack', castId: attack.id}));
      expect(blue.basicAttack).toBeUndefined();
      expect(blue.attackCooldown).toBe(0);
      for (let tick = 0; tick < 35; tick++) {sim.step([]); events.push(...sim.snapshot().events);}
      expect(events.filter(e => e.type === 'castCancelled' && e.castId === attack.id)).toHaveLength(1);
      expect(events.some(e => e.type === 'basicAttack' && e.sourceId === blue.id)).toBe(false);
      expect(attackHits(events, blue.id)).toHaveLength(0);
      expect(red.hp).toBe(hp);
    });
  }

  it('repeated same-target orders preserve the original preparation and commit time', async () => {
    const {sim, blue, red} = await arena();
    const attack = start(sim, blue, red), events: PresentationEvent[] = [];
    while (sim.state.tick < attack.commitTick) {
      expect(sim.step([{type: 'attack', heroId: blue.id, targetId: red.id}])[0]?.accepted).toBe(true);
      events.push(...sim.snapshot().events);
      if (sim.state.tick < attack.commitTick) expect(blue.basicAttack).toEqual(attack);
    }
    expect(events.some(e => e.type === 'castCancelled')).toBe(false);
    expect(events.filter(e => e.type === 'basicAttack' && e.sourceId === blue.id)).toEqual([
      expect.objectContaining({tick: attack.commitTick, attackId: attack.id}),
    ]);
  });

  for (const invalid of ['move', 'attack', 'cast'] as const) {
    it(`a rejected ${invalid} request does not cancel an existing attack`, async () => {
      const {sim, blue, red} = await arena();
      const attack = start(sim, blue, red);
      if (invalid === 'cast') blue.mana = 0;
      const command: SimCommand = invalid === 'move'
        ? {type: 'move', heroId: blue.id, point: {x: NaN, z: 0}}
        : invalid === 'attack' ? {type: 'attack', heroId: blue.id, targetId: blue.id}
        : {type: 'cast', heroId: blue.id, slot: 'Q', direction: {x: 0, z: 1}, targetId: null, point: null};
      expect(sim.step([command])[0]?.accepted).toBe(false);
      expect(blue.basicAttack?.id).toBe(attack.id);
      expect(sim.snapshot().events.some(e => e.type === 'castCancelled')).toBe(false);
      const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
      expect(attackHits(events, blue.id)[0]).toMatchObject({attackId: attack.id, targetId: red.id});
    });
  }

  it('explicitly switching targets before release cancels the old attack and prepares the selected target', async () => {
    const sim = new Simulation({seed: 1, contentVersion: 11, navigation: await testNavigation(), heroesPerTeam: 2});
    const blue = hero(sim, 0), red = hero(sim, 1), other = hero(sim, 1, 1);
    place(blue, {x: 0, z: 0}); place(red, {x: 5, z: 0}); place(other, {x: 4, z: 1});
    red.stats.hpRegen = other.stats.hpRegen = 0;
    const hp = red.hp, old = start(sim, blue, red);
    expect(sim.step([{type: 'attack', heroId: blue.id, targetId: other.id}])[0]?.accepted).toBe(true);
    const events = [...sim.snapshot().events];
    expect(events).toContainEqual(expect.objectContaining({type: 'castCancelled', castId: old.id, action: 'basicAttack'}));
    expect(blue.basicAttack?.targetId).toBe(other.id);
    expect(blue.basicAttack?.id).not.toBe(old.id);
    events.push(...collectUntil(sim, batch => attackHits(batch, blue.id).length > 0));
    expect(attackHits(events, blue.id)[0]!.targetId).toBe(other.id);
    expect(red.hp).toBe(hp);
  });

  for (const order of ['move', 'stop', 'cast'] as const) {
    it(`${order} after release retains the launched attack and never resets its recovery`, async () => {
      const {sim, blue, red} = await arena();
      const {attack} = launch(sim, blue, red), remaining = blue.attackCooldown, hp = red.hp;
      const command: SimCommand = order === 'move'
        ? {type: 'move', heroId: blue.id, point: {x: -5, z: 0}}
        : order === 'stop' ? {type: 'stop', heroId: blue.id}
        : {type: 'cast', heroId: blue.id, slot: 'Q', direction: {x: 0, z: 1}, targetId: null, point: null};
      const before = blue.position.x;
      expect(sim.step([command])[0]?.accepted).toBe(true);
      expect(blue.attackCooldown).toBeGreaterThan(0);
      expect(blue.attackCooldown).toBeLessThanOrEqual(remaining);
      if (order === 'move') expect(blue.position.x).toBeLessThan(before);
      const events = [...sim.snapshot().events];
      if (!attackHits(events, blue.id).length) events.push(...collectUntil(sim, batch => attackHits(batch, blue.id).length > 0));
      expect(attackHits(events, blue.id)).toEqual([expect.objectContaining({attackId: attack.id, targetId: red.id})]);
      expect(events.some(e => e.type === 'castCancelled' && e.castId === attack.id)).toBe(false);
      expect(red.hp).toBeLessThan(hp);
    });
  }

  it('switching targets after release cannot retarget the projectile already in flight', async () => {
    const sim = new Simulation({seed: 1, contentVersion: 11, navigation: await testNavigation(), heroesPerTeam: 2});
    const blue = hero(sim, 0), red = hero(sim, 1), other = hero(sim, 1, 1);
    place(blue, {x: 0, z: 0}); place(red, {x: 5, z: 0}); place(other, {x: 4, z: 1});
    red.stats.hpRegen = other.stats.hpRegen = 0;
    const {attack} = launch(sim, blue, red), otherHp = other.hp;
    sim.step([{type: 'attack', heroId: blue.id, targetId: other.id}]);
    const events = [...sim.snapshot().events];
    if (!attackHits(events, blue.id).length) events.push(...collectUntil(sim, batch => attackHits(batch, blue.id).length > 0));
    expect(attackHits(events, blue.id)[0]).toMatchObject({attackId: attack.id, targetId: red.id});
    expect(other.hp).toBe(otherHp);
    expect(blue.targetId).toBe(other.id);
  });

  for (const invalidation of ['dead', 'removed', 'outOfRange'] as const) {
    it(`target ${invalidation} before release cancels without a projectile or fabricated contact`, async () => {
      const {sim, blue, red} = await arena();
      const attack = start(sim, blue, red);
      if (invalidation === 'dead') {red.alive = false; red.hp = 0;}
      else if (invalidation === 'removed') sim.state.entities = sim.state.entities.filter(e => e.id !== red.id);
      else place(red, {x: 40, z: 0});
      const events = collectUntil(sim, batch => batch.some(e => e.type === 'castCancelled' && e.castId === attack.id));
      expect(events.some(e => e.type === 'castResolved' && e.castId === attack.id)).toBe(false);
      expect(attackHits(events, blue.id)).toHaveLength(0);
      expect(sim.state.projectiles.filter(p => p.basicAttack)).toHaveLength(0);
      expect(blue.attackCooldown).toBe(0);
    });
  }

  for (const invalidation of ['dead', 'removed'] as const) {
    it(`a launched projectile loses a ${invalidation} target without damaging another enemy`, async () => {
      const {sim, blue, red} = await arena();
      launch(sim, blue, red);
      if (invalidation === 'dead') {red.alive = false; red.hp = 0;}
      else sim.state.entities = sim.state.entities.filter(e => e.id !== red.id);
      const events: PresentationEvent[] = [];
      for (let tick = 0; tick < 30; tick++) {sim.step([]); events.push(...sim.snapshot().events);}
      expect(attackHits(events, blue.id)).toHaveLength(0);
      expect(sim.state.projectiles.filter(p => p.basicAttack)).toHaveLength(0);
    });
  }

  it('moving beyond attack range after release does not cancel a committed targeted projectile', async () => {
    const {sim, blue, red} = await arena();
    const {attack} = launch(sim, blue, red);
    place(red, {x: 12, z: 0});
    sim.step([{type: 'stop', heroId: blue.id}]);
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    expect(attackHits(events, blue.id)[0]).toMatchObject({attackId: attack.id, targetId: red.id});
  });

  it('a source dying after release does not erase its committed projectile or revive it with kill XP', async () => {
    const {sim, blue, red} = await arena();
    red.hp = 1; blue.xp = sim.catalog.rules.xpLevels[1]! - 1;
    const {attack} = launch(sim, blue, red);
    blue.alive = false; blue.hp = 0; blue.respawnAtTick = 10000;
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    expect(attackHits(events, blue.id)[0]).toMatchObject({attackId: attack.id, hpDamage: 1});
    expect(red.alive).toBe(false);
    expect(blue.kills).toBe(1);
    expect(blue.level).toBe(2);
    expect(blue.hp).toBe(0);
    expect(blue.alive).toBe(false);
  });

  it('a target becoming invulnerable before contact consumes the projectile without false confirmation', async () => {
    const {sim, blue, red} = await arena();
    place(red, {x: 60, z: 0});
    const tower = structure(sim, 'red-outer-tower');
    place(blue, {x: 23, z: 0});
    tower.attackCooldown = 1000;
    const hp = tower.hp;
    launch(sim, blue, tower);
    tower.invulnerable = true;
    sim.step([]);
    expect(attackHits(sim.snapshot().events, blue.id)).toHaveLength(0);
    expect(sim.state.projectiles.filter(p => p.basicAttack?.source.id === blue.id)).toHaveLength(0);
    expect(tower.hp).toBe(hp);
  });

  it('leaving tower reach cancels its preparation but cannot erase a tower shot already released', async () => {
    for (const afterRelease of [false, true]) {
      const {sim, blue, red} = await arena();
      place(blue, {x: 20, z: 0}); place(red, {x: 60, z: 0});
      const tower = structure(sim, 'red-outer-tower'), hp = blue.hp;
      sim.step([]);
      expect(tower.basicAttack?.targetId).toBe(blue.id);
      const attack = {...tower.basicAttack!};
      const events: PresentationEvent[] = [];
      if (afterRelease) events.push(...collectUntil(sim, batch => batch.some(e => e.type === 'basicAttack' && e.sourceId === tower.id)));
      sim.step([{type: 'move', heroId: blue.id, point: {x: 10, z: 0}}]);
      events.push(...sim.snapshot().events);
      for (let tick = 0; tick < 50; tick++) {sim.step([]); events.push(...sim.snapshot().events);}
      expect(Math.abs(blue.position.x - tower.position.x)).toBeGreaterThan(tower.attackRange + blue.radius);
      if (afterRelease) {
        expect(attackHits(events, tower.id)).toEqual([expect.objectContaining({attackId: attack.id, targetId: blue.id})]);
        expect(blue.hp).toBeLessThan(hp);
      } else {
        expect(events).toContainEqual(expect.objectContaining({type: 'castCancelled', action: 'basicAttack', castId: attack.id, reason: 'outOfRange'}));
        expect(attackHits(events, tower.id)).toHaveLength(0);
        expect(blue.hp).toBe(hp);
      }
    }
  });

  it('shield absorption is a confirmed contact with no false HP damage', async () => {
    const {sim, blue, red} = await arena();
    red.shield = 1000; red.shieldExpiresTick = 1000;
    const hp = red.hp;
    launch(sim, blue, red);
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    const hit = attackHits(events, blue.id)[0]!;
    expect(hit.hpDamage).toBe(0);
    expect(hit.shieldAbsorbed).toBeGreaterThan(0);
    expect(red.hp).toBe(hp);
    expect(events).toContainEqual(expect.objectContaining({type: 'heroDamaged', hpDamage: 0, shieldAbsorbed: hit.shieldAbsorbed}));
  });

  it('the next preparation observes the same start-to-start interval, not animation recovery time', async () => {
    const {sim, blue, red} = await arena();
    const first = start(sim, blue, red);
    const events = collectUntil(sim, batch => batch.some(e => e.type === 'castStarted' && e.action === 'basicAttack' && e.heroId === blue.id));
    const second = events.find(e => e.type === 'castStarted' && e.action === 'basicAttack' && e.heroId === blue.id)!;
    expect(second.tick - first.startedTick).toBe(first.intervalTicks);
  });

  it('a ranged minion removed after release retains source attribution until its projectile contacts', async () => {
    const sim = await makeSim(11);
    stepMany(sim, Math.ceil(sim.catalog.rules.waves.firstWaveTime * sim.tickRateHz) + 1);
    const source = sim.state.entities.find((e): e is MinionEntity => e.kind === 'minion' && e.team === 1 && e.minionKind === 'ranged')!;
    sim.state.entities = sim.state.entities.filter(e => e.kind !== 'minion' || e.id === source.id);
    const target = hero(sim, 0); place(source, {x: 0, z: 0}); place(target, {x: 5, z: 0});
    source.targetId = target.id; source.targetRefreshTick = 10000; target.stats.hpRegen = 0;
    const hp = target.hp;
    sim.step([]);
    expect(source.basicAttack).toBeDefined();
    const attack = {...source.basicAttack!};
    collectUntil(sim, batch => batch.some(e => e.type === 'basicAttack' && e.sourceId === source.id));
    source.hp = 0; source.alive = false;
    const events = collectUntil(sim, batch => attackHits(batch, source.id).length > 0);
    expect(sim.getEntityById(source.id)).toBeNull();
    expect(attackHits(events, source.id)[0]).toMatchObject({attackId: attack.id, targetId: target.id});
    expect(target.hp).toBeLessThan(hp);
  });

  it('stun during preparation cancels once, rather than releasing after the control arrives', async () => {
    const {sim, blue, red} = await arena();
    const attack = start(sim, blue, red);
    blue.statuses.push({kind: 'stun', percent: 0, expiresTick: 100, sourceId: red.id});
    sim.step([]);
    expect(sim.snapshot().events).toContainEqual(expect.objectContaining({type: 'castCancelled', action: 'basicAttack', castId: attack.id, reason: 'stunned'}));
    expect(blue.basicAttack).toBeUndefined();
    expect(blue.attackCooldown).toBe(0);
    stepMany(sim, 20);
    expect(sim.state.projectiles.filter(p => p.basicAttack)).toHaveLength(0);
  });

  it('melee minions contact at commit without spawning an invisible ranged projectile', async () => {
    const {sim, blue, red} = await minionArena();
    red.attackCooldown = 1000;
    const hp = red.hp;
    sim.step([]);
    expect(blue.basicAttack).toBeDefined();
    expect(red.hp).toBe(hp);
    const attack = {...blue.basicAttack!};
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    expect(events).toContainEqual(expect.objectContaining({type: 'basicAttack', attackId: attack.id, delivery: 'melee'}));
    expect(attackHits(events, blue.id)[0]).toMatchObject({tick: attack.commitTick, attackId: attack.id, targetId: red.id});
    expect(sim.state.projectiles.filter(p => p.basicAttack)).toHaveLength(0);
  });

  it('a real minion last hit retains its contact position after cleanup and awards the last-hitter', async () => {
    const {sim, red} = await minionArena();
    sim.state.entities = sim.state.entities.filter(e => e.kind !== 'minion' || e.id === red.id);
    const blue = hero(sim, 0); place(blue, {x: -4, z: 0}); place(red, {x: 1, z: 0});
    red.hp = 1; red.attackCooldown = 1000; red.targetRefreshTick = 10000;
    const gold = blue.gold;
    launch(sim, blue, red);
    const events = collectUntil(sim, batch => attackHits(batch, blue.id).length > 0);
    const hit = attackHits(events, blue.id)[0]!;
    expect(hit).toMatchObject({targetId: red.id, targetTeam: red.team, hpDamage: 1, position: red.position});
    expect(sim.getEntityById(red.id)).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({type: 'minionDied', entityId: red.id, position: hit.position}));
    expect(blue.gold - gold).toBeGreaterThanOrEqual(sim.catalog.minions.melee.bountyGold);
    const snapshot = sim.snapshot();
    const copy = snapshot.events.find((e): e is AttackHit => e.type === 'basicAttackHit')!;
    const hash = sim.finalHash();
    (copy.position as {x: number}).x = 999;
    expect(sim.finalHash()).toBe(hash);
    expect((sim.snapshot().events.find(e => e.type === 'basicAttackHit') as AttackHit).position.x).not.toBe(999);
  });

  for (const kind of ['melee', 'projectile'] as const) {
    it(`same-stage mutually lethal ${kind} contacts survive reversed unit storage order`, async () => {
      const hashes: string[] = [], batches: PresentationEvent[][] = [];
      for (const reverse of [false, true]) {
        const context = kind === 'melee' ? await minionArena() : await arena();
        const {sim, blue, red} = context;
        blue.hp = red.hp = 1;
        blue.targetId = red.id; red.targetId = blue.id;
        const events: PresentationEvent[] = [];
        for (let tick = 0; tick < 90 && (blue.alive || red.alive); tick++) {
          if (reverse) sim.state.entities.reverse();
          sim.step([]);
          if (reverse) sim.state.entities.sort((a, b) => a.id - b.id);
          events.push(...sim.snapshot().events);
        }
        expect(blue.alive).toBe(false); expect(red.alive).toBe(false);
        const blueHit = attackHits(events, blue.id), redHit = attackHits(events, red.id);
        expect(blueHit).toHaveLength(1); expect(redHit).toHaveLength(1);
        expect(blueHit[0]!.tick).toBe(redHit[0]!.tick);
        hashes.push(sim.finalHash()); batches.push(events);
      }
      expect(hashes[1]).toBe(hashes[0]);
      // The unit/contact phases are canonical; cleanup remains its own ordered
      // phase, so this is not a claim of whole-tick event-order invariance.
      expect(batches[1]!.filter(e => e.type !== 'minionDied')).toEqual(batches[0]!.filter(e => e.type !== 'minionDied'));
    });
  }

  it('v11 input replay regenerates the attack timeline and final state deterministically', async () => {
    const navigation = await testNavigation();
    const match = runBotMatch({seed: 6811, contentVersion: 11, navigation, blueDifficulty: 'normal', redDifficulty: 'normal', maxMatchSeconds: 45});
    expect(match.commandCount).toBeGreaterThan(0);
    expect(match.replay.contentVersion).toBe(11);
    expect(replayMatch(JSON.parse(JSON.stringify(match.replay)), navigation).hashMatches).toBe(true);
    const options = {seed: 42, contentVersion: 11 as const, navigation, maxMatchSeconds: 6};
    const a = new Simulation(options), b = new Simulation(options);
    const id = hero(a, 0).id;
    const commands: TimedCommand[] = [{tick: 1, command: {type: 'attackMove', heroId: id, point: {x: 0, z: 0}}}];
    while (!a.isComplete()) {
      const issued = commands.filter(c => c.tick === a.state.tick + 1).map(c => c.command);
      a.step(issued); b.step(issued);
      expect(b.snapshot().events).toEqual(a.snapshot().events);
    }
    expect(a.finalHash()).toBe(b.finalHash());
    expect(replayMatch(a.createReplay(commands), navigation).hashMatches).toBe(true);
  });

  it('v10 still attacks instantly and preserves a pre-v11 golden replay hash', async () => {
    const sim = await makeSim(10), blue = hero(sim, 0), red = hero(sim, 1);
    place(blue, {x: 0, z: 0}); place(red, {x: 5, z: 0});
    const hp = red.hp;
    sim.step([{type: 'attack', heroId: blue.id, targetId: red.id}]);
    expect(red.hp).toBeLessThan(hp);
    expect(blue.basicAttack).toBeUndefined();
    expect(sim.snapshot().events.map(e => e.type)).toEqual(['basicAttack', 'heroDamaged']);
    const navigation = await testNavigation();
    const match = runBotMatch({seed: 6811, contentVersion: 10, navigation, blueDifficulty: 'normal', redDifficulty: 'normal', maxMatchSeconds: 45});
    // Captured before this implementation, from the formal source's simulation blob 9347aef.
    expect(match.commandCount).toBe(228);
    expect(match.simulation.finalHash()).toBe('c6ef20dcb6e77ff7');
    expect(replayMatch(match.replay, navigation).hashMatches).toBe(true);
  });
});
