import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbilityDefinition, ContentVersion, Difficulty } from '../src/content/types.js';
import { getContent } from '../src/content/index.js';
import {
  createDetourNavigation,
  replayMatch,
  runBotMatch,
} from '../src/sim/index.js';
import type { AbilityStats, Replay, SimStatus } from '../src/sim/types.js';

interface CliOptions {
  games: number;
  seed: number;
  contentVersion: ContentVersion;
  blueDifficulty: Difficulty;
  redDifficulty: Difficulty;
  blueHero: string;
  redHero: string;
  maxSeconds: number | null;
  replayCount: number;
  dumpReplay: string | null;
  json: boolean;
}

interface GameRecord {
  seed: number;
  status: SimStatus | 'error';
  winner: number | null;
  durationSeconds: number;
  stuckEvents: number;
  commandRejections: number;
  rejectionReasons: Record<string, number>;
  abilities: Record<string, AbilityStats>;
  blueHero: string;
  redHero: string;
  totalDamage: number;
  finalHash: string;
  error: string | null;
}

interface AggregateResult {
  options: CliOptions;
  attempted: number;
  completed: number;
  errors: number;
  timeouts: number;
  blueWins: number;
  redWins: number;
  blueWinRate: number;
  blueWinCi95: [number, number];
  highDifficultyWinRate: number | null;
  durations: { min: number; median: number; mean: number; p95: number; max: number };
  stuckEvents: number;
  gamesWithStuck: number;
  commandRejections: number;
  rejectionReasons: Record<string, number>;
  replayChecked: number;
  replayMismatches: number;
  firstMatchHash: string | null;
  firstReplayExpectedHash: string | null;
  firstReplayActualHash: string | null;
  abilityRows: {
    id: string;
    name: string;
    casts: number;
    hitCasts: number;
    hitRate: number;
    heroHits: number;
    damage: number;
    heroDamage: number;
    damageShare: number;
  }[];
  failureSamples: { seed: number; status: string; durationSeconds: number; error: string | null }[];
  stuckSamples: { seed: number; entityName: string; seconds: number; x: number; z: number }[];
  commandRejectionSamples: string[];
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    games: 1,
    seed: 1,
    contentVersion: 2,
    blueDifficulty: 'normal',
    redDifficulty: 'normal',
    blueHero: 'veyra',
    redHero: 'veyra',
    maxSeconds: null,
    replayCount: 3,
    dumpReplay: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      index += 1;
      return value;
    };
    switch (arg) {
      case '--games':
        options.games = positiveInt(next(), '--games');
        break;
      case '--seed':
        options.seed = nonNegativeInt(next(), '--seed');
        break;
      case '--content-version': {
        const version = positiveInt(next(), '--content-version');
        if (version !== 1 && version !== 2) {
          throw new Error('--content-version must be 1 or 2');
        }
        options.contentVersion = version;
        break;
      }
      case '--blue-difficulty':
        options.blueDifficulty = difficulty(next());
        break;
      case '--red-difficulty':
        options.redDifficulty = difficulty(next());
        break;
      case '--blue-hero':
        options.blueHero = next();
        break;
      case '--red-hero':
        options.redHero = next();
        break;
      case '--max-seconds':
        options.maxSeconds = positiveInt(next(), '--max-seconds');
        break;
      case '--replay-count':
        options.replayCount = nonNegativeInt(next(), '--replay-count');
        break;
      case '--dump-replay':
        options.dumpReplay = next();
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function difficulty(value: string): Difficulty {
  if (value === 'low' || value === 'normal' || value === 'high') {
    return value;
  }
  throw new Error('difficulty must be low, normal or high');
}

function printHelp(): void {
  console.log(`Usage: npm run sim -- [options]

  --games <N>              number of headless matches (default 1)
  --seed <S>               base seed (default 1)
  --content-version <1|2>  content catalog (default 2)
  --blue-difficulty <low|normal|high>
  --red-difficulty <low|normal|high>
  --blue-hero <id>         default veyra
  --red-hero <id>          default veyra
  --max-seconds <N>        override the 20-minute hard cap
  --replay-count <N>       verify this many replays (default 3)
  --dump-replay <path>     write the first match replay as JSON
  --json                   emit machine-readable output
`);
}

function wilsonInterval(wins: number, total: number): [number, number] {
  if (total === 0) {
    return [0, 1];
  }
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index] ?? 0;
}

