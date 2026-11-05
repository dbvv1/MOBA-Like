#!/usr/bin/env node
/**
 * Supervising parent for B-MOBA-FIXED-CAPTURE-20261105.
 *
 * The capture harness cannot record its own process exit. This parent starts
 * exactly one harness child, waits for the real ChildProcess close event, then
 * writes report.json, manifest.json, and supervised-exit.json. No capture,
 * browser, or game source is touched here.
 */
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync, readFileSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const TASK_ID = 'B-MOBA-FIXED-CAPTURE-20261105';
const COMMIT = '7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64';
const TREE = '316e1a3a6da5bd40e84faba90adae3ee4ac31533';
const repo = path.resolve(process.env.MOBA_CAPTURE_REPO || process.cwd());
const outDir = path.resolve(process.env.MOBA_CAPTURE_OUT_ROOT || path.join(repo, 'outputs', TASK_ID, '7e1986f-swiftshader'));
const preloadPath = path.join(outDir, 'windows-hide-preload.mjs');
const harnessPath = path.join(outDir, 'harness.mjs');
const now = () => new Date().toISOString();

const supervisor = {
  role: 'supervising-parent',
  pid: process.pid,
  nodeVersion: process.version,
  runtimeStartedAt: new Date(performance.timeOrigin).toISOString(),
  startedAt: now(),
  windowsHidePolicy: 'harness child and all harness descendants receive windowsHide=true through harness.mjs and windows-hide-preload.mjs',
  exitCodeObservation: 'this process exit code is observed by the invoking shell; it cannot record its own post-exit code',
};
const harnessEnv = {
  ...process.env,
  MOBA_CAPTURE_REPO: repo,
  MOBA_CAPTURE_OUT_ROOT: outDir,
  MOBA_CAPTURE_PRELOAD: preloadPath,
  MOBA_CAPTURE_PRELOAD_INJECTED: '1',
  DEBUG: 'pw:browser',
  PW_DEBUG_LOG: path.join(outDir, 'pw-browser.local.log'),
};

let harnessExit = null;
let harnessSpawnError = null;
let harnessLogStream = null;
const startedAt = now();

