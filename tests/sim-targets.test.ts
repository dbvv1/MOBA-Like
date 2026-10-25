import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { verifyTargets } from '../tools/sim-targets.js';
import type { TargetReport } from '../tools/sim-targets.js';
const normal = (): TargetReport => ({options:{blueDifficulty:'normal',redDifficulty:'normal',blueHero:'veyra',redHero:'veyra'},attempted:200,completed:200,errors:0,timeouts:0,blueWins:100,redWins:100,blueWinCi95:[0.43,0.57],durations:{median:600},stuckEvents:0,replayChecked:3,replayMismatches:0});
describe('explicit simulation target profiles', () => {
  it.each([480, 720])('accepts inclusive duration boundary %s', median => expect(verifyTargets({...normal(),durations:{median}},'normal').passed).toBe(true));
  it.each([479.999, 720.001])('rejects duration outside boundary %s', median => expect(verifyTargets({...normal(),durations:{median}},'normal').passed).toBe(false));
  it('CLI preserves timeout reports but fails only when explicit target verification is requested', () => {
    const args=['--import','tsx','tools/sim.ts','--games','1','--seed','1','--max-seconds','1','--json'];
    const explore=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
    const verify=spawnSync(process.execPath,[...args,'--verify-targets','normal'],{encoding:'utf8',timeout:10000});
    expect(explore.status).toBe(0); expect(verify.status).toBe(1);
    expect(JSON.parse(explore.stdout).timeouts).toBe(1);
    const report=JSON.parse(verify.stdout); expect(report.timeouts).toBe(1);
    expect(report.verification.passed).toBe(false);
    expect(report.verification.checks.find((c: {target:string})=>c.target==='timeouts').passed).toBe(false);
  });
  it('passes a complete normal 200-game report', () => expect(verifyTargets(normal(),'normal').passed).toBe(true));
  it.each(['errors','timeouts','stuckEvents','replayMismatches'] as const)('fails %s without removing the reported failure', field => {
    const r=normal();r[field]=1;expect(verifyTargets(r,'normal').passed).toBe(false);expect(r[field]).toBe(1);
  });
  it('requires enough games, complete outcomes, measured replays and an in-range median', () => {
    for(const changes of [{attempted:199},{completed:199},{replayChecked:0},{durations:{median:479}},{durations:{median:721}},{durations:{median:NaN}}])expect(verifyTargets({...normal(),...changes},'normal').passed).toBe(false);
  });
  it('requires 500 games and a mirror interval covering 50%', () => {
    expect(verifyTargets(normal(),'mirror').passed).toBe(false);
    const r={...normal(),attempted:500,completed:500,blueWins:250,redWins:250};
    expect(verifyTargets(r,'mirror').passed).toBe(true);
    r.blueWinCi95=[0.51,0.59];expect(verifyTargets(r,'mirror').passed).toBe(false);
  });
  it('keeps timeouts in the high-difficulty denominator and handles either side', () => {
    const r=normal();r.options.blueDifficulty='high';r.options.redDifficulty='low';
    r.blueWins=159;r.redWins=40;r.timeouts=1;r.completed=199;
    const check=verifyTargets(r,'difficulty').checks.find(c=>c.target==='highDifficultyWinRate');
    expect(check?.actual).toBe('0.795');expect(check?.passed).toBe(false);
    r.blueWins=160;r.redWins=40;r.timeouts=0;r.completed=200;expect(verifyTargets(r,'difficulty').passed).toBe(true);
    r.options.blueDifficulty='low';r.options.redDifficulty='high';r.redWins=160;r.blueWins=40;expect(verifyTargets(r,'difficulty').passed).toBe(true);
  });
  it('rejects mismatched heroes and normal-low mislabeled as high-low', () => {
    const r=normal();r.options.redHero='morrow';expect(verifyTargets(r,'normal').passed).toBe(false);
    r.options.redHero='veyra';r.options.redDifficulty='low';expect(verifyTargets(r,'difficulty').passed).toBe(false);
  });
});
