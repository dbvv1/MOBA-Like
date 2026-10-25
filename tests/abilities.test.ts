import { describe, expect, it } from 'vitest';
import { hero, makeSim, perform, place, stepMany, structure } from './helpers.js';

describe('abilities, timing and control', () => {
  it('resolves a targeted v1 Q, spends mana, starts cooldown and records a hit', async () => {
    const sim = await makeSim(1, 11);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    place(blue, { x: -4, z: 0 });
    place(red, { x: 4, z: 0 });
    const oldHp = red.hp;
    const oldMana = blue.mana;
    const result = perform(sim, {
      type: 'cast',
      heroId: blue.id,
      slot: 'Q',
      targetId: red.id,
      direction: null,
      point: null,
    });
    expect(result.accepted).toBe(true);
    expect(blue.cast?.slot).toBe('Q');
    stepMany(sim, 10);
    expect(red.hp).toBeLessThan(oldHp);
    expect(oldHp - red.hp).toBeGreaterThan(50);
    expect(oldHp - red.hp).toBeLessThan(95);
    expect(blue.mana).toBeGreaterThan(oldMana - 40);
    expect(blue.mana).toBeLessThan(oldMana - 36);
    expect(blue.cooldowns.Q).toBeGreaterThan(0);
    const stats = sim.state.stats.abilities['veyra.q'];
    expect(stats?.casts).toBe(1);
    expect(stats?.hitCasts).toBe(1);
    expect(stats?.heroHits).toBe(1);
    expect(stats?.heroDamage).toBeGreaterThan(0);
  });

  it('fires the v2 Q in a direction and can miss when aim is elsewhere', async () => {
    const hitSim = await makeSim(2, 12);
    const hitBlue = hero(hitSim, 0);
    const hitRed = hero(hitSim, 1);
    place(hitBlue, { x: -4, z: 0 });
    place(hitRed, { x: 4, z: 0 });
    expect(
      perform(hitSim, {
        type: 'cast',
        heroId: hitBlue.id,
        slot: 'Q',
        targetId: null,
        direction: { x: 1, z: 0 },
        point: null,
      }).accepted,
    ).toBe(true);
    stepMany(hitSim, 20);
    expect(hitRed.hp).toBeLessThan(hitRed.stats.maxHp);
    expect(hitSim.state.projectiles).toHaveLength(0);
    expect(hitSim.state.stats.abilities['veyra.q']?.hitCasts).toBe(1);

    const missSim = await makeSim(2, 13);
    const missBlue = hero(missSim, 0);
    const missRed = hero(missSim, 1);
    place(missBlue, { x: -4, z: 0 });
    place(missRed, { x: 4, z: 4 });
    perform(missSim, {
      type: 'cast',
      heroId: missBlue.id,
      slot: 'Q',
      targetId: null,
      direction: { x: 1, z: 0 },
      point: null,
    });
    stepMany(missSim, 20);
    expect(missRed.hp).toBe(missRed.stats.maxHp);
    expect(missSim.state.stats.abilities['veyra.q']?.casts).toBe(1);
    expect(missSim.state.stats.abilities['veyra.q']?.hitCasts).toBe(0);
  });

  it('dashes along the navigation surface and records a successful W', async () => {
    const sim = await makeSim(1, 14);
    const blue = hero(sim, 0);
    place(blue, { x: -4, z: 0 });
    const result = perform(sim, {
      type: 'cast',
      heroId: blue.id,
      slot: 'W',
      targetId: null,
      direction: { x: 1, z: 0 },
      point: null,
    });
    expect(result.accepted).toBe(true);
    expect(blue.position.x).toBeGreaterThan(2);
    expect(blue.position.x).toBeLessThan(3.3);
    expect(blue.cooldowns.W).toBeGreaterThan(0);
    expect(sim.state.stats.abilities['veyra.w']?.hitCasts).toBe(1);
  });

  it('ticks a persistent zone multiple times, slows while inside, and then removes it', async () => {
    const sim = await makeSim(1, 15);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    place(blue, { x: -4, z: 0 });
    place(red, { x: 4, z: 0 });
    const oldHp = red.hp;
    expect(
      perform(sim, {
        type: 'cast',
        heroId: blue.id,
        slot: 'E',
        targetId: null,
        direction: null,
        point: { x: 4, z: 0 },
      }).accepted,
    ).toBe(true);
    stepMany(sim, 30);
    expect(sim.state.zones).toHaveLength(1);
    expect(red.statuses.some((status) => status.kind === 'slow')).toBe(true);
    const midHp = red.hp;
    expect(midHp).toBeLessThan(oldHp);
    stepMany(sim, 100);
    expect(oldHp - red.hp).toBeGreaterThan(75);
    expect(oldHp - red.hp).toBeLessThan(150);
    expect(sim.state.zones).toHaveLength(0);
    expect(sim.state.stats.abilities['veyra.e']?.casts).toBe(1);
    expect(sim.state.stats.abilities['veyra.e']?.hitCasts).toBe(1);
  });

  it('delays, stuns, blocks movement and casting, then allows control again', async () => {
    const sim = await makeSim(1, 16);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    place(blue, { x: -4, z: 0 });
    place(red, { x: 4, z: 0 });
    const oldHp = red.hp;
    expect(
      perform(sim, {
        type: 'cast',
        heroId: blue.id,
        slot: 'R',
        targetId: null,
        direction: null,
        point: { x: 4, z: 0 },
      }).accepted,
    ).toBe(true);
    stepMany(sim, 20);
    expect(red.statuses.some((status) => status.kind === 'stun')).toBe(false);
    expect(red.hp).toBe(oldHp);
    stepMany(sim, 10);
    expect(red.hp).toBeLessThan(oldHp);
    expect(red.statuses.some((status) => status.kind === 'stun')).toBe(true);
    expect(
      perform(sim, { type: 'move', heroId: red.id, point: { x: 0, z: 0 } }).reason,
    ).toBe('stunned');
    expect(
      perform(sim, {
        type: 'cast',
        heroId: red.id,
        slot: 'Q',
        targetId: blue.id,
        direction: null,
        point: null,
      }).reason,
    ).toBe('stunned');
    stepMany(sim, 50);
    expect(red.statuses.some((status) => status.kind === 'stun')).toBe(false);
    expect(
      perform(sim, { type: 'move', heroId: red.id, point: { x: 0, z: 0 } }).accepted,
    ).toBe(true);
    expect(sim.state.stats.abilities['veyra.r']?.casts).toBe(1);
    expect(sim.state.stats.abilities['veyra.r']?.hitCasts).toBe(1);
    expect(sim.state.stats.abilities['veyra.r']?.heroHits).toBe(1);
  });

  it('gives the second hero a self shield and speed window without changing base stats', async () => {
    const sim = await makeSim(2, 17, { blueHero: 'morrow', redHero: 'veyra' });
    const morrow = hero(sim, 0);
    expect(morrow.definitionId).toBe('morrow');
    const baseHp = morrow.stats.maxHp;
    expect(
      perform(sim, {
        type: 'cast',
        heroId: morrow.id,
        slot: 'W',
        targetId: null,
        direction: null,
        point: null,
      }).accepted,
    ).toBe(true);
    expect(morrow.shield).toBeGreaterThan(100);
    expect(morrow.statuses.some((status) => status.kind === 'speed')).toBe(true);
    expect(morrow.stats.maxHp).toBe(baseHp);
    expect(sim.state.stats.abilities['morrow.w']?.hitCasts).toBe(1);
  });

  it('turns tower aggro to an enemy hero who attacks an allied hero under the tower', async () => {
    const sim = await makeSim(1, 18);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    const tower = structure(sim, 'red-outer-tower');
    place(blue, { x: 24.4, z: 0 });
    place(red, { x: 29.5, z: 0 });
    expect(tower.alive).toBe(true);
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: red.id }).accepted,
    ).toBe(true);
    stepMany(sim, 8);
    expect(red.hp).toBeLessThan(red.stats.maxHp);
    expect(tower.aggroHeroId).toBe(blue.id);
    expect(tower.targetId).toBe(blue.id);
  });
});
