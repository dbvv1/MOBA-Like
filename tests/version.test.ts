import { describe, expect, it } from 'vitest';
import { getContent } from '../src/content/index.js';
import type { ContentVersion } from '../src/content/types.js';
import { replayMatch, runBotMatch } from '../src/sim/index.js';
import { Simulation } from '../src/sim/simulation.js';
import type { Replay } from '../src/sim/types.js';
import { hero, makeSim, perform, place, testNavigation } from './helpers.js';

describe('replay and content version contracts', () => {
  it('rejects unknown content versions at the getContent and Simulation entry points', async () => {
    const unknownVersion = 999 as unknown as ContentVersion;
    expect(() => getContent(unknownVersion)).toThrow(/content version/i);

    const navigation = await testNavigation();
    expect(
      () =>
        new Simulation({
          seed: 1,
          contentVersion: unknownVersion,
          navigation,
        }),
    ).toThrow(/content version/i);
  });

  it('rejects unknown replay format and content versions instead of falling back to v2', async () => {
    const navigation = await testNavigation();
    const match = runBotMatch({
      seed: 42,
      contentVersion: 2,
      navigation,
      blueDifficulty: 'normal',
      redDifficulty: 'normal',
      maxMatchSeconds: 30,
    });

    const roundTripped = JSON.parse(JSON.stringify(match.replay)) as Replay;
    expect(replayMatch(roundTripped, navigation).hashMatches).toBe(true);

    const unknownFormat = JSON.parse(
      JSON.stringify({ ...match.replay, formatVersion: 999 }),
    ) as Replay;
    expect(() => replayMatch(unknownFormat, navigation)).toThrow(/format version/i);

    const unknownContent = JSON.parse(
      JSON.stringify({ ...match.replay, contentVersion: 999 }),
    ) as Replay;
    expect(() => replayMatch(unknownContent, navigation)).toThrow(/content version/i);

    expect(getContent(1).version).toBe(1);
    expect(getContent(2).version).toBe(2);
  });

  it('keeps v1 and v2 content distinct and rejects an old pointed Q under v2', async () => {
    expect(getContent(1).abilities['veyra.q']?.targetType).toBe('enemyUnit');
    expect(getContent(2).abilities['veyra.q']?.targetType).toBe('direction');

    const sim = await makeSim(2, 903);
    const blue = hero(sim, 0);
    const red = hero(sim, 1);
    place(blue, { x: -4, z: 0 });
    place(red, { x: 4, z: 0 });

    expect(
      perform(sim, {
        type: 'cast',
        heroId: blue.id,
        slot: 'Q',
        targetId: red.id,
        direction: null,
        point: null,
      }).reason,
    ).toBe('directionRequired');
  });
});
