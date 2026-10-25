import { describe, expect, it, vi } from 'vitest';
import { HeroBot, replayMatch, runBotMatch } from '../src/sim/index.js';
import { getContent } from '../src/content/index.js';
import { hero, makeSim, place, testNavigation } from './helpers.js';

const recovering = (bot: HeroBot) => (bot as unknown as { recovering: boolean }).recovering;
const botFor = (team: 0 | 1) => new HeroBot({team, slotIndex: 0, difficulty: 'high', seed: 1});

describe('versioned recovery commitment', () => {
  it('keeps old catalogs and basic regeneration unchanged', async () => {
    expect(getContent(1).rules.botRecovery).toBeUndefined();
    expect(getContent(2).rules.botRecovery).toBeUndefined();
    const sim = await makeSim(3);
    for (const team of [0, 1] as const) {
      const h = hero(sim, team);
      place(h, {x: team === 0 ? -89 : 89, z: 0}); h.hp = 100;
    }
    sim.step([]);
    expect(hero(sim, 0).hp).toBeCloseTo(100.1, 8);
    expect(hero(sim, 1).hp).toBeCloseTo(100.1, 8);
  });

  it('uses the same entry and exit hysteresis for both teams', async () => {
    for (const team of [0, 1] as const) {
      const sim = await makeSim(3); const h = hero(sim, team); const bot = botFor(team);
      h.hp = h.maxHp * 0.2; bot.think(sim); expect(recovering(bot)).toBe(true);
      sim.state.tick += 120; h.hp = h.maxHp * 0.4; bot.think(sim); expect(recovering(bot)).toBe(true);
      sim.state.tick += 120; h.hp = h.maxHp * 0.46; bot.think(sim); expect(recovering(bot)).toBe(false);
    }
  });

  it('releases commitment when the recovery point becomes unsafe after reaction delay', async () => {
    const sim = await makeSim(3); const h = hero(sim, 0); const bot = botFor(0);
    h.hp = h.maxHp * 0.2; place(h, {x: -89, z: 0}); bot.think(sim);
    expect(recovering(bot)).toBe(true);
    place(hero(sim, 1), {x: -80, z: 0});
    sim.state.tick += 120; bot.think(sim); expect(recovering(bot)).toBe(true);
    sim.state.tick += 120; bot.think(sim); expect(recovering(bot)).toBe(false);
  });

  it('does not cast on newly observed threats before the difficulty reaction delay', async () => {
    const sim = await makeSim(3);
    const h = hero(sim, 0); const enemy = hero(sim, 1);
    place(h, {x: 0, z: 0}); place(enemy, {x: 5, z: 0});
    h.hp = h.maxHp * 0.2; enemy.hp = enemy.maxHp * 0.4;
    const bot = new HeroBot({team: 0, slotIndex: 0, difficulty: 'low', seed: 1});
    expect(bot.think(sim).some(c => c.type === 'cast')).toBe(false);
    sim.state.tick = 60;
    expect(bot.think(sim).some(c => c.type === 'cast')).toBe(true);
  });

  it('retains seeded difficulty mistakes rather than granting low-health perfect decisions', async () => {
    const sim = await makeSim(3); hero(sim, 0).hp = 100;
    const bot = new HeroBot({team: 0, slotIndex: 0, difficulty: 'low', seed: 11});
    bot.think(sim);
    expect(recovering(bot)).toBe(false);
    expect((bot as unknown as { intent: string }).intent).toBe('fight');
    const rng = (bot as unknown as { rng: { next(): number } }).rng;
    vi.spyOn(rng, 'next').mockReturnValue(0.5);
    sim.state.tick += 120; bot.think(sim);
    expect((bot as unknown as { intent: string }).intent).toBe('retreat');
    expect(recovering(bot)).toBe(true);
    vi.mocked(rng.next).mockReturnValueOnce(0.01);
    sim.state.tick += 120; bot.think(sim);
    expect(recovering(bot)).toBe(true);
  });

  it('clears commitment on death and emits no commands after terminal state', async () => {
    const sim = await makeSim(3); const h = hero(sim, 0); const bot = botFor(0);
    h.hp = h.maxHp * 0.2; bot.think(sim); expect(recovering(bot)).toBe(true);
    h.alive = false; expect(bot.think(sim)).toEqual([]); expect(recovering(bot)).toBe(false);
    h.alive = true; sim.state.status = 'timeout'; expect(bot.think(sim)).toEqual([]);
  });

  it('records v3 and replays ordinary input commands deterministically', async () => {
    const navigation = await testNavigation();
    const match = runBotMatch({seed: 136, contentVersion: 3, navigation, blueDifficulty: 'normal', redDifficulty: 'normal', maxMatchSeconds: 120});
    expect(match.replay.contentVersion).toBe(3);
    expect(replayMatch(match.replay, navigation).hashMatches).toBe(true);
  });
});
