import { describe, expect, it } from 'vitest';
import { getContent } from '../src/content/index.js';
import { replayMatch, runBotMatch } from '../src/sim/index.js';
import { makeSim, stepMany, testNavigation } from './helpers.js';

describe('seeded replay and content-version compatibility', () => {
  it('replays the exact same command stream to the same final hash', async () => {
    const navigation = await testNavigation();
    const match = runBotMatch({
      seed: 4242,
      contentVersion: 1,
      navigation,
      blueDifficulty: 'normal',
      redDifficulty: 'normal',
      maxMatchSeconds: 120,
    });
    expect(match.commandCount).toBeGreaterThan(0);
    expect(match.replay.formatVersion).toBe(1);
    expect(match.replay.contentVersion).toBe(1);
    expect(match.replay.finalHash).toBe(match.simulation.finalHash());

    const verification = replayMatch(match.replay, navigation);
    expect(verification.hashMatches).toBe(true);
    expect(verification.actualHash).toBe(verification.expectedHash);
    expect(verification.actualStatus).toBe(verification.expectedStatus);
    expect(verification.actualWinner).toBe(verification.expectedWinner);
    expect(verification.durationSeconds).toBeCloseTo(match.replay.durationSeconds, 6);
  });


  it('changes the final hash when the command sequence changes', async () => {
    const first = await makeSim(1, 77);
    const second = await makeSim(1, 77);
    const firstHero = first.getHero(0)!;
    const secondHero = second.getHero(0)!;
    first.step([{ type: 'move', heroId: firstHero.id, point: { x: -50, z: 0 } }]);
    second.step([{ type: 'move', heroId: secondHero.id, point: { x: -30, z: 0 } }]);
    stepMany(first, 60);
    stepMany(second, 60);
    expect(first.finalHash()).not.toBe(second.finalHash());
  });

  it('is deterministic across two seeded bot runs and records no wall-clock input', async () => {
    const navigation = await testNavigation();
    const options = {
      seed: 9901,
      contentVersion: 1 as const,
      navigation,
      blueDifficulty: 'normal' as const,
      redDifficulty: 'normal' as const,
      maxMatchSeconds: 90,
    };
    const first = runBotMatch(options);
    const second = runBotMatch(options);
    expect(second.simulation.finalHash()).toBe(first.simulation.finalHash());
    expect(second.commandCount).toBe(first.commandCount);
    expect(second.replay.commands).toEqual(first.replay.commands);
  });

  it('keeps v1 target commands valid through the versioned replay header after v2 adds direction fire', async () => {
    const navigation = await testNavigation();
    const v1 = runBotMatch({
      seed: 771,
      contentVersion: 1,
      navigation,
      blueDifficulty: 'normal',
      redDifficulty: 'normal',
      maxMatchSeconds: 120,
    });
    const v2 = runBotMatch({
      seed: 771,
      contentVersion: 2,
      navigation,
      blueDifficulty: 'normal',
      redDifficulty: 'normal',
      maxMatchSeconds: 120,
    });
    expect(getContent(1).abilities['veyra.q']?.targetType).toBe('enemyUnit');
    expect(getContent(2).abilities['veyra.q']?.targetType).toBe('direction');
    expect(v1.replay.contentVersion).toBe(1);
    expect(v2.replay.contentVersion).toBe(2);
    const verification = replayMatch(v1.replay, navigation);
    expect(verification.hashMatches).toBe(true);
    expect(verification.actualStatus).toBe(v1.simulation.status);
  });

  it('replays a v2 match containing the second hero and directional projectiles', async () => {
    const navigation = await testNavigation();
    const match = runBotMatch({
      seed: 552,
      contentVersion: 2,
      navigation,
      blueDifficulty: 'normal',
      redDifficulty: 'normal',
      heroIdsByTeam: [['morrow'], ['veyra']],
      maxMatchSeconds: 120,
    });
    const verification = replayMatch(match.replay, navigation);
    expect(verification.hashMatches).toBe(true);
    expect(match.replay.heroIdsByTeam).toEqual([['morrow'], ['veyra']]);
  });
});
