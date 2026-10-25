import { describe, expect, it } from 'vitest';
import { hero, makeSim, perform, place, stepMany } from './helpers.js';

describe('snapshot isolation', () => {
  it('does not expose live stats, diagnostics or entity state through the snapshot', async () => {
    const sim = await makeSim(2, 901);
    stepMany(sim, 30);

    const snapshot = sim.snapshot();
    const hashBefore = sim.finalHash();
    const liveStatsBefore = JSON.stringify(sim.state.stats);
    const liveDiagnosticsBefore = JSON.stringify(sim.state.diagnostics);
    const liveEntityPositionBefore = { ...sim.state.entities[0]!.position };
    const liveHeroPositionBefore = { ...hero(sim, 0).position };
    const liveHeroItemsBefore = [...hero(sim, 0).items];

    // @ts-expect-error snapshot stats must be readonly
    snapshot.stats.heroKills[0] = 99;
    // @ts-expect-error snapshot diagnostics must be readonly
    snapshot.diagnostics.pathFailures = 123;

    const statsAlias = snapshot.stats as unknown as {
      damageByTeam: number[];
      minionKills: number[];
      abilities: Record<string, { casts: number; damage: number }>;
    };
    statsAlias.damageByTeam[0] = 1234;
    statsAlias.minionKills[1] = 77;
    const abilityStats = statsAlias.abilities['veyra.q'];
    if (abilityStats) {
      abilityStats.casts = 88;
      abilityStats.damage = 999;
    }

    const diagnosticsAlias = snapshot.diagnostics as unknown as {
      rejectionReasons: Record<string, number>;
      stuckEvents: { tick: number; entityId: number; position: { x: number; z: number } }[];
    };
    diagnosticsAlias.rejectionReasons.injected = 5;
    diagnosticsAlias.stuckEvents.push({
      tick: 1,
      entityId: 404,
      position: { x: 1, z: 2 },
    });

    const entitiesAlias = snapshot.entities as unknown as {
      position: { x: number; z: number };
      hp: number;
    }[];
    entitiesAlias[0]!.position.x = 999;
    entitiesAlias[0]!.hp = -1;

    const heroesAlias = snapshot.heroes as unknown as {
      position: { x: number; z: number };
      items: string[];
      cooldowns: Record<string, number>;
    }[];
    heroesAlias[0]!.position.x = 888;
    heroesAlias[0]!.items.push('injected_item');
    heroesAlias[0]!.cooldowns.Q = 12345;

    expect(sim.finalHash()).toBe(hashBefore);
    expect(JSON.stringify(sim.state.stats)).toBe(liveStatsBefore);
    expect(JSON.stringify(sim.state.diagnostics)).toBe(liveDiagnosticsBefore);
    expect(sim.state.entities[0]!.position).toEqual(liveEntityPositionBefore);
    expect(hero(sim, 0).position).toEqual(liveHeroPositionBefore);
    expect(hero(sim, 0).items).toEqual(liveHeroItemsBefore);
    expect(hero(sim, 0).cooldowns.Q).toBe(0);
  });

  it('keeps an earlier snapshot stable across later combat and frames', async () => {
    const sim = await makeSim(1, 902, { maxMatchSeconds: 120 });
    stepMany(sim, 8 * 30 + 2);

    const redMinion = sim.state.entities.find(
      (entity) => entity.kind === 'minion' && entity.team === 1 && entity.alive,
    );
    expect(redMinion).toBeDefined();
    const blue = hero(sim, 0);
    place(blue, { x: redMinion!.position.x - 2, z: redMinion!.position.z });
    redMinion!.hp = 1;

    const snapshot = sim.snapshot();
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotTick = snapshot.tick;
    expect(snapshot.stats.minionKills[0]).toBe(0);
    expect(snapshot.diagnostics.commandRejections).toBe(0);
    expect(snapshot.entities.some((entity) => entity.id === redMinion!.id && entity.alive)).toBe(
      true,
    );

    expect(
      perform(sim, { type: 'attack', heroId: blue.id, targetId: redMinion!.id }).accepted,
    ).toBe(true);
    stepMany(sim, 3);
    perform(sim, { type: 'move', heroId: blue.id, point: { x: Number.NaN, z: 0 } });

    expect(sim.state.stats.minionKills[0]).toBe(1);
    expect(sim.state.diagnostics.commandRejections).toBe(1);
    expect(sim.state.entities.some((entity) => entity.id === redMinion!.id)).toBe(false);

    expect(snapshot.tick).toBe(snapshotTick);
    expect(snapshot.stats.minionKills[0]).toBe(0);
    expect(snapshot.diagnostics.commandRejections).toBe(0);
    expect(JSON.stringify(snapshot)).toBe(snapshotJson);
  });
});
