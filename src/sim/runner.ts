import type { ContentVersion, Difficulty } from '../content/types.js';
import { HeroBot } from './ai.js';
import { deriveSeed } from './rng.js';
import { Simulation } from './simulation.js';
import type { Navigation } from './navigation.js';
import type { Replay, SimCommand, TimedCommand } from './types.js';

export interface BotMatchOptions {
  seed: number;
  contentVersion: ContentVersion;
  navigation: Navigation;
  heroesPerTeam?: number;
  heroIdsByTeam?: readonly [readonly string[], readonly string[]];
  blueDifficulty: Difficulty;
  redDifficulty: Difficulty;
  maxMatchSeconds?: number;
}

export interface BotMatchResult {
  simulation: Simulation;
  replay: Replay;
  commands: TimedCommand[];
  commandCount: number;
}

export function runBotMatch(options: BotMatchOptions): BotMatchResult {
  const heroesPerTeam = options.heroesPerTeam ?? 1;
  const simulation = new Simulation({
    seed: options.seed,
    contentVersion: options.contentVersion,
    navigation: options.navigation,
    ...(options.heroesPerTeam !== undefined ? { heroesPerTeam: options.heroesPerTeam } : {}),
    ...(options.heroIdsByTeam !== undefined ? { heroIdsByTeam: options.heroIdsByTeam } : {}),
    ...(options.maxMatchSeconds !== undefined ? { maxMatchSeconds: options.maxMatchSeconds } : {}),
  });
  const bots: HeroBot[] = [];
  for (const team of [0, 1] as const) {
    for (let slot = 0; slot < heroesPerTeam; slot += 1) {
      bots.push(
        new HeroBot({
          team,
          slotIndex: slot,
          difficulty: team === 0 ? options.blueDifficulty : options.redDifficulty,
          seed: deriveSeed(options.seed, team * 100 + slot + 1),
        }),
      );
    }
  }

  const commands: TimedCommand[] = [];
  const maxTicks = Math.ceil(simulation.config.maxMatchSeconds * simulation.tickRateHz) + 2;
  while (!simulation.isComplete() && simulation.state.tick < maxTicks) {
    const issued: SimCommand[] = [];
    for (const bot of bots) {
      issued.push(...bot.think(simulation));
    }
    const tick = simulation.state.tick + 1;
    for (const command of issued) {
      commands.push({ tick, command });
    }
    simulation.step(issued);
  }

  return {
    simulation,
    replay: simulation.createReplay(commands),
    commands,
    commandCount: commands.length,
  };
}

export interface ReplayVerification {
  expectedHash: string;
  actualHash: string;
  hashMatches: boolean;
  expectedStatus: string;
  actualStatus: string;
  expectedWinner: number | null;
  actualWinner: number | null;
  durationSeconds: number;
}

export function replayMatch(replay: Replay, navigation: Navigation): ReplayVerification {
  if (replay.formatVersion !== 1 && replay.formatVersion !== 2) {
    throw new Error(`unsupported replay format version: ${String(replay.formatVersion)}`);
  }
  if (replay.formatVersion === 1 && replay.commands.some(entry => entry.command.type === 'attackMove')) {
    throw new Error('attackMove requires replay format version 2');
  }
  if (replay.contentVersion !== 1 && replay.contentVersion !== 2 && replay.contentVersion !== 7 && replay.contentVersion !== 8 && replay.contentVersion !== 9) {
    throw new Error(`unknown replay content version: ${String(replay.contentVersion)}`);
  }
  const simulation = new Simulation({
    seed: replay.seed,
    contentVersion: replay.contentVersion,
    navigation,
    heroesPerTeam: replay.heroesPerTeam,
    heroIdsByTeam: replay.heroIdsByTeam,
    maxMatchSeconds: replay.maxMatchSeconds,
  });
  const byTick = new Map<number, SimCommand[]>();
  for (const entry of replay.commands) {
    const list = byTick.get(entry.tick) ?? [];
    list.push(entry.command);
    byTick.set(entry.tick, list);
  }
  const maxTicks = Math.ceil(replay.maxMatchSeconds * simulation.tickRateHz) + 2;
  while (!simulation.isComplete() && simulation.state.tick < maxTicks) {
    const commands = byTick.get(simulation.state.tick + 1) ?? [];
    simulation.step(commands);
  }
  const actualHash = simulation.finalHash();
  return {
    expectedHash: replay.finalHash,
    actualHash,
    hashMatches: actualHash === replay.finalHash,
    expectedStatus: replay.status,
    actualStatus: simulation.status,
    expectedWinner: replay.winner,
    actualWinner: simulation.state.winner,
    durationSeconds: simulation.timeSeconds,
  };
}