function publicFailure(entry) {
  if (!entry) return null;
  return {message: entry.message, stack: entry.stack};
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function main() {
  harnessLogStream = createWriteStream(path.join(outDir, 'harness.log'), {flags: 'wx'});
  const child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, harnessPath], {
    cwd: repo,
    env: harnessEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const harnessStartedAt = now();
  child.stdout.on('data', chunk => { harnessLogStream.write(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { harnessLogStream.write(chunk); process.stderr.write(chunk); });
  const exit = await new Promise(resolve => {
    child.once('error', error => resolve({code: null, signal: null, at: now(), error: String(error)}));
    child.once('close', (code, signal) => resolve({code, signal, at: now(), error: null}));
  });
  harnessSpawnError = exit.error;
  harnessExit = {
    pid: child.pid ?? null,
    parentPid: process.pid,
    parentChain: [{pid: process.pid, role: 'supervising-parent'}],
    startedAt: harnessStartedAt,
    endedAt: exit.at,
    exitCode: exit.code ?? null,
    signal: exit.signal ?? null,
    spawnError: exit.error,
    exitSource: 'ChildProcess close event observed by the supervising parent',
    windowsHide: true,
    log: 'harness.log',
    rawDebugLog: 'pw-browser.local.log (local only; not published)',
  };
  harnessLogStream.end();

  const result = await readJson(path.join(outDir, 'capture-result.json'));
  const capturePassed = result?.capturePassed === true && !result?.failure && !harnessSpawnError;
  const cleanExitBaseline = result?.cleanExitBaseline === true
    && harnessExit.exitCode === 0 && harnessExit.signal === null;
  const passed = capturePassed && cleanExitBaseline;
  const status = passed ? 'complete' : (capturePassed ? 'capture-complete, exit-baseline-incomplete' : 'capture-failed');
  const generatedAt = now();

  const processRecords = {
    supervisor: {...supervisor, endedAt: generatedAt},
    harness: harnessExit,
    preloadStubTest: result?.preload?.stubTest ?? null,
    tsc: result?.build?.tsc ?? null,
    build: result?.build?.vite ?? null,
    preview: result?.server ? {
      sameProcess: true, hostPid: result.server.pid, startedAt: result.server.startedAt,
      closeCallbackAt: result.server.closeCallbackAt, httpServerListeningAfterClose: result.server.httpServerListeningAfterClose,
      portClosed: result.server.portClosed, exit: 'same process as harness; no independent preview PID/exit fabricated',
    } : null,
    chromium: result?.chromium ? {
      pid: result.chromium.pid, parentPid: result.chromium.parentPid,
      startedAt: result.chromium.startedAt, endedAt: result.chromium.endedAt,
      creationDateFromOs: result.chromium.creationDateFromOs,
      exitCode: result.chromium.exitCode, exitSignal: result.chromium.exitSignal,
      exitObserved: result.chromium.exitObserved, exitSource: result.chromium.exitSource,
      childrenAtLaunch: result.chromium.childrenAtLaunch, childrenRemaining: result.cleanup?.childrenRemaining ?? null,
    } : null,
  };

  const manifest = {
    taskId: TASK_ID,
    commit: COMMIT,
    tree: TREE,
    generatedAt,
    passed,
    capturePassed,
    cleanExitBaseline,
    complete: passed,
    status,
    captureInvocation: result?.captureInvocation ?? null,
    previousAttempt: result?.previousAttempt ?? null,
    reusedShots: result?.reusedShots ?? null,
    source: result?.source ?? null,
    environment: result?.environment ?? null,
    preload: result?.preload ?? null,
    build: result?.build ?? null,
    bundleChecks: result?.bundleChecks ?? null,
    server: result?.server ? {
      sameProcess: true, host: result.server.host, port: result.server.port, baseUrl: result.server.baseUrl,
      startedAt: result.server.startedAt, closeCallbackAt: result.server.closeCallbackAt,
      httpServerListeningAfterClose: result.server.httpServerListeningAfterClose, portClosed: result.server.portClosed,
    } : null,
    chromium: result?.chromium ?? null,
    shots: result?.shots ?? [],
    comparisons: result?.comparisons ?? [],
    cleanup: result?.cleanup ?? null,
    processRecords,
    failure: result?.failure ?? (harnessSpawnError ? {message: harnessSpawnError, stack: ''} : null),
    externalProcessesObserved: result?.externalProcessesObserved ?? null,
    qualityCapabilities: result?.qualityCapabilities ?? null,
    openIssues: result?.openIssues ?? [],
    redaction: null,
    publicCopy: null,
  };

  const checks = {
    preloadStubPassed: result?.preload?.stubTest?.passed === true,
    tscExit0: result?.build?.tsc?.exitCode === 0,
    buildExit0: result?.build?.vite?.exitCode === 0,
    eightShots: (result?.shots?.length ?? 0) === 8,
    allShotValidationPassed: (result?.shots?.length ?? 0) === 8 && result.shots.every(shot => shot.validation?.passed === true),
    allTakesMatch: (result?.comparisons?.length ?? 0) === 4 && result.comparisons.every(item => item.passed === true),
    softwareRendererEveryShot: (result?.shots?.length ?? 0) === 8 && result.shots.every(shot => shot.rendererEvidence?.rendererClass === 'software'),
    webgl2EveryShot: (result?.shots?.length ?? 0) === 8 && result.shots.every(shot => shot.backend === 'webgl2'),
    servedBundlesMatch: result?.bundleChecks?.start?.mismatchCount === 0 && result?.bundleChecks?.end?.mismatchCount === 0,
    sourceClean: result?.source?.trackedCleanBeforeBuild === true && result?.source?.trackedCleanAfterBuild === true && result?.source?.trackedCleanAfterCapture === true,
    chromiumVersionMatchesPrecheck: result?.environment?.chromium?.launchedVersionMatchesPrecheck === true,
    chromiumExit0: harnessExit.exitCode === 0 && harnessExit.signal === null && result?.chromium?.exitCode === 0 && result?.chromium?.exitObserved === true,
    previewPortClosed: result?.cleanup?.portClosed === true && result?.cleanup?.preview?.httpServerListeningAfterClose === false,
    browserChildrenGone: result?.cleanup?.childrenRemaining?.length === 0,
    harnessExit0: harnessExit.exitCode === 0 && harnessExit.signal === null,
  };

  const report = {
    taskId: TASK_ID,
    commit: COMMIT,
    tree: TREE,
    generatedAt,
    capturePassed,
    cleanExitBaseline,
    passed,
    complete: passed,
    status,
    passedScope: 'capture evidence plus observed build/harness/Chromium exits and owned-resource cleanup',
    captureInvocation: result?.captureInvocation ?? null,
    previousAttempt: result?.previousAttempt ?? null,
    reusedShots: result?.reusedShots ?? null,
    cleanExitBaselineMeaning: 'capturePassed && harness exit code 0 without signal && Chromium exit code 0 without signal && preview port closed && no owned Chromium children remain',
    summary: passed
      ? 'Eight PNGs captured, decoded, and verified; each of four cameras has two identical fresh-context takes; harness, build, and Chromium exited 0.'
      : capturePassed
        ? 'Capture complete and verified, but at least one required exit/cleanup observation is incomplete; see checks and processRecords.'
        : 'Capture failed; see failure, per-shot validation, and processRecords.',
    checks,
    failure: publicFailure(manifest.failure),
    comparisons: result?.comparisons ?? [],
    processRecords,
    cleanup: result?.cleanup ?? null,
    qualityCapabilities: result?.qualityCapabilities ?? null,
    openIssues: result?.openIssues ?? [],
    redaction: null,
    publicCopy: null,
  };

  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {flag: 'wx'});
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), {flag: 'wx'});
  await writeFile(path.join(outDir, 'supervised-exit.json'), JSON.stringify({
    taskId: TASK_ID,
    commit: COMMIT,
    tree: TREE,
    generatedAt,
    supervisor: {...supervisor, endedAt: generatedAt},
    harness: harnessExit,
    outcome: {capturePassed, cleanExitBaseline, passed, status},
    note: 'Written after the supervising parent observed the real harness ChildProcess close event. The supervisor exit code is observed by the invoking shell.',
  }, null, 2), {flag: 'wx'});
  process.exitCode = passed ? 0 : 1;
}

main().catch(async error => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  process.stderr.write(`${message}\n`);
  try {
    if (existsSync(outDir)) {
      await writeFile(path.join(outDir, 'supervisor-fatal.json'), JSON.stringify({
        message, at: now(), supervisor, harnessExit, harnessSpawnError,
      }, null, 2), {flag: 'wx'});
    }
  } catch { /* best effort */ }
  process.exitCode = 1;
});
