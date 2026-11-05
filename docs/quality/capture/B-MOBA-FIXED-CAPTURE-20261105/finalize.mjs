#!/usr/bin/env node
/**
 * Final evidence composition for B-MOBA-FIXED-CAPTURE-20261105.
 *
 * No browser, preview, build, or capture is started here. It reads the one
 * build, the two capture invocations' preserved evidence, and every on-disk
 * PNG/JSON, re-verifies hashes and two-take equality, then writes report.json
 * and manifest.json. It deliberately keeps the capture harness's real exit
 * code 1 visible: the capture run exited 1 after all shots and cleanup because
 * of a post-capture bookkeeping ReferenceError, so cleanExitBaseline is false.
 */
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

const TASK_ID = 'B-MOBA-FIXED-CAPTURE-20261105';
const COMMIT = '7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64';
const TREE = '316e1a3a6da5bd40e84faba90adae3ee4ac31533';
const repo = path.resolve(process.env.MOBA_CAPTURE_REPO || process.cwd());
const outDir = path.resolve(process.env.MOBA_CAPTURE_OUT_ROOT || path.join(repo, 'outputs', TASK_ID, '7e1986f-swiftshader'));
const attempt4 = path.join(outDir, 'attempt-04-gameplay-comparison-bug');
const attempt5 = path.join(outDir, 'attempt-05-resume-postcapture-ref');
const CAMERAS = ['gameplay', 'spawn', 'first-tower', 'spawn-to-tower'];
const now = () => new Date().toISOString();
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const stable = value => {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return '"__undefined__"';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const stableSha = value => sha256(Buffer.from(stable(value)));
const same = (a, b) => stable(a) === stable(b);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function git(args) {
  const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8', windowsHide: true});
  return {status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim()};
}

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full).replaceAll('\\', '/'));
  }
  return files;
}

async function hashTree(dir) {
  const records = [];
  for (const file of await listFiles(dir)) {
    const buf = await readFile(path.join(dir, file));
    records.push({file, bytes: buf.length, sha256: sha256(buf)});
  }
  return records;
}

function pairComparison(a, b) {
  return {
    rgbaSha256: a.rgbaSha256 === b.rgbaSha256,
    pngSha256: a.pngSha256 === b.pngSha256,
    stateHash: a.stateHash === b.stateHash,
    stateStable: a.stateStableSha256 === b.stateStableSha256,
    cameraStable: a.cameraStableSha256 === b.cameraStableSha256,
    rendererStable: a.rendererStableSha256 === b.rendererStableSha256,
    lightingStable: a.lightingStableSha256 === b.lightingStableSha256,
    materialsStable: a.materialsStableSha256 === b.materialsStableSha256,
    seed: a.seed === b.seed,
    input: a.input === b.input && a.input === 'march',
    t: a.t === b.t,
    frame: a.frame === b.frame,
    virtualFrame: a.virtualFrame === b.virtualFrame,
    simTick: a.simTick === b.simTick,
  };
}

async function verifyShot(shot, take) {
  const fileBase = `capture-${shot}-${take}`;
  const json = JSON.parse(await readFile(path.join(outDir, `${fileBase}.json`), 'utf8'));
  assert(json.taskId === TASK_ID && json.commit === COMMIT && json.tree === TREE, `${fileBase} identity mismatch`);
  assert(json.camera === shot && json.take === take, `${fileBase} name/take mismatch`);
  assert(json.validation?.passed === true && json.validation.checks.every(check => check.ok === true), `${fileBase} validation did not pass`);
  assert(json.pageErrors.length === 0 && json.consoleErrors.length === 0 && json.requestFailed.length === 0 && json.httpErrors.length === 0 && json.externalRequests.length === 0 && json.contextLost === false, `${fileBase} has page/resource errors`);
  assert(json.shot.sourceCommit === COMMIT && json.shot.sourceDirty === false, `${fileBase} source identity mismatch`);
  assert(json.shot.bundleSha256 === buildBundle.bundle.sha256, `${fileBase} bundle hash mismatch`);
  const pngBuffer = await readFile(path.join(outDir, `${fileBase}.png`));
  const png = PNG.sync.read(pngBuffer);
  assert(png.width === 1280 && png.height === 720, `${fileBase} PNG is ${png.width}x${png.height}`);
  assert(sha256(pngBuffer) === json.png.sha256, `${fileBase} PNG hash mismatch`);
  assert(sha256(png.data) === json.png.rgbaSha256, `${fileBase} RGBA hash mismatch`);
  const colors = new Set();
  for (let pixel = 0; pixel < png.width * png.height; pixel += 4) {
    const offset = pixel * 4;
    colors.add(((png.data[offset] >> 3) << 10) | ((png.data[offset + 1] >> 3) << 5) | (png.data[offset + 2] >> 3));
  }
  assert(colors.size > 32, `${fileBase} has only ${colors.size} sampled colours`);
  const first = json.shot;
  return {
    camera: shot, take, url: json.url, urlPath: json.urlPath, capturedAt: json.capturedAt, completedAt: json.completedAt,
    pngFile: json.png.file, jsonFile: `${fileBase}.json`,
    pngSha256: json.png.sha256, rgbaSha256: json.png.rgbaSha256,
    stateHash: first.stateHash, stateStableSha256: json.stateStableSha256,
    cameraStableSha256: json.cameraStableSha256, rendererStableSha256: json.rendererStableSha256,
    lightingStableSha256: json.lightingStableSha256, materialsStableSha256: json.materialsStableSha256,
    t: first.t, frame: first.frame, virtualFrame: first.virtualFrame, simTick: first.simTick,
    seed: first.seed, input: first.input, cameraInfo: first.camera,
    rendererEvidence: {renderer: first.renderer, vendor: first.vendor, version: first.version, unmasked: first.unmasked, rendererClass: first.rendererClass},
    lighting: first.lighting, materials: first.materials, standards: first.standards,
    viewport: first.viewport, image: first.image, backend: first.backend, render: first.render,
    sampledColors5bit: colors.size, validation: json.validation,
    sourceInvocation: shot === 'gameplay' ? 'attempt-04 (unchanged; no gameplay retake)' : 'attempt-05',
  };
}

