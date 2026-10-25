/** Explicit acceptance profiles; an exploratory run is not an acceptance pass. */
export type TargetProfile = 'normal' | 'mirror' | 'difficulty';
export interface TargetReport {
  options: { blueDifficulty: string; redDifficulty: string; blueHero: string; redHero: string };
  attempted: number; completed: number; errors: number; timeouts: number;
  blueWins: number; redWins: number; blueWinCi95: [number, number];
  durations: { median: number }; stuckEvents: number;
  replayChecked: number; replayMismatches: number;
}
export interface TargetCheck { target: string; passed: boolean; actual: string; required: string }
export interface TargetVerification { profile: TargetProfile; passed: boolean; checks: TargetCheck[] }

export function verifyTargets(report: TargetReport, profile: TargetProfile): TargetVerification {
  const checks: TargetCheck[] = [];
  const check = (target: string, passed: boolean, actual: unknown, required: string) =>
    checks.push({ target, passed, actual: String(actual), required });
  const minimum = profile === 'mirror' ? 500 : 200;
  const o = report.options;
  const sameHero = o.blueHero === o.redHero;
  const highLow = (o.blueDifficulty === 'high' && o.redDifficulty === 'low') ||
    (o.blueDifficulty === 'low' && o.redDifficulty === 'high');
  const scenarioValid = sameHero && (profile === 'difficulty' ? highLow :
    o.blueDifficulty === 'normal' && o.redDifficulty === 'normal');
  check('scenario', scenarioValid, `${o.blueHero}/${o.redHero} ${o.blueDifficulty}/${o.redDifficulty}`,
    profile === 'difficulty' ? 'same hero, high versus low (either side)' : 'same hero, normal versus normal');
  check('sampleSize', report.attempted >= minimum, report.attempted, `>= ${minimum} attempted games`);
  check('errors', report.errors === 0, report.errors, '0');
  check('timeouts', report.timeouts === 0, report.timeouts, '0 (never discard unfinished games)');
  check('completed', report.completed === report.attempted, report.completed, String(report.attempted));
  check('stuckEvents', report.stuckEvents === 0, report.stuckEvents, '0');
  const median = report.durations.median;
  check('medianSeconds', Number.isFinite(median) && median >= 480 && median <= 720, median, '480–720');
  check('replay', report.replayChecked > 0 && report.replayMismatches === 0,
    `${report.replayChecked} checked, ${report.replayMismatches} mismatches`, '>= 1 actually checked, 0 mismatches');
  if (profile === 'mirror') {
    const [low, high] = report.blueWinCi95;
    check('mirrorWilson95', Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high <= 1 && low <= 0.5 && high >= 0.5,
      `[${low}, ${high}]`, 'interval covers 0.5, denominator includes every attempted game');
  }
  if (profile === 'difficulty') {
    const wins = o.blueDifficulty === 'high' ? report.blueWins : report.redWins;
    const rate = report.attempted > 0 ? wins / report.attempted : 0;
    check('highDifficultyWinRate', highLow && rate >= 0.8, rate, '>= 0.8 of all attempted games');
  }
  return { profile, passed: checks.every(item => item.passed), checks };
}