function aggregate(
  options: CliOptions,
  records: readonly GameRecord[],
  replayChecked: number,
  replayMismatches: number,
  firstMatchHash: string | null,
  firstReplayExpectedHash: string | null,
  firstReplayActualHash: string | null,
  stuckSamples: AggregateResult['stuckSamples'],
  commandRejectionSamples: string[],
): AggregateResult {
  const attempted = records.length;
  const completed = records.filter((record) => record.error === null && record.status !== 'timeout').length;
  const timeouts = records.filter((record) => record.status === 'timeout' && record.error === null).length;
  const errors = records.filter((record) => record.error !== null).length;
  const blueWins = records.filter((record) => record.status === 'blueWin').length;
  const redWins = records.filter((record) => record.status === 'redWin').length;
  const durations = records
    .filter((record) => record.error === null)
    .map((record) => record.durationSeconds)
    .sort((a, b) => a - b);
  const stuckEvents = records.reduce((sum, record) => sum + record.stuckEvents, 0);
  const gamesWithStuck = records.filter((record) => record.stuckEvents > 0).length;
  const commandRejections = records.reduce((sum, record) => sum + record.commandRejections, 0);
  const rejectionReasons: Record<string, number> = {};
  for (const record of records) {
    for (const [reason, count] of Object.entries(record.rejectionReasons)) {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
    }
  }

  let highDifficultyWinRate: number | null = null;
  if (options.blueDifficulty !== options.redDifficulty) {
    const highSide = options.blueDifficulty === 'high' ? 0 : 1;
    const highWins = records.filter((record) => record.winner === highSide).length;
    highDifficultyWinRate = attempted > 0 ? highWins / attempted : 0;
  }

  const abilityTotals = new Map<string, AbilityStats>();
  for (const record of records) {
    for (const [id, stats] of Object.entries(record.abilities)) {
      const total = abilityTotals.get(id) ?? {
        casts: 0,
        hitCasts: 0,
        heroHits: 0,
        damage: 0,
        heroDamage: 0,
      };
      total.casts += stats.casts;
      total.hitCasts += stats.hitCasts;
      total.heroHits += stats.heroHits;
      total.damage += stats.damage;
      total.heroDamage += stats.heroDamage;
      abilityTotals.set(id, total);
    }
  }
  const totalAbilityDamage = [...abilityTotals.values()].reduce((sum, stats) => sum + stats.damage, 0);
  const content = getContent(options.contentVersion);
  const abilityRows = [...abilityTotals.entries()]
    .filter(([, stats]) => stats.casts > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, stats]) => {
      const definition = content.abilities[id] as AbilityDefinition | undefined;
      return {
        id,
        name: definition?.name ?? id,
        casts: stats.casts,
        hitCasts: stats.hitCasts,
        hitRate: stats.casts > 0 ? stats.hitCasts / stats.casts : 0,
        heroHits: stats.heroHits,
        damage: stats.damage,
        heroDamage: stats.heroDamage,
        damageShare: totalAbilityDamage > 0 ? stats.damage / totalAbilityDamage : 0,
      };
    });

  const failureSamples = records
    .filter((record) => record.error !== null || record.status === 'timeout')
    .slice(0, 10)
    .map((record) => ({
      seed: record.seed,
      status: record.status,
      durationSeconds: record.durationSeconds,
      error: record.error,
    }));

  return {
    options,
    attempted,
    completed,
    errors,
    timeouts,
    blueWins,
    redWins,
    blueWinRate: attempted > 0 ? blueWins / attempted : 0,
    blueWinCi95: wilsonInterval(blueWins, attempted),
    highDifficultyWinRate,
    durations: {
      min: durations[0] ?? 0,
      median: percentile(durations, 0.5),
      mean: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p95: percentile(durations, 0.95),
      max: durations[durations.length - 1] ?? 0,
    },
    stuckEvents,
    gamesWithStuck,
    commandRejections,
    rejectionReasons,
    replayChecked,
    replayMismatches,
    firstMatchHash,
    firstReplayExpectedHash,
    firstReplayActualHash,
    abilityRows,
    failureSamples,
    stuckSamples,
    commandRejectionSamples,
  };
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}m ${rest.toFixed(1)}s`;
}

function printReport(result: AggregateResult): void {
  const o = result.options;
  console.log('MOBA-Like headless simulation');
  console.log(
    `content=v${o.contentVersion} seed=${o.seed} games=${result.attempted} heroes=${o.blueHero}/${o.redHero} difficulty=${o.blueDifficulty}/${o.redDifficulty}`,
  );
  console.log(
    `status: blue=${result.blueWins} red=${result.redWins} timeout=${result.timeouts} error=${result.errors} completed=${result.completed}`,
  );
  console.log(
    `blue win rate=${(result.blueWinRate * 100).toFixed(2)}% Wilson95=[${(result.blueWinCi95[0] * 100).toFixed(2)}%, ${(result.blueWinCi95[1] * 100).toFixed(2)}%]`,
  );
  if (result.highDifficultyWinRate !== null) {
    console.log(`high-difficulty win rate=${(result.highDifficultyWinRate * 100).toFixed(2)}%`);
  }
  console.log(
    `duration: min=${formatSeconds(result.durations.min)} median=${formatSeconds(result.durations.median)} mean=${formatSeconds(result.durations.mean)} p95=${formatSeconds(result.durations.p95)} max=${formatSeconds(result.durations.max)}`,
  );
  console.log(
    `diagnostics: stuckEvents=${result.stuckEvents} gamesWithStuck=${result.gamesWithStuck} commandRejections=${result.commandRejections}`,
  );
  if (Object.keys(result.rejectionReasons).length > 0) {
    console.log(
      `rejection reasons: ${Object.entries(result.rejectionReasons)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(' ')}`,
    );
  }
  console.log(
    `replay: checked=${result.replayChecked} mismatches=${result.replayMismatches}`,
  );
  if (result.firstMatchHash !== null) {
    console.log(
      `hashes: first=${result.firstMatchHash} replayExpected=${result.firstReplayExpectedHash ?? '-'} replayActual=${result.firstReplayActualHash ?? '-'}`,
    );
  }
  if (result.failureSamples.length > 0) {
    console.log('failure samples:');
    for (const sample of result.failureSamples) {
      console.log(
        `  seed=${sample.seed} status=${sample.status} duration=${sample.durationSeconds.toFixed(3)} error=${sample.error ?? '-'}`,
      );
    }
  }
  if (result.stuckSamples.length > 0) {
    console.log('stuck samples:');
    for (const sample of result.stuckSamples) {
      console.log(
        `  seed=${sample.seed} entity=${sample.entityName} seconds=${sample.seconds.toFixed(1)} at=${sample.x.toFixed(1)},${sample.z.toFixed(1)}`,
      );
    }
  }
  if (result.commandRejectionSamples.length > 0) {
    console.log('command rejection samples:');
    for (const sample of result.commandRejectionSamples) {
      console.log(`  ${sample}`);
    }
  }
  console.log('abilities: id | casts | hitCasts | hitRate | heroHits | damage | heroDamage | damageShare');
  for (const row of result.abilityRows) {
    console.log(
      `${row.id} ${row.name} | ${row.casts} | ${row.hitCasts} | ${(row.hitRate * 100).toFixed(1)}% | ${row.heroHits} | ${row.damage.toFixed(0)} | ${row.heroDamage.toFixed(0)} | ${(row.damageShare * 100).toFixed(1)}%`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const content = getContent(options.contentVersion);
  if (!content.heroes[options.blueHero]) {
    throw new Error(`content v${options.contentVersion} has no hero '${options.blueHero}'`);
  }
  if (!content.heroes[options.redHero]) {
    throw new Error(`content v${options.contentVersion} has no hero '${options.redHero}'`);
  }

  const navData = await readFile(
    resolve(fileURLToPath(new URL('../src/sim/nav/lane.navmesh', import.meta.url))),
  );
  const navigation = await createDetourNavigation(navData);
  const records: GameRecord[] = [];
  const stuckSamples: AggregateResult['stuckSamples'] = [];
  const rejectionSamples: string[] = [];
  let replayChecked = 0;
  let replayMismatches = 0;
  let firstReplay: Replay | null = null;
  let firstMatchHash: string | null = null;
  let firstReplayExpectedHash: string | null = null;
  let firstReplayActualHash: string | null = null;

  try {
    for (let index = 0; index < options.games; index += 1) {
      const seed = (options.seed + index) >>> 0;
      try {
        const match = runBotMatch({
          seed,
          contentVersion: options.contentVersion,
          navigation,
          blueDifficulty: options.blueDifficulty,
          redDifficulty: options.redDifficulty,
          heroIdsByTeam: [[options.blueHero], [options.redHero]],
          ...(options.maxSeconds !== null ? { maxMatchSeconds: options.maxSeconds } : {}),
        });
        const sim = match.simulation;
        if (firstReplay === null) {
          firstReplay = match.replay;
          firstMatchHash = match.replay.finalHash;
        }
        if (replayChecked < options.replayCount) {
          const verification = replayMatch(match.replay, navigation);
          replayChecked += 1;
          if (firstReplayExpectedHash === null) {
            firstReplayExpectedHash = verification.expectedHash;
            firstReplayActualHash = verification.actualHash;
          }
          if (!verification.hashMatches) {
            replayMismatches += 1;
          }
        }
        const record: GameRecord = {
          seed,
          status: sim.status,
          winner: sim.state.winner,
          durationSeconds: sim.timeSeconds,
          stuckEvents: sim.state.diagnostics.stuckEvents.length,
          commandRejections: sim.state.diagnostics.commandRejections,
          rejectionReasons: sim.state.diagnostics.rejectionReasons,
          abilities: sim.state.stats.abilities,
          blueHero: options.blueHero,
          redHero: options.redHero,
          totalDamage: sim.state.stats.damageByTeam[0] + sim.state.stats.damageByTeam[1],
          finalHash: sim.finalHash(),
          error: null,
        };
        records.push(record);
        if (stuckSamples.length < 5) {
          for (const event of sim.state.diagnostics.stuckEvents) {
            if (stuckSamples.length >= 5) {
              break;
            }
            stuckSamples.push({
              seed,
              entityName: event.entityName,
              seconds: event.secondsStationary,
              x: event.position.x,
              z: event.position.z,
            });
          }
        }
        if (sim.state.diagnostics.commandRejections > 0 && rejectionSamples.length < 5) {
          rejectionSamples.push(`seed=${seed} rejections=${sim.state.diagnostics.commandRejections}`);
        }
      } catch (error) {
        records.push({
          seed,
          status: 'error',
          winner: null,
          durationSeconds: 0,
          stuckEvents: 0,
          commandRejections: 0,
          rejectionReasons: {},
          abilities: {},
          blueHero: options.blueHero,
          redHero: options.redHero,
          totalDamage: 0,
          finalHash: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    navigation.destroy();
  }

  if (options.dumpReplay && firstReplay) {
    await writeFile(options.dumpReplay, `${JSON.stringify(firstReplay, null, 2)}\n`, 'utf8');
  }

  const result = aggregate(
    options,
    records,
    replayChecked,
    replayMismatches,
    firstMatchHash,
    firstReplayExpectedHash,
    firstReplayActualHash,
    stuckSamples,
    rejectionSamples,
  );
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
  if (result.errors > 0 || result.replayMismatches > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