let buildBundle;
async function main() {
  const startedAt = now();
  const previous4 = JSON.parse(await readFile(path.join(attempt4, 'capture-result.json'), 'utf8'));
  const previous5 = JSON.parse(await readFile(path.join(attempt5, 'capture-result.json'), 'utf8'));
  const supervised5 = JSON.parse(await readFile(path.join(attempt5, 'supervised-exit.json'), 'utf8'));
  const buildFiles = JSON.parse(await readFile(path.join(outDir, 'build-files.json'), 'utf8')).files;
  const bundleBytes = await readFile(path.join(outDir, 'capture-bundle.build.json'));
  buildBundle = JSON.parse(bundleBytes.toString('utf8'));
  assert(sha256(bundleBytes) === previous4.build.bundle.manifestSha256, 'build-manifest hash mismatch');
  assert(buildBundle.sourceCommit === COMMIT && buildBundle.sourceDirty === false, 'bundle source mismatch');
  const currentBuildFiles = await hashTree(path.join(repo, 'outputs/capture-build'));
  assert(same(currentBuildFiles, buildFiles), 'outputs/capture-build differs from the single build record');

  const shots = [];
  const comparisons = [];
  for (const camera of CAMERAS) {
    const first = await verifyShot(camera, 1);
    const second = await verifyShot(camera, 2);
    shots.push(first, second);
    const comparison = pairComparison(first, second);
    comparisons.push({camera, same: comparison, passed: Object.values(comparison).every(Boolean)});
  }

  const sourceCleanAfterCapture = git(['status', '--porcelain', '--untracked-files=no']).stdout === '';
  const captureHarnessExit = supervised5.harness;
  const capturePassed = previous4.preload.stubTest.passed === true
    && previous4.build.tsc.exitCode === 0 && previous4.build.vite.exitCode === 0
    && shots.length === 8 && shots.every(shot => shot.validation.passed === true)
    && comparisons.length === 4 && comparisons.every(item => item.passed === true)
    && shots.every(shot => shot.rendererEvidence.rendererClass === 'software' && shot.backend === 'webgl2')
    && previous5.bundleChecks.start.mismatchCount === 0 && previous5.bundleChecks.end.mismatchCount === 0
    && previous4.source.trackedCleanBeforeBuild === true && previous4.source.trackedCleanAfterBuild === true
    && sourceCleanAfterCapture === true
    && previous5.environment.chromium.launchedVersionMatchesPrecheck === true;
  const chromiumExit0 = previous5.chromium.exitCode === 0 && previous5.chromium.exitSignal === null && previous5.chromium.exitObserved === true;
  const previewClosed = previous5.cleanup.portClosed === true && previous5.cleanup.preview.httpServerListeningAfterClose === false;
  const childrenGone = previous5.cleanup.childrenRemaining.length === 0 && previous5.cleanup.knownUnclosedResources === 0;
  const captureHarnessExit0 = captureHarnessExit.exitCode === 0 && captureHarnessExit.signal === null;
  const cleanExitBaseline = chromiumExit0 && previewClosed && childrenGone && captureHarnessExit0;
  const passed = capturePassed && cleanExitBaseline;
  const status = passed ? 'complete' : capturePassed ? 'capture-complete, exit-baseline-incomplete' : 'capture-failed';
  const generatedAt = now();

  const processRecords = {
    finalize: {role: 'evidence-composer', pid: process.pid, nodeVersion: process.version, runtimeStartedAt: new Date(performance.timeOrigin).toISOString(), startedAt, endedAt: generatedAt, exitCodeObservation: 'observed by the invoking shell; this process does not write its own post-exit code'},
    supervisor: supervised5.supervisor,
    captureHarness: captureHarnessExit,
    preloadStubTest: previous4.preload.stubTest,
    tsc: previous4.build.tsc,
    build: previous4.build.vite,
    preview: previous5.server,
    chromium: {
      pid: previous5.chromium.pid, parentPid: previous5.chromium.parentPid, startedAt: previous5.chromium.startedAt,
      endedAt: previous5.chromium.endedAt, creationDateFromOs: previous5.chromium.creationDateFromOs,
      exitCode: previous5.chromium.exitCode, exitSignal: previous5.chromium.exitSignal,
      exitObserved: previous5.chromium.exitObserved, exitSource: previous5.chromium.exitSource,
      childrenAtLaunch: previous5.chromium.childrenAtLaunch, childrenRemaining: previous5.cleanup.childrenRemaining,
    },
  };

  const attempts = [
    {attempt: '01', state: 'preserved-failure', stage: 'pre-capture launch', cause: 'absolute Windows path passed to Node --import; loader requires file:// URL', evidence: 'attempt-01-launch-failed'},
    {attempt: '02', state: 'preserved-failure', stage: 'pre-capture freshness check', cause: 'supervisor-created harness.log not yet in the freshness allowlist', evidence: 'attempt-02-fresh-root-check'},
    {attempt: '03', state: 'preserved-failure', stage: 'pre-capture stub-log parse', cause: 'stub log parser read past JSON into the log trailer', evidence: 'attempt-03-stub-log-parse'},
    {attempt: '04', state: 'preserved-failure; gameplay takes reused', stage: 'two gameplay takes complete, comparison bookkeeping', cause: 'comparison record omitted the input field (undefined === \"march\") while all hashes/state matched', evidence: 'attempt-04-gameplay-comparison-bug'},
    {attempt: '05', state: 'preserved-failure; all eight shots complete', stage: 'after all captures and cleanup, final build-hash assertion', cause: 'ReferenceError: buildFiles is not defined (block-scoped variable)', evidence: 'attempt-05-resume-postcapture-ref'},
    {attempt: 'finalize', state: 'evidence composition only', stage: 'no browser/build/preview', cause: 'reads and re-verifies existing on-disk evidence', evidence: 'finalize.mjs'},
  ];
  const failure = {
    kind: 'post-capture-harness-exit',
    stage: 'final build-hash assertion after all eight shots and owned-resource cleanup',
    message: 'ReferenceError: buildFiles is not defined',
    effect: 'The capture harness process really exited 1. All eight PNG/JSON files and all four two-take comparisons had already passed; Chromium exited 0, the preview port closed and no owned Chromium children remained. cleanExitBaseline is therefore false.',
    publicEvidence: 'capture-harness-exit.json',
    preservedAt: 'attempt-05-resume-postcapture-ref (local only)',
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
    passedScope: 'capture evidence plus observed build/harness/Chromium exits and owned-resource cleanup',
    captureInvocation: 'Gameplay takes come unchanged from attempt-04. The other six shots and all four comparisons come from attempt-05. One tsc/vite build was run (attempt-04) and reused. No capture was retaken. The finalize step started no browser, preview, or build.',
    source: {
      headObserved: previous4.source.headObserved,
      treeObserved: previous4.source.treeObserved,
      headMatchesFixed: previous4.source.headObserved === COMMIT,
      treeMatchesFixed: previous4.source.treeObserved === TREE,
      trackedCleanBeforeBuild: previous4.source.trackedCleanBeforeBuild,
      trackedCleanAfterBuild: previous4.source.trackedCleanAfterBuild,
      trackedCleanAfterCapture: sourceCleanAfterCapture,
      lfPreservedForKeyFiles: previous4.source.lfPreservedForKeyFiles,
    },
    captureWindow: {
      firstShotCapturedAt: shots.reduce((earliest, shot) => shot.capturedAt < earliest ? shot.capturedAt : earliest, shots[0].capturedAt),
      lastShotCompletedAt: shots.reduce((latest, shot) => shot.completedAt > latest ? shot.completedAt : latest, shots[0].completedAt),
      chromiumStartedAt: previous5.chromium.startedAt,
      chromiumEndedAt: previous5.chromium.endedAt,
    },
    environment: previous5.environment,
    preload: previous4.preload,
    build: {
      tsc: previous4.build.tsc,
      vite: previous4.build.vite,
      output: 'outputs/capture-build',
      fileCount: buildFiles.length,
      bundle: previous4.build.bundle,
      filesEvidence: 'build-files.json',
      bundleEvidence: 'capture-bundle.build.json',
      buildExecutedIn: 'attempt-04 (the only tsc/vite build execution)',
    },
    bundleChecks: previous5.bundleChecks,
    server: previous5.server,
    chromium: previous5.chromium,
    shots,
    comparisons,
    cleanup: previous5.cleanup,
    processRecords,
    attempts,
    failure,
    openIssues: [
      'SwiftShader software rendering only; this is not a hardware-GPU baseline.',
      'One fixed seed=1 march state at t=10 per camera, not a full match or live player control.',
      'Audio, feel, reference registration, and picture ranking are not verified by this capture.',
      'MAX_SAMPLES, anisotropy limits, and texture formats are unknown because the page does not expose them and no probe context was created.',
      'The capture harness process really exited 1 after all eight shots and cleanup because of a post-capture bookkeeping ReferenceError; Chromium exited 0, the preview port closed, and no owned children remained. cleanExitBaseline is therefore false and passed is false.',
    ],
    qualityCapabilities: previous5.qualityCapabilities,
    redaction: null,
    publicCopy: null,
  };

  const checks = {
    preloadStubPassed: previous4.preload.stubTest.passed === true,
    tscExit0: previous4.build.tsc.exitCode === 0,
    buildExit0: previous4.build.vite.exitCode === 0,
    eightShots: shots.length === 8,
    allShotValidationPassed: shots.every(shot => shot.validation.passed === true),
    allTakesMatch: comparisons.every(item => item.passed === true),
    softwareRendererEveryShot: shots.every(shot => shot.rendererEvidence.rendererClass === 'software'),
    webgl2EveryShot: shots.every(shot => shot.backend === 'webgl2'),
    servedBundlesMatch: previous5.bundleChecks.start.mismatchCount === 0 && previous5.bundleChecks.end.mismatchCount === 0,
    sourceClean: previous4.source.trackedCleanBeforeBuild === true && previous4.source.trackedCleanAfterBuild === true && sourceCleanAfterCapture === true,
    chromiumVersionMatchesPrecheck: previous5.environment.chromium.launchedVersionMatchesPrecheck === true,
    chromiumExit0,
    previewPortClosed: previewClosed,
    browserChildrenGone: childrenGone,
    captureHarnessExit0,
    finalizeEvidenceConsistent: true,
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
    cleanExitBaselineMeaning: 'capturePassed && capture harness exit code 0 without signal && Chromium exit code 0 without signal && preview port closed && no owned Chromium children remain',
    captureInvocation: manifest.captureInvocation,
    summary: passed
      ? 'Eight PNGs captured, decoded, and verified; each of four cameras has two identical fresh-context takes; harness, build, and Chromium exited 0.'
      : capturePassed
        ? 'Eight PNGs captured, decoded, and verified; each of four cameras has two identical takes. Capture evidence is complete, but the capture harness process exited 1 after all shots and cleanup because of a post-capture bookkeeping ReferenceError; cleanExitBaseline is false.'
        : 'Capture failed; see checks, failure, per-shot validation, and processRecords.',
    checks,
    failure,
    comparisons,
    processRecords,
    attempts,
    cleanup: previous5.cleanup,
    qualityCapabilities: previous5.qualityCapabilities,
    openIssues: manifest.openIssues,
    redaction: null,
    publicCopy: null,
  };

  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {flag: 'wx'});
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), {flag: 'wx'});
  await writeFile(path.join(outDir, 'finalize-run.json'), JSON.stringify({
    taskId: TASK_ID, commit: COMMIT, tree: TREE,
    finalize: processRecords.finalize,
    inputs: ['attempt-04-gameplay-comparison-bug/capture-result.json', 'attempt-05-resume-postcapture-ref/capture-result.json', 'attempt-05-resume-postcapture-ref/supervised-exit.json', 'build-files.json', 'capture-bundle.build.json', 'capture-*.png/json'],
    noBrowserOrPreviewStarted: true,
    outcome: {capturePassed, cleanExitBaseline, passed, status},
  }, null, 2), {flag: 'wx'});
  process.exitCode = capturePassed ? 0 : 1;
}

main().catch(error => {
  console.error(error instanceof Error ? (error.stack || error.message) : String(error));
  process.exitCode = 1;
});
