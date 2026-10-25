import { describe, expect, it } from 'vitest';
import { hero, killGuardStructures, makeSim, perform, place, stepMany, structure } from './helpers.js';

describe('death, respawn and match termination', () => {
  it('applies a hero kill once, rejects commands while dead, and respawns at the fountain', async () => {
    const sim = await makeSim(1, 21);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    place(blue, { x: 1, z: 0 });
    place(red, { x: 4, z: 0 });
    red.hp = 1;
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: red.id }).accepted,
    ).toBe(true);
    stepMany(sim, 3);
    expect(red.alive).toBe(false);
    expect(red.hp).toBe(0);
    expect(blue.kills).toBe(1);
    expect(sim.state.stats.heroKills[0]).toBe(1);
    expect(sim.state.stats.deaths[1]).toBe(1);
    expect(red.respawnAtTick).toBeGreaterThan(sim.state.tick);
    expect(
      perform(sim, { type: 'move', heroId: red.id, point: { x: 0, z: 0 } }).reason,
    ).toBe('heroDead');
    stepMany(sim, 7 * 30 + 10);
    expect(red.alive).toBe(true);
    expect(red.hp).toBe(red.stats.maxHp);
    expect(red.position.x).toBeGreaterThan(80);
  });

  it('ends the match when the exposed base dies and rejects later commands', async () => {
    const sim = await makeSim(1, 22);
    const blue = hero(sim, 0);
    const redBase = structure(sim, 'red-base');
    killGuardStructures(sim, 1);
    redBase.invulnerable = false;
    redBase.hp = 1;
    place(blue, { x: 95.5, z: 0 });
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: redBase.id }).accepted,
    ).toBe(true);
    stepMany(sim, 5);
    expect(redBase.alive).toBe(false);
    expect(sim.status).toBe('blueWin');
    expect(sim.state.winner).toBe(0);
    expect(sim.state.endReason).toBe('redBaseDestroyed');
    expect(sim.state.stats.structureKills[0]).toBe(1);
    const endedAt = sim.state.tick;
    const rejected = sim.step([{ type: 'move', heroId: blue.id, point: { x: 0, z: 0 } }]);
    expect(rejected[0]?.accepted).toBe(false);
    expect(rejected[0]?.reason).toBe('matchEnded');
    expect(sim.state.tick).toBe(endedAt);
  });

  it('reports a hard-cap timeout as unfinished instead of inventing a winner', async () => {
    const sim = await makeSim(1, 23, { maxMatchSeconds: 1 });
    stepMany(sim, 30);
    expect(sim.status).toBe('timeout');
    expect(sim.state.winner).toBeNull();
    expect(sim.state.endReason).toBe('maxMatchSeconds');
    expect(sim.state.tick).toBe(30);
  });
});
