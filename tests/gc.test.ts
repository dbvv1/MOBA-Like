import { describe, expect, it } from 'vitest';
import { HeroBot } from '../src/sim/ai.js';
import { hero, makeSim, perform, place, stepMany } from './helpers.js';

interface StuckTracker {
  stuckSince: Map<number, { x: number; z: number; tick: number }>;
}

interface BotTracker {
  tracked: Map<number, unknown>;
}

describe('dead minion cleanup', () => {
  it('removes a minion killed by real combat and clears id-keyed tracking', async () => {
    const sim = await makeSim(1, 501, { maxMatchSeconds: 120 });
    stepMany(sim, 8 * 30 + 2);

    const redMinion = sim.state.entities.find(
      (entity) => entity.kind === 'minion' && entity.team === 1 && entity.alive,
    );
    expect(redMinion).toBeDefined();
    const minionId = redMinion!.id;

    const blue = hero(sim, 0);
    place(blue, { x: redMinion!.position.x - 2, z: redMinion!.position.z });
    redMinion!.hp = 1;

    const bot = new HeroBot({ team: 0, slotIndex: 0, difficulty: 'normal', seed: 1 });
    bot.think(sim);
    const botTracker = bot as unknown as BotTracker;
    expect(botTracker.tracked.has(minionId)).toBe(true);

    const stuckTracker = sim as unknown as StuckTracker;
    stuckTracker.stuckSince.set(minionId, {
      x: redMinion!.position.x,
      z: redMinion!.position.z,
      tick: sim.state.tick,
    });

    const nextEntityIdBefore = sim.state.nextEntityId;
    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: minionId }).accepted,
    ).toBe(true);
    stepMany(sim, 3);

    expect(sim.getEntityById(minionId)).toBeNull();
    expect(sim.state.entities.some((entity) => entity.id === minionId)).toBe(false);
    expect(sim.state.stats.minionKills[0]).toBe(1);
    expect(stuckTracker.stuckSince.has(minionId)).toBe(false);
    expect(sim.state.nextEntityId).toBe(nextEntityIdBefore);
    expect(sim.state.nextEntityId).toBeGreaterThan(minionId);

    bot.think(sim);
    expect(botTracker.tracked.has(minionId)).toBe(false);

    expect(sim.state.entities.filter((entity) => entity.kind === 'minion')).toHaveLength(9);
    expect(
      sim.state.entities
        .filter((entity) => entity.kind === 'minion')
        .every((entity) => entity.alive),
    ).toBe(true);
    expect(sim.state.entities.filter((entity) => entity.kind === 'structure')).toHaveLength(8);
    expect(sim.state.entities.filter((entity) => entity.kind === 'hero')).toHaveLength(2);
  });
});
