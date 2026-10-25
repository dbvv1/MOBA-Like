import { describe, expect, it } from 'vitest';
import { distance } from '../src/sim/math.js';
import { HeroBot } from '../src/sim/ai.js';
import { Simulation } from '../src/sim/simulation.js';
import { hero, makeSim, perform, stepMany, structure, testNavigation } from './helpers.js';

describe('deterministic simulation core', () => {
  it('initializes a mirrored, 30 Hz match with separated definitions and instances', async () => {
    const sim = await makeSim(1, 7);
    expect(sim.tickRateHz).toBe(30);
    expect(sim.status).toBe('running');
    expect(sim.state.tick).toBe(0);
    expect(sim.state.timeSeconds).toBe(0);
    expect(sim.getHero(0)?.definitionId).toBe('veyra');
    expect(sim.getHero(1)?.definitionId).toBe('veyra');
    expect(sim.getHero(1)?.position.x).toBe(-sim.getHero(0)!.position.x);
    expect(sim.state.entities.filter((entity) => entity.kind === 'structure')).toHaveLength(8);
    expect(structure(sim, 'blue-base').invulnerable).toBe(true);
    expect(structure(sim, 'red-base').invulnerable).toBe(true);
    expect(sim.state.stats.abilities['veyra.q']?.casts).toBe(0);
  });


  it('supports more than one hero per team without hard-coded entity counts', async () => {
    const navigation = await testNavigation();
    const sim = new Simulation({
      seed: 31,
      contentVersion: 2,
      navigation,
      heroesPerTeam: 3,
      heroIdsByTeam: [
        ['veyra', 'morrow', 'veyra'],
        ['morrow', 'veyra', 'morrow'],
      ],
      maxMatchSeconds: 30,
    });
    expect(sim.state.entities.filter((entity) => entity.kind === 'hero')).toHaveLength(6);
    expect(sim.getHero(0, 0)?.definitionId).toBe('veyra');
    expect(sim.getHero(0, 1)?.definitionId).toBe('morrow');
    expect(sim.getHero(1, 2)?.definitionId).toBe('morrow');
    expect(sim.getHero(0, 2)?.position).not.toEqual(sim.getHero(0, 0)?.position);
    stepMany(sim, 30);
    expect(sim.state.tick).toBe(30);
  });

  it('moves a hero only through the command boundary and Detour path', async () => {
    const sim = await makeSim(1, 2);
    const blue = hero(sim, 0);
    const accepted = perform(sim, { type: 'move', heroId: blue.id, point: { x: -50, z: 0 } });
    expect(accepted.accepted).toBe(true);
    expect(blue.path.length).toBeGreaterThan(0);
    expect(blue.path[0]).toBeDefined();
    const before = blue.position.x;
    stepMany(sim, 120);
    expect(blue.position.x).toBeGreaterThan(before + 10);
    expect(blue.position.x).toBeLessThan(0);
    expect(distance(blue.position, { x: -50, z: 0 })).toBeLessThan(35);
  });

  it('rejects invalid commands and invalid targets without changing match state', async () => {
    const sim = await makeSim(1, 3);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);

    expect(perform(sim, { type: 'move', heroId: 9999, point: { x: 0, z: 0 } }).reason).toBe(
      'invalidHero',
    );
    expect(
      perform(sim, { type: 'move', heroId: blue.id, point: { x: Number.NaN, z: 0 } }).reason,
    ).toBe('invalidPoint');
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: blue.id }).reason,
    ).toBe('invalidTarget');
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: structure(sim, 'red-base').id })
        .reason,
    ).toBe('targetInvulnerable');
    expect(
      perform(sim, {
        type: 'cast',
        heroId: blue.id,
        slot: 'Q',
        targetId: null,
        direction: null,
        point: null,
      }).reason,
    ).toBe('targetRequired');
    expect(
      perform(sim, {
        type: 'cast',
        heroId: blue.id,
        slot: 'Q',
        targetId: red.id,
        direction: null,
        point: null,
      }).reason,
    ).toBe('outOfRange');
    expect(
      perform(sim, { type: 'buyItem', heroId: blue.id, itemId: 'no_such_item' }).reason,
    ).toBe('unknownItem');
    expect(
      perform(sim, { type: 'buyItem', heroId: blue.id, itemId: 'sunsteel_blade' }).reason,
    ).toBe('notEnoughGold');
    expect(blue.mana).toBe(blue.stats.maxMana);
    expect(sim.state.diagnostics.rejectionReasons.outOfRange).toBe(1);
  });


  it('distinguishes difficulty through behavior only, never hidden hero stats', async () => {
    const sim = await makeSim(1, 41);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    const beforeBlue = { ...blue.stats };
    const beforeRed = { ...red.stats };
    const high = new HeroBot({ team: 0, slotIndex: 0, difficulty: 'high', seed: 1 });
    const low = new HeroBot({ team: 1, slotIndex: 0, difficulty: 'low', seed: 2 });
    high.think(sim);
    low.think(sim);
    expect(blue.stats).toEqual(beforeBlue);
    expect(red.stats).toEqual(beforeRed);
    expect(blue.level).toBe(1);
    expect(red.level).toBe(1);
  });

  it('spawns symmetric minion waves from living barracks', async () => {
    const sim = await makeSim(1, 4);
    stepMany(sim, 240);
    expect(sim.state.waveNumber).toBe(1);
    const blueMinions = sim.state.entities.filter(
      (entity) => entity.kind === 'minion' && entity.team === 0,
    );
    const redMinions = sim.state.entities.filter(
      (entity) => entity.kind === 'minion' && entity.team === 1,
    );
    expect(blueMinions).toHaveLength(5);
    expect(redMinions).toHaveLength(5);
    stepMany(sim, 25 * 30);
    expect(sim.state.waveNumber).toBe(2);
    const blueMinionsAfter = sim.state.entities.filter(
      (entity) => entity.kind === 'minion' && entity.team === 0,
    );
    expect(blueMinionsAfter.length).toBeGreaterThanOrEqual(5);
  });

  it('applies item stats and level growth without sharing instances', async () => {
    const sim = await makeSim(1, 5);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    blue.gold = 900;
    const oldHitPoints = blue.hp;
    const oldAttack = blue.stats.attackDamage;
    expect(
      perform(sim, { type: 'buyItem', heroId: blue.id, itemId: 'sunsteel_blade' }).accepted,
    ).toBe(true);
    expect(blue.gold).toBeCloseTo(100 + 2 / 30, 6);
    expect(blue.stats.attackDamage).toBeCloseTo(oldAttack + 18, 6);
    expect(blue.hp).toBeLessThanOrEqual(blue.stats.maxHp);
    expect(red.items).toHaveLength(0);
    expect(
      perform(sim, { type: 'buyItem', heroId: blue.id, itemId: 'sunsteel_blade' }).reason,
    ).toBe('alreadyOwned');

    blue.gold = 800;
    const oldMaxHp = blue.maxHp;
    expect(
      perform(sim, { type: 'buyItem', heroId: blue.id, itemId: 'warden_plate' }).accepted,
    ).toBe(true);
    expect(blue.stats.maxHp).toBe(oldMaxHp + 240);
    expect(blue.hp).toBeGreaterThan(oldHitPoints);

    blue.xp = 180;
    stepMany(sim, 1);
    expect(blue.level).toBe(2);
    expect(blue.stats.maxHp).toBeGreaterThan(oldMaxHp + 240);
  });

  it('adds passive gold and xp on simulation time only', async () => {
    const sim = await makeSim(1, 6);
    const blue = hero(sim, 0);
    const gold = blue.gold;
    const xp = blue.xp;
    stepMany(sim, 30);
    expect(sim.timeSeconds).toBeCloseTo(1, 6);
    expect(blue.gold).toBeCloseTo(gold + 2, 5);
    expect(blue.xp).toBeCloseTo(xp + 2.5, 5);
  });
});
