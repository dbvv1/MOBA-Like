#!/usr/bin/env node
/**
 * One-shot capture harness for B-MOBA-FIXED-CAPTURE-20261105.
 *
 * Runs under Node 24 with the one-run windows-hide preload injected by the
 * supervising parent. It executes, exactly once:
 *   1. the offline preload contract test (no process is started by the test),
 *   2. `tsc -p tsconfig.capture.json`,
 *   3. `vite build --config vite.capture.config.ts`,
 *   4. one Vite preview of outputs/capture-build on a loopback ephemeral port,
 *   5. one headless SwiftShader Chromium launched with launchServer()/connect(),
 *   6. four fixed cameras, two fresh-context takes each.
 *
 * The harness never edits game source, never uses a page screenshot for the
 * scene image, never retries a failed first shot, and never opens a visible
 * window. Exit evidence for this process is written by supervise.mjs after the
 * real ChildProcess exit; this process only records the evidence it can observe
 * while alive.
 */
import {chromium} from 'playwright';
import {preview} from 'vite';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {readFile, writeFile, readdir, mkdir, access} from 'node:fs/promises';
import {existsSync, readFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const TASK_ID = 'B-MOBA-FIXED-CAPTURE-20261105';
const COMMIT = '7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64';
const TREE = '316e1a3a6da5bd40e84faba90adae3ee4ac31533';
const CAPTURE_SIZE = {width: 1280, height: 720, dpr: 1};
const VIEWPORT = {width: 1280, height: 720, pixelRatio: 1, bufferWidth: 1280, bufferHeight: 720};
const LIGHTING = 'forest-light-v1';
const MATERIALS_REQUESTED = 'baseline';
const MATERIALS_CONFIGURED = 'baseline';
const REPLAY = Object.freeze({
  seed: 1,
  input: 'march',
  contentVersion: 11,
  heroesPerTeam: 1,
  heroIds: ['veyra', 'veyra'],
  opponent: {difficulty: 'normal', seed: 1002},
  moveTarget: {x: -18, z: 1.2},
  requestedTime: 10,
  virtualFrame: 600,
  simTick: 300,
  warmupFrames: 12,
  frame: 0,
  frames: 1,
  visualHz: 60,
  simHz: 30,
});
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--enable-automation',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
const CAMERAS = [
  {
    name: 'gameplay',
    query: '?shot=gameplay&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline',
    followPlayer: true,
    expectedCamera: null,
  },
  {
    name: 'spawn',
    query: '?shot=spawn&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline',
    followPlayer: false,
    expectedCamera: {position: {x: -94, y: 24, z: 19.2}, target: {x: -94, y: 0, z: 1.2}, fov: 45},
  },
  {
    name: 'first-tower',
    query: '?shot=first-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline',
    followPlayer: false,
    expectedCamera: {position: {x: -28, y: 24, z: 18}, target: {x: -28, y: 0, z: 0}, fov: 45},
  },
  {
    name: 'spawn-to-tower',
    query: '?shot=spawn-to-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline',
    followPlayer: false,
    expectedCamera: {position: {x: -65, y: 62, z: 46.5}, target: {x: -65, y: 0, z: 0}, fov: 45},
  },
];

const repo = path.resolve(process.env.MOBA_CAPTURE_REPO || process.cwd());
const outDir = path.resolve(process.env.MOBA_CAPTURE_OUT_ROOT || path.join(repo, 'outputs', TASK_ID, '7e1986f-swiftshader'));
const preloadPath = path.resolve(process.env.MOBA_CAPTURE_PRELOAD || path.join(outDir, 'windows-hide-preload.mjs'));
const stubTestPath = path.join(outDir, 'preload-stub-test.mjs');
const chromeExecutable = process.env.MOBA_CAPTURE_CHROMIUM || '';
const RESUME = process.env.MOBA_CAPTURE_RESUME === '1';
const PREVIOUS_RESULT = path.resolve(process.env.MOBA_CAPTURE_PREVIOUS_RESULT || path.join(outDir, 'attempt-04-gameplay-comparison-bug', 'capture-result.json'));
const now = () => new Date().toISOString();
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const roundTrip = value => JSON.parse(JSON.stringify(value));
const approx = (a, b, epsilon = 1e-5) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= epsilon;
const approxPoint = (a, b) => !!a && !!b && approx(a.x, b.x) && approx(a.y, b.y) && approx(a.z, b.z);
const stable = value => {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return '"__undefined__"';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const stableSha = value => sha256(Buffer.from(stable(value)));
const same = (a, b) => stable(a) === stable(b);

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
  const files = await listFiles(dir);
  const records = [];
  for (const file of files) {
    const buf = await readFile(path.join(dir, file));
    records.push({file, bytes: buf.length, sha256: sha256(buf)});
  }
  return records;
}

function snapshotProcesses() {
  const script = [
    'Get-CimInstance Win32_Process | ForEach-Object {',
    '  $d = $null; if ($_.CreationDate) { $d = $_.CreationDate.ToString("o") };',
    '  [pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CreationDate = $d; Name = $_.Name; CommandLine = $_.CommandLine }',
    '} | ConvertTo-Json -Compress',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Process snapshot failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function descendantProcesses(all, rootPid) {
  const children = new Map();
  for (const process of all) {
    if (!children.has(process.ParentProcessId)) children.set(process.ParentProcessId, []);
    children.get(process.ParentProcessId).push(process);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    for (const child of children.get(pid) || []) { out.push(child); stack.push(child.ProcessId); }
  }
  return out;
}

function processType(commandLine) {
  const match = /--type=([^\s]+)/.exec(commandLine || '');
  return match ? match[1] : 'browser';
}

function sanitizeProcess(process) {
  return {pid: process.ProcessId, parentPid: process.ParentProcessId, createdAt: process.CreationDate, name: process.Name, type: processType(process.CommandLine)};
}

async function readChromeVersionInfo(executablePath) {
  assert(existsSync(executablePath), 'MOBA_CAPTURE_CHROMIUM must point to the existing Chrome for Testing binary');
  const script = '$f=$env:MOBA_CAPTURE_CHROMIUM; $i=Get-Item $f; [pscustomobject]@{ FileVersion=$i.VersionInfo.FileVersion; ProductVersion=$i.VersionInfo.ProductVersion; Sha256=(Get-FileHash -Algorithm SHA256 $f).Hash } | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true, encoding: 'utf8', env: {...process.env, MOBA_CAPTURE_CHROMIUM: executablePath},
  });
  if (result.status !== 0) throw new Error(`Chrome VersionInfo read failed: ${result.stderr}`);
  const info = JSON.parse(result.stdout);
  const binary = await readFile(executablePath);
  return {...info, Sha256: info.Sha256 || sha256(binary), versionSource: 'VersionInfo and SHA-256 of the existing binary; chrome.exe --version was not run'};
}

async function verifyDependencies(root = repo) {
  const lockPath = path.join(root, 'package-lock.json');
  const lockBuffer = await readFile(lockPath);
  const packageLockSha256 = sha256(lockBuffer);
  const lock = JSON.parse(lockBuffer.toString('utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const direct = {...manifest.dependencies, ...manifest.devDependencies};
  const problems = [];
  const packages = {};
  for (const name of Object.keys(direct).sort()) {
    const lockVersion = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    let installedVersion = null;
    try {
      installedVersion = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version ?? null;
    } catch { /* reported below */ }
    packages[name] = installedVersion;
    if (!lockVersion) problems.push(`${name} is missing from package-lock.json`);
    else if (!installedVersion) problems.push(`node_modules/${name}/package.json is missing or has no version`);
    else if (installedVersion !== lockVersion) problems.push(`${name}: installed ${installedVersion} != package-lock.json ${lockVersion}`);
  }
  const expectedLockSha256 = process.env.PACKAGE_LOCK_SHA256;
  if (expectedLockSha256 && expectedLockSha256.toLowerCase() !== packageLockSha256) {
    problems.push(`package-lock.json sha256 ${packageLockSha256} != PACKAGE_LOCK_SHA256 ${expectedLockSha256}`);
  }
  assert(problems.length === 0, `dependency verification failed: ${problems.join('; ')}`);
  return {packageLockSha256, packages, verifiedDirectDependencies: Object.keys(direct).sort()};
}

async function spawnLogged(command, args, logFile, extra = {}) {
  const startedAt = now();
  const child = spawn(command, args, {
    cwd: repo,
    windowsHide: true,
    env: {...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`},
    stdio: ['ignore', 'pipe', 'pipe'],
    ...extra,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  let creationDate = null;
  try {
    creationDate = snapshotProcesses().find(process => process.ProcessId === child.pid)?.CreationDate ?? null;
  } catch { /* optional OS timestamp */ }
  const exit = await new Promise(done => {
    child.once('error', error => done({code: null, signal: null, at: now(), error: String(error)}));
    child.once('close', (code, signal) => done({code, signal, at: now()}));
  });
  await writeFile(logFile, `# command: ${path.basename(command)} ${args.slice(1).join(' ')}\n# node: ${process.version}\n# startedAt: ${startedAt}\n# stdout\n${Buffer.concat(stdout).toString('utf8')}\n# stderr\n${Buffer.concat(stderr).toString('utf8')}\n`, {flag: 'wx'});
  return {
    command: `${path.basename(command)} ${args.slice(1).join(' ')}`,
    pid: child.pid ?? null,
    parentPid: process.pid,
    creationDateFromOs: creationDate,
    startedAt,
    endedAt: exit.at ?? now(),
    exitCode: exit.code ?? null,
    signal: exit.signal ?? null,
    spawnError: exit.error ?? null,
    windowsHide: true,
    log: path.basename(logFile),
  };
}

async function runStubTest() {
  const logFile = path.join(outDir, 'preload-stub-test.log');
  const record = await spawnLogged(process.execPath, [stubTestPath], logFile);
  const log = await readFile(logFile, 'utf8');
  let parsed = null;
  try {
    const stdoutMatch = /# stdout\n([\s\S]*?)\n# stderr\n/.exec(log);
    parsed = stdoutMatch ? JSON.parse(stdoutMatch[1]) : null;
  } catch { /* reported below */ }
  const checks = parsed?.checks ?? [];
  const passed = record.exitCode === 0 && parsed?.processesStarted === 0
    && checks.length > 0 && checks.every(check => check.ok === true);
  return {...record, passed, checks, processesStarted: parsed?.processesStarted ?? null};
}

async function runTsc() {
  const record = await spawnLogged(process.execPath, ['--import', pathToFileURL(preloadPath).href, path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.capture.json'], path.join(outDir, 'build-tsc.log'));
  assert(record.exitCode === 0, `tsc exited with code ${record.exitCode}`);
  return record;
}

async function runBuild() {
  const record = await spawnLogged(process.execPath, ['--import', pathToFileURL(preloadPath).href, path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.capture.config.ts'], path.join(outDir, 'build-vite.log'));
  assert(record.exitCode === 0, `vite build exited with code ${record.exitCode}`);
  return record;
}

async function prepareOutputRoot() {
  assert(existsSync(outDir), 'Exclusive output root was not created by the supervising invocation');
  const entries = await readdir(outDir);
  const allowed = new Set([
    'preflight.json', 'windows-hide-preload.mjs', 'preload-stub-test.mjs', 'harness.mjs', 'supervise.mjs',
    'harness.log', 'pw-browser.local.log',
    'build-tsc.log', 'build-vite.log', 'preload-stub-test.log', 'build-files.json', 'capture-bundle.build.json',
    'capture-gameplay-1.png', 'capture-gameplay-1.json', 'capture-gameplay-2.png', 'capture-gameplay-2.json',
  ]);
  const unexpected = entries.filter(name => !allowed.has(name) && !/^attempt-\d\d-[a-z-]+$/.test(name));
  assert(unexpected.length === 0, `Output root is not fresh; unexpected entries: ${unexpected.join(', ')}`);
  const preflight = JSON.parse(await readFile(path.join(outDir, 'preflight.json'), 'utf8'));
  assert(preflight.taskId === TASK_ID, `preflight taskId ${preflight.taskId} != ${TASK_ID}`);
  assert(preflight.commit === COMMIT && preflight.tree === TREE, 'preflight commit/tree mismatch');
  assert(preflight.rootExistedBeforeCreation === false, 'preflight does not prove a fresh root');
  return preflight;
}

async function waitForPortClosed(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise(resolve => {
      const socket = net.connect({host: '127.0.0.1', port});
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
    });
    if (!open) return true;
    await sleep(100);
  }
  return false;
}

async function verifyServedBundle(baseUrl, bundle, localBuildDir) {
  const origin = new URL(baseUrl).origin;
  const checked = [];
  const files = [...bundle.files, {file: 'capture-bundle.json', sha256: null}];
  for (const entry of files) {
    const response = await fetch(new URL(entry.file, baseUrl), {redirect: 'error', cache: 'no-store'});
    if (!response.ok) throw new Error(`served ${entry.file} HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const servedSha256 = sha256(body);
    const localSha256 = sha256(await readFile(path.join(localBuildDir, entry.file)));
    const expected = entry.sha256 ?? localSha256;
    checked.push({file: entry.file, status: response.status, bytes: body.length, servedSha256, localSha256, match: servedSha256 === localSha256 && localSha256 === expected});
  }
  const mismatched = checked.filter(item => !item.match);
  assert(mismatched.length === 0, `served bundle mismatch: ${mismatched.map(item => item.file).join(', ')}`);
  assert(checked.length === bundle.files.length + 1, 'served bundle check did not cover every file');
  return {origin, checkedAt: now(), fileCount: checked.length, files: checked};
}

function cameraChecks(first, camera) {
  const actual = first.camera ?? {};
  const fovOk = approx(actual.fov, 45);
  const aspectOk = approx(actual.aspect, CAPTURE_SIZE.width / CAPTURE_SIZE.height, 1e-6);
  if (camera.followPlayer) {
    const position = actual.position ?? {};
    const target = actual.target ?? {};
    return {
      cameraFov45: fovOk,
      cameraAspect: aspectOk,
      cameraFollowForm: approx(position.y, 24) && approx(position.x, target.x) && approx(position.z, target.z + 18),
      cameraTargetFinite: [target.x, target.y, target.z].every(Number.isFinite) && approx(target.y, 0),
    };
  }
  return {
    cameraFov45: fovOk,
    cameraAspect: aspectOk,
    cameraPositionExact: approxPoint(actual.position, camera.expectedCamera.position),
    cameraTargetExact: approxPoint(actual.target, camera.expectedCamera.target),
  };
}

async function captureOne({browser, camera, take, baseUrl, bundle, localBuildDir, state}) {
  const url = `${baseUrl}/capture.html${camera.query}`;
  const startedAt = now();
  const context = await browser.newContext({
    viewport: {width: CAPTURE_SIZE.width, height: CAPTURE_SIZE.height},
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailed = [];
  const httpErrors = [];
  const externalRequests = [];
  const responses = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => requestFailed.push({url: request.url(), error: request.failure()?.errorText ?? null}));
  await context.addInitScript(() => {
    window.__captureContextLost = false;
    window.addEventListener('webglcontextlost', () => { window.__captureContextLost = true; }, true);
  });
  await context.route('**/*', route => {
    const requestUrl = route.request().url();
    let parsed;
    try { parsed = new URL(requestUrl); } catch { return route.continue(); }
    // Chromium may ask for an implicit favicon. The fixed capture page does not
    // reference one; answer 204 so a browser-generated 404 is not mixed into
    // page/resource error evidence. No game asset is masked by this route.
    if (parsed.origin === new URL(baseUrl).origin && parsed.pathname === '/favicon.ico') return route.fulfill({status: 204, body: ''});
    if (parsed.protocol.startsWith('http') && parsed.origin !== new URL(baseUrl).origin) {
      externalRequests.push(requestUrl);
      return route.abort();
    }
    return route.continue();
  });
  page.on('response', response => {
    if (!response.url().startsWith(new URL(baseUrl).origin)) return;
    const status = response.status();
    if (status >= 400) httpErrors.push({url: response.url(), status});
    const resourceType = response.request().resourceType();
    if (!['document', 'script', 'stylesheet'].includes(resourceType)) return;
    const promise = (async () => {
      let body;
      try { body = await response.body(); } catch (error) { return {url: response.url(), status, resourceType, error: String(error)}; }
      const parsed = new URL(response.url());
      const file = parsed.pathname === '/' ? 'index.html' : decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      let localSha256 = null;
      let localFileExists = false;
      try { localSha256 = sha256(await readFile(path.join(localBuildDir, file))); localFileExists = true; } catch { /* mismatch below */ }
      return {url: response.url(), status, resourceType, file, servedSha256: sha256(body), localFileExists, localSha256, match: localFileExists && sha256(body) === localSha256};
    })();
    responses.push(promise);
  });

  try {
    await page.goto(url, {waitUntil: 'load', timeout: 180000});
    await page.waitForFunction(() => window.__shot && (window.__shot.ready || window.__shot.error), null, {timeout: 120000, polling: 100});
    const first = await page.evaluate(() => window.__shot);
    await page.waitForTimeout(150);
    const second = await page.evaluate(() => window.__shot);
    const contextLost = await page.evaluate(() => window.__captureContextLost === true);
    const mobaClient = await page.evaluate(() => typeof window.mobaClient);
    const resolvedResponses = (await Promise.all(responses)).filter(Boolean);

    if (first?.error) throw new Error(`__shot.error: ${first.error}`);
    assert(first?.ready === true, '__shot.ready is not true');

    const pngPrefix = 'data:image/png;base64,';
    assert(typeof first.pngDataUrl === 'string' && first.pngDataUrl.startsWith(pngPrefix), 'pngDataUrl is missing or not a PNG data URL');
    const pngBuffer = Buffer.from(first.pngDataUrl.slice(pngPrefix.length), 'base64');
    const png = PNG.sync.read(pngBuffer);
    assert(png.width === CAPTURE_SIZE.width && png.height === CAPTURE_SIZE.height, `PNG decoded as ${png.width}x${png.height}`);
    assert(png.data.length === png.width * png.height * 4, 'PNG did not decode to RGBA');

    const colors = new Set();
    for (let pixel = 0; pixel < png.width * png.height; pixel += 4) {
      const offset = pixel * 4;
      colors.add(((png.data[offset] >> 3) << 10) | ((png.data[offset + 1] >> 3) << 5) | (png.data[offset + 2] >> 3));
    }

    const checks = [];
    const check = (name, ok, actual) => { checks.push({name, ok: ok === true, actual}); };
    const localBundleSha256 = bundle.sha256;
    check('ready', first.ready === true, first.ready);
    check('errorEmpty', !first.error, first.error ?? null);
    check('sourceCommitFixed', first.sourceCommit === COMMIT, first.sourceCommit);
    check('sourceDirtyFalse', first.sourceDirty === false, first.sourceDirty);
    check('bundleSha256MatchesBuild', first.bundleSha256 === localBundleSha256, {actual: first.bundleSha256, expected: localBundleSha256});
    check('bundleFilesMatchBuild', same(first.bundle?.files, bundle.files) && first.bundle?.sha256 === bundle.sha256, {files: first.bundle?.files?.length ?? null});
    check('captureRoleGameplay', first.captureRole === 'gameplay', first.captureRole);
    check('shotCorrect', first.shot === camera.name, first.shot);
    check('seed1', first.seed === REPLAY.seed, first.seed);
    check('inputMarch', first.input === REPLAY.input, first.input);
    check('contentVersion11', first.contentVersion === REPLAY.contentVersion, first.contentVersion);
    check('frame0', first.frame === REPLAY.frame, first.frame);
    check('frames1', first.frames === REPLAY.frames, first.frames);
    check('completeTrue', first.complete === true, first.complete);
    check('virtualFrame600', first.virtualFrame === REPLAY.virtualFrame, first.virtualFrame);
    check('simTick300', first.simTick === REPLAY.simTick, first.simTick);
    check('t10', first.t === REPLAY.requestedTime, first.t);
    check('warmupFrames12', first.warmupFrames === REPLAY.warmupFrames, first.warmupFrames);
    check('stateHashPresent', typeof first.stateHash === 'string' && first.stateHash.length > 0, first.stateHash);
    check('backendWebgl2', first.backend === 'webgl2', first.backend);
    check('imageSize', same(first.image, CAPTURE_SIZE), first.image);
    check('viewportSize', same(first.viewport, VIEWPORT), first.viewport);
    check('expectedViewportSize', same(first.expectedViewport, {width: 1280, height: 720}), first.expectedViewport);
    check('rendererClassSoftware', first.rendererClass === 'software', first.rendererClass);
    check('rendererPresent', typeof first.renderer === 'string' && first.renderer.length > 0, first.renderer);
    check('vendorPresent', typeof first.vendor === 'string' && first.vendor.length > 0, first.vendor);
    check('webglVersionPresent', typeof first.version === 'string' && first.version.length > 0, first.version);
    check('unmaskedFlagBoolean', typeof first.unmasked === 'boolean', first.unmasked);
    check('lightingRequested', first.lighting?.requested === LIGHTING, first.lighting?.requested);
    check('lightingConfigured', first.lighting?.configured === LIGHTING, first.lighting?.configured);
    check('lightingActive', first.lighting?.active === LIGHTING, first.lighting?.active);
    check('lightingStage', first.lighting?.stage === 'frame-submitted', first.lighting?.stage);
    check('materialsRequested', first.materials?.requested === MATERIALS_REQUESTED, first.materials?.requested);
    check('materialsConfigured', first.materials?.configured === MATERIALS_CONFIGURED, first.materials?.configured);
    check('materialsActiveNull', first.materials?.active === null, first.materials?.active);
    check('standardsNull', first.standards === null, first.standards);
    check('mobaClientAbsent', mobaClient === 'undefined', mobaClient);
    check('hudWorldBarsOnly', first.hud === 'world-bars-only', first.hud);
    check('audioNotCaptured', first.audio === 'not-captured', first.audio);
    check('renderSubmitted', Number(first.render?.calls) > 0 && Number(first.render?.triangles) > 0, first.render);
    const cameraResult = cameraChecks(first, camera);
    for (const [name, ok] of Object.entries(cameraResult)) check(name, ok, first.camera);
    check('pngSignal', colors.size > 32, {colors: colors.size, sampledEvery: 4});
    check('contextNotLost', contextLost === false, contextLost);
    check('pageErrorsEmpty', pageErrors.length === 0, pageErrors);
    check('consoleErrorsEmpty', consoleErrors.length === 0, consoleErrors);
    check('requestFailedEmpty', requestFailed.length === 0, requestFailed);
    check('httpErrorsEmpty', httpErrors.length === 0, httpErrors);
    check('externalRequestsEmpty', externalRequests.length === 0, externalRequests);
    check('servedResponsesMatch', resolvedResponses.every(record => record.status !== 200 || record.match), resolvedResponses.filter(record => record.status === 200 && !record.match));
    check('entryServed', resolvedResponses.some(record => record.file === 'capture.html' && record.match), resolvedResponses.filter(record => record.file === 'capture.html'));
    check('captureModuleServed', resolvedResponses.some(record => record.resourceType === 'script' && record.match && record.file.includes('assets/')), resolvedResponses.filter(record => record.resourceType === 'script').map(record => record.file));
    const stableFields = ['stateHash', 'seed', 't', 'input', 'virtualFrame', 'frame', 'complete'];
    check('frame0Waited150msStable',
      stableFields.every(field => same(first[field], second[field]))
        && same(first.camera, second.camera) && same(first.renderer, second.renderer)
        && same(first.lighting, second.lighting) && same(first.materials, second.materials)
        && first.pngDataUrl === second.pngDataUrl,
      {stateHashSame: first.stateHash === second.stateHash, pngSame: first.pngDataUrl === second.pngDataUrl});

    const validation = {passed: checks.every(item => item.ok), checks};
    const snapshot = roundTrip(first);
    delete snapshot.pngDataUrl;
    const fileBase = `capture-${camera.name}-${take}`;
    await writeFile(path.join(outDir, `${fileBase}.png`), pngBuffer, {flag: 'wx'});
    await writeFile(path.join(outDir, `${fileBase}.json`), JSON.stringify({
      taskId: TASK_ID, camera: camera.name, take, url, urlPath: `/capture.html${camera.query}`, capturedAt: startedAt, completedAt: now(),
      commit: COMMIT, tree: TREE, replay: REPLAY, expectedCamera: camera.expectedCamera, followPlayer: camera.followPlayer,
      validation, responses: resolvedResponses, pageErrors, consoleErrors, requestFailed, httpErrors, externalRequests, contextLost,
      png: {file: `${fileBase}.png`, width: png.width, height: png.height, bytes: pngBuffer.length, sha256: sha256(pngBuffer), rgbaSha256: sha256(png.data), sampledColors5bit: colors.size},
      stateStableSha256: stableSha(first.stateHash), cameraStableSha256: stableSha(first.camera),
      rendererStableSha256: stableSha({renderer: first.renderer, vendor: first.vendor, version: first.version, unmasked: first.unmasked, rendererClass: first.rendererClass}),
      lightingStableSha256: stableSha(first.lighting), materialsStableSha256: stableSha(first.materials),
      shot: snapshot,
    }, null, 2), {flag: 'wx'});
    if (!validation.passed) throw new Error(`validation failed for ${camera.name} take ${take}: ${checks.filter(item => !item.ok).map(item => item.name).join(', ')}`);

    return {
      camera: camera.name, take, url, urlPath: `/capture.html${camera.query}`, startedAt, completedAt: now(),
      pngFile: `${fileBase}.png`, jsonFile: `${fileBase}.json`,
      pngSha256: sha256(pngBuffer), rgbaSha256: sha256(png.data),
      stateHash: first.stateHash, stateStableSha256: stableSha(first.stateHash), cameraStableSha256: stableSha(first.camera),
      rendererStableSha256: stableSha({renderer: first.renderer, vendor: first.vendor, version: first.version, unmasked: first.unmasked, rendererClass: first.rendererClass}),
      lightingStableSha256: stableSha(first.lighting), materialsStableSha256: stableSha(first.materials),
      t: first.t, frame: first.frame, virtualFrame: first.virtualFrame, simTick: first.simTick,
      seed: first.seed, input: first.input,
      cameraInfo: first.camera, rendererEvidence: {renderer: first.renderer, vendor: first.vendor, version: first.version, unmasked: first.unmasked, rendererClass: first.rendererClass},
      lighting: first.lighting, materials: first.materials, standards: first.standards,
      viewport: first.viewport, image: first.image, backend: first.backend,
      render: first.render, sampledColors5bit: colors.size, validation,
    };
  } finally {
    await context.close();
  }
}

/**
 * Resume support: re-read a previously validated per-shot JSON/PNG without
 * touching the browser. Used only for the two gameplay takes captured before a
 * harness-side comparison-bookkeeping bug stopped the first capture invocation.
 * The files are decoded and re-hashed here; no image is rewritten.
 */
async function reuseExistingShot(camera, take) {
  const fileBase = `capture-${camera.name}-${take}`;
  const json = JSON.parse(await readFile(path.join(outDir, `${fileBase}.json`), 'utf8'));
  assert(json.taskId === TASK_ID && json.commit === COMMIT && json.tree === TREE, 'existing shot task/commit/tree mismatch');
  assert(json.camera === camera.name && json.take === take, 'existing shot name/take mismatch');
  assert(json.validation?.passed === true && Array.isArray(json.validation.checks) && json.validation.checks.every(check => check.ok === true), `existing shot ${fileBase} did not pass all validation checks`);
  assert(json.pageErrors?.length === 0 && json.consoleErrors?.length === 0 && json.requestFailed?.length === 0 && json.httpErrors?.length === 0 && json.externalRequests?.length === 0 && json.contextLost === false, `existing shot ${fileBase} has page/resource errors`);
  const pngBuffer = await readFile(path.join(outDir, `${fileBase}.png`));
  const png = PNG.sync.read(pngBuffer);
  assert(png.width === CAPTURE_SIZE.width && png.height === CAPTURE_SIZE.height, `existing PNG ${fileBase} is ${png.width}x${png.height}`);
  assert(png.data.length === png.width * png.height * 4, 'existing PNG did not decode to RGBA');
  assert(sha256(pngBuffer) === json.png.sha256, `existing PNG ${fileBase} sha256 changed on disk`);
  assert(sha256(png.data) === json.png.rgbaSha256, `existing PNG ${fileBase} RGBA sha256 changed on disk`);
  const colors = new Set();
  for (let pixel = 0; pixel < png.width * png.height; pixel += 4) {
    const offset = pixel * 4;
    colors.add(((png.data[offset] >> 3) << 10) | ((png.data[offset + 1] >> 3) << 5) | (png.data[offset + 2] >> 3));
  }
  assert(colors.size > 32, `existing PNG ${fileBase} has only ${colors.size} sampled colours`);
  const first = json.shot;
  return {
    camera: camera.name, take, url: json.url, urlPath: json.urlPath, startedAt: json.capturedAt, completedAt: json.completedAt,
    pngFile: json.png.file, jsonFile: `${fileBase}.json`,
    pngSha256: json.png.sha256, rgbaSha256: json.png.rgbaSha256,
    stateHash: first.stateHash, stateStableSha256: json.stateStableSha256,
    cameraStableSha256: json.cameraStableSha256, rendererStableSha256: json.rendererStableSha256,
    lightingStableSha256: json.lightingStableSha256, materialsStableSha256: json.materialsStableSha256,
    t: first.t, frame: first.frame, virtualFrame: first.virtualFrame, simTick: first.simTick,
    seed: first.seed, input: first.input,
    cameraInfo: first.camera,
    rendererEvidence: {renderer: first.renderer, vendor: first.vendor, version: first.version, unmasked: first.unmasked, rendererClass: first.rendererClass},
    lighting: first.lighting, materials: first.materials, standards: first.standards,
    viewport: first.viewport, image: first.image, backend: first.backend,
    render: first.render, sampledColors5bit: colors.size, validation: json.validation,
    reused: true, sourceInvocation: 'attempt-04 (unchanged; no gameplay retake)',
  };
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
    input: a.input === b.input && a.input === REPLAY.input && b.input === REPLAY.input,
    t: a.t === b.t,
    frame: a.frame === b.frame,
    virtualFrame: a.virtualFrame === b.virtualFrame,
    simTick: a.simTick === b.simTick,
  };
}

async function main() {
  assert(process.version.startsWith('v24.'), `Harness must run under Node 24, got ${process.version}`);
  const preflight = await prepareOutputRoot();
  // DEBUG=pw:browser writes raw launch/close events to stderr. Mirror stderr to
  // this local-only file after the root is claimed; it is never published.
  const debugLogPath = process.env.PW_DEBUG_LOG || null;
  if (debugLogPath) {
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, encoding, callback) => {
      try { appendFileSync(debugLogPath, typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')); } catch { /* best effort */ }
      return originalStderrWrite(chunk, encoding, callback);
    };
  }
  const harness = {
    taskId: TASK_ID,
    pid: process.pid,
    nodeVersion: process.version,
    runtimeStartedAt: new Date(performance.timeOrigin).toISOString(),
    startedAt: now(),
    cwdIsRepo: path.basename(repo) === 'B-MOBA-FIXED-CAPTURE-20261105',
    debug: process.env.DEBUG || null,
    preloadInjected: process.env.MOBA_CAPTURE_PRELOAD_INJECTED === '1',
  };

  const state = {
    harness,
    preflight,
    commit: COMMIT,
    tree: TREE,
    sourceCleanBeforeBuild: null,
    sourceCleanAfterBuild: null,
    sourceCleanAfterCapture: null,
    headObserved: git(['rev-parse', 'HEAD']).stdout,
    treeObserved: git(['rev-parse', 'HEAD^{tree}']).stdout,
    lfPreserved: null,
    dependencies: null,
    chrome: null,
    preload: null,
    tsc: null,
    build: null,
    buildBundle: null,
    buildFiles: null,
    bundleChecks: {start: null, end: null},
    preview: null,
    chromium: null,
    shots: [],
    comparisons: [],
    cleanup: null,
    failure: null,
    externalProcesses: null,
    previousAttempt: null,
  };

  let browserServer = null;
  let browser = null;
  let server = null;
  let exitInfo = null;
  let exitPromise = null;
  let browserClosedAt = null;

  try {
    state.sourceCleanBeforeBuild = git(['status', '--porcelain', '--untracked-files=no']).stdout === '';
    assert(state.headObserved === COMMIT, `HEAD ${state.headObserved} != ${COMMIT}`);
    assert(state.treeObserved === TREE, `tree ${state.treeObserved} != ${TREE}`);
    assert(state.sourceCleanBeforeBuild, 'tracked worktree is dirty before build');
    const lfFiles = ['capture.html', 'package-lock.json', 'src/capture/client.ts', 'vite.capture.config.ts'];
    state.lfPreserved = lfFiles.every(file => !readFileSyncSafe(path.join(repo, file)).includes('\r\n'));
    assert(state.lfPreserved, 'key source files are not LF-only');
    state.dependencies = await verifyDependencies();
    state.chrome = await readChromeVersionInfo(chromeExecutable);
    const localBuildDir = path.join(repo, 'outputs/capture-build');
    let buildBundle;
    if (RESUME) {
      const previous = JSON.parse(await readFile(PREVIOUS_RESULT, 'utf8'));
      assert(previous.failure && previous.shots?.length === 2 && previous.shots.every(shot => shot.camera === 'gameplay' && shot.validation?.passed === true), 'previous capture result is not the expected two validated gameplay takes');
      state.previousAttempt = {
        resultFile: 'attempt-04-gameplay-comparison-bug/capture-result.json',
        previousFailure: previous.failure.message,
        reusedCamera: 'gameplay',
        reusedShots: 2,
        reason: 'Both gameplay takes passed all 55 capture checks and were byte/state identical; the stop was a harness comparison record that omitted the input field. No gameplay image was retaken.',
      };
      state.preload = previous.preload?.stubTest ? {...previous.preload.stubTest} : null;
      assert(state.preload?.passed === true, 'previous preload stub evidence is missing or failed');
      state.tsc = previous.build?.tsc;
      state.build = previous.build?.vite;
      assert(state.tsc?.exitCode === 0 && state.build?.exitCode === 0, 'previous tsc/build evidence is not exit 0');
      state.sourceCleanBeforeBuild = previous.source?.trackedCleanBeforeBuild ?? null;
      state.sourceCleanAfterBuild = previous.source?.trackedCleanAfterBuild ?? null;
      assert(state.sourceCleanBeforeBuild === true && state.sourceCleanAfterBuild === true, 'previous build source-clean evidence missing');
      state.buildBundle = previous.build?.bundle;
      assert(state.buildBundle?.sourceCommit === COMMIT && state.buildBundle?.sourceDirty === false, 'previous build bundle identity mismatch');
      const bundleBytes = await readFile(path.join(outDir, 'capture-bundle.build.json'));
      assert(sha256(bundleBytes) === state.buildBundle.manifestSha256, 'capture-bundle.build.json hash changed since the one build');
      buildBundle = JSON.parse(bundleBytes.toString('utf8'));
      assert(buildBundle.format === 1 && buildBundle.sourceCommit === COMMIT && buildBundle.sourceDirty === false, 'reused capture-bundle source mismatch');
      assert(Array.isArray(buildBundle.bundle?.files) && buildBundle.bundle.files.length > 0, 'reused capture-bundle has no files');
      const storedFiles = JSON.parse(await readFile(path.join(outDir, 'build-files.json'), 'utf8'));
      const currentFiles = await hashTree(localBuildDir);
      assert(same(currentFiles, storedFiles.files), 'outputs/capture-build changed since the one build');
      state.buildFiles = currentFiles;
      const gameplay = CAMERAS.find(camera => camera.name === 'gameplay');
      let firstReused = null;
      for (const take of [1, 2]) {
        const record = await reuseExistingShot(gameplay, take);
        state.shots.push(record);
        if (take === 1) firstReused = record;
        else {
          const comparison = pairComparison(firstReused, record);
          state.comparisons.push({camera: 'gameplay', same: comparison, passed: Object.values(comparison).every(Boolean), reused: true});
          if (!Object.values(comparison).every(Boolean)) throw new Error(`reused two takes differ for gameplay: ${JSON.stringify(comparison)}`);
        }
      }
    } else {
      state.preload = await runStubTest();
      if (!state.preload.passed) throw new Error(`preload stub test failed: exit ${state.preload.exitCode}`);

      state.tsc = await runTsc();
      state.build = await runBuild();
      state.sourceCleanAfterBuild = git(['status', '--porcelain', '--untracked-files=no']).stdout === '';
      assert(state.sourceCleanAfterBuild, 'tracked worktree is dirty after build');

      const buildFiles = await hashTree(localBuildDir);
      const bundleBytes = await readFile(path.join(localBuildDir, 'capture-bundle.json'));
      buildBundle = JSON.parse(bundleBytes.toString('utf8'));
      assert(buildBundle.format === 1 && buildBundle.sourceCommit === COMMIT && buildBundle.sourceDirty === false, 'capture-bundle.json source mismatch');
      assert(Array.isArray(buildBundle.bundle?.files) && buildBundle.bundle.files.length > 0, 'capture-bundle.json has no files');
      assert(buildFiles.some(record => record.file === 'capture.html'), 'capture.html missing from build');
      state.buildBundle = {format: buildBundle.format, sourceCommit: buildBundle.sourceCommit, sourceDirty: buildBundle.sourceDirty, sha256: buildBundle.bundle.sha256, fileCount: buildBundle.bundle.files.length, manifestSha256: sha256(bundleBytes)};
      state.buildFiles = buildFiles;
      await writeFile(path.join(outDir, 'build-files.json'), JSON.stringify({taskId: TASK_ID, output: 'outputs/capture-build', generatedAt: now(), fileCount: buildFiles.length, files: buildFiles}, null, 2), {flag: 'wx'});
      await writeFile(path.join(outDir, 'capture-bundle.build.json'), bundleBytes, {flag: 'wx'});
    }

    const before = snapshotProcesses();
    state.externalProcesses = before.filter(process => /chrome\.exe|node\.exe/i.test(process.Name || '')).map(sanitizeProcess);

    const previewStartedAt = now();
    server = await preview({
      root: repo,
      configFile: false,
      logLevel: 'error',
      clearScreen: false,
      build: {outDir: 'outputs/capture-build'},
      preview: {host: '127.0.0.1', port: 0, strictPort: true, open: false},
    });
    const address = server.httpServer.address();
    assert(address && typeof address === 'object' && address.port > 0, 'Preview did not expose an ephemeral port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    state.preview = {
      sameProcess: true, pid: process.pid, host: address.address, port: address.port, baseUrl,
      startedAt: previewStartedAt, closeCallbackAt: null, httpServerListeningAfterClose: null, portClosed: null,
    };
    state.bundleChecks.start = await verifyServedBundle(baseUrl, {files: buildBundle.bundle.files, sha256: buildBundle.bundle.sha256}, localBuildDir);

    const launchStartedAt = now();
    browserServer = await chromium.launchServer({
      executablePath: chromeExecutable,
      headless: true,
      chromiumSandbox: false,
      args: LAUNCH_ARGS,
      timeout: 120000,
    });
    const browserProcess = browserServer.process();
    const browserPid = browserProcess.pid;
    exitPromise = new Promise(resolve => {
      if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
        resolve({code: browserProcess.exitCode, signal: browserProcess.signalCode, at: now(), immediate: true});
      } else {
        browserProcess.once('exit', (code, signal) => resolve({code, signal, at: now(), immediate: false}));
      }
    });
    browserServer.once('close', () => { browserClosedAt = now(); });
    const processTree = snapshotProcesses();
    const browserChildren = descendantProcesses(processTree, browserPid).map(sanitizeProcess);
    browser = await chromium.connect(browserServer.wsEndpoint(), {timeout: 120000});
    const browserVersion = browser.version();
    state.chromium = {
      version: browserVersion,
      versionMatchesPrecheck: browserVersion === state.chrome.FileVersion,
      executableSha256: state.chrome.Sha256,
      executableVersionInfo: state.chrome.FileVersion,
      versionSource: state.chrome.versionSource,
      pid: browserPid,
      parentPid: process.pid,
      parentChain: [{pid: process.pid, role: 'harness'}, {pid: process.ppid, role: 'supervising-parent'}],
      startedAt: launchStartedAt,
      creationDateFromOs: processTree.find(process => process.ProcessId === browserPid)?.CreationDate ?? null,
      launch: {headless: true, chromiumSandbox: false, args: LAUNCH_ARGS, ignoreDefaultArgs: false},
      childrenAtLaunch: browserChildren,
      exitCode: null, exitSignal: null, endedAt: null, serverClosedAt: null, debugLog: null,
    };
    assert(state.chromium.versionMatchesPrecheck, `browser.version() ${browserVersion} != prechecked ${state.chrome.FileVersion}`);

    let commandLine = null;
    for (const camera of CAMERAS) {
      if (RESUME && state.shots.some(shot => shot.camera === camera.name)) continue;
      let firstRecord = null;
      for (let take = 1; take <= 2; take++) {
        let record;
        try {
          record = await captureOne({browser, camera, take, baseUrl, bundle: {files: buildBundle.bundle.files, sha256: buildBundle.bundle.sha256}, localBuildDir, state});
        } catch (error) {
          state.failure = {camera: camera.name, take, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? (error.stack || '') : ''};
          throw error;
        }
        state.shots.push(record);
        if (take === 1) {
          firstRecord = record;
        } else {
          const comparison = pairComparison(firstRecord, record);
          state.comparisons.push({camera: camera.name, same: comparison, passed: Object.values(comparison).every(Boolean)});
          if (!Object.values(comparison).every(Boolean)) throw new Error(`two takes differ for ${camera.name}: ${JSON.stringify(comparison)}`);
        }
        if (!commandLine && take === 1) {
          try {
            const cdpContext = await browser.newContext();
            const cdpPage = await cdpContext.newPage();
            const cdp = await cdpContext.newCDPSession(cdpPage);
            commandLine = await cdp.send('Browser.getBrowserCommandLine');
            await cdpContext.close();
          } catch (error) {
            state.chromium.commandLineError = String(error);
          }
        }
      }
    }

    const actualArgs = commandLine?.arguments ?? [];
    const has = predicate => actualArgs.some(predicate);
    state.chromium.actualCommandLine = {
      argumentCount: actualArgs.length,
      headless: has(arg => arg === '--headless' || arg.startsWith('--headless=')),
      noSandbox: has(arg => arg === '--no-sandbox'),
      unsafeSwiftshader: has(arg => arg === '--enable-unsafe-swiftshader'),
      angleSwiftshader: has(arg => arg === '--use-angle=swiftshader'),
      automation: has(arg => arg === '--enable-automation'),
      backgroundTimerThrottlingDisabled: has(arg => arg === '--disable-background-timer-throttling'),
      rendererBackgroundingDisabled: has(arg => arg === '--disable-renderer-backgrounding'),
      occludedBackgroundingDisabled: has(arg => arg === '--disable-backgrounding-occluded-windows'),
      gpuDisabled: has(arg => arg === '--disable-gpu'),
      angleD3d11: has(arg => arg === '--use-angle=d3d11'),
      source: 'Browser.getBrowserCommandLine over CDP; full argv kept local only',
    };
    assert(state.chromium.actualCommandLine.headless, 'actual argv lacks headless');
    assert(state.chromium.actualCommandLine.noSandbox, 'actual argv lacks --no-sandbox');
    assert(state.chromium.actualCommandLine.unsafeSwiftshader, 'actual argv lacks --enable-unsafe-swiftshader');
    assert(state.chromium.actualCommandLine.angleSwiftshader, 'actual argv lacks --use-angle=swiftshader');
    assert(state.chromium.actualCommandLine.automation, 'actual argv lacks --enable-automation');
    assert(!state.chromium.actualCommandLine.gpuDisabled, 'actual argv contains --disable-gpu');
    assert(!state.chromium.actualCommandLine.angleD3d11, 'actual argv contains --use-angle=d3d11');

    const buildFilesAfter = await hashTree(localBuildDir);
    state.bundleChecks.end = await verifyServedBundle(baseUrl, {files: buildBundle.bundle.files, sha256: buildBundle.bundle.sha256}, localBuildDir);
    assert(same(buildFilesAfter, state.buildFiles), 'outputs/capture-build changed during capture');
    state.sourceCleanAfterCapture = git(['status', '--porcelain', '--untracked-files=no']).stdout === '';
  } catch (error) {
    state.failure ??= {message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? (error.stack || '') : ''};
  } finally {
    const cleanup = {startedAt: now(), browser: null, preview: null, childrenRemaining: [], portClosed: null, knownUnclosedResources: 0};
    try {
      if (browser) {
        cleanup.connectionClosedAt = now();
        await browser.close().catch(error => { cleanup.connectionCloseError = String(error); });
      }
      if (browserServer) {
        cleanup.browserServerCloseRequestedAt = now();
        await browserServer.close().catch(error => { cleanup.browserServerCloseError = String(error); });
        const observed = await Promise.race([
          exitPromise ?? Promise.resolve({code: null, signal: null, at: null, immediate: false}),
          sleep(15000).then(() => null),
        ]);
        if (observed) exitInfo = observed;
        else cleanup.browserExitObservation = 'unknown after 15s; no force-kill was attempted';
      }
      if (server) {
        const serverClose = new Promise(resolve => server.httpServer.once('close', () => resolve(now())));
        await server.close().catch(error => { cleanup.previewCloseError = String(error); });
        const closedAt = await Promise.race([serverClose, sleep(10000).then(() => null)]);
        cleanup.preview = {
          sameProcess: true, pid: process.pid, closeCallbackAt: closedAt,
          httpServerListeningAfterClose: server.httpServer.listening,
          closeInvoked: true,
        };
        cleanup.portClosed = await waitForPortClosed(state.preview?.port);
      }
      if (state.chromium?.pid) {
        const finalTree = snapshotProcesses();
        cleanup.childrenRemaining = descendantProcesses(finalTree, state.chromium.pid).map(sanitizeProcess);
      }
    } catch (error) {
      cleanup.error = error instanceof Error ? error.message : String(error);
      cleanup.knownUnclosedResources += 1;
    }
    if (state.chromium) {
      state.chromium.endedAt = exitInfo?.at ?? null;
      state.chromium.exitCode = exitInfo?.code ?? null;
      state.chromium.exitSignal = exitInfo?.signal ?? null;
      state.chromium.serverClosedAt = browserClosedAt;
      state.chromium.exitObserved = !!exitInfo;
      state.chromium.exitSource = exitInfo ? 'owned ChildProcess exit event from BrowserServer.process()' : 'unknown';
      state.chromium.debugLog = parseDebugLog(process.env.PW_DEBUG_LOG || null, state.chromium.pid);
    }
    if (state.preview) {
      state.preview.closeCallbackAt = cleanup.preview?.closeCallbackAt ?? null;
      state.preview.httpServerListeningAfterClose = cleanup.preview?.httpServerListeningAfterClose ?? null;
      state.preview.portClosed = cleanup.portClosed;
    }
    cleanup.endedAt = now();
    state.cleanup = cleanup;
    state.harness.endedAt = now();
  }

  const capturePassed = !state.failure
    && state.preload?.passed === true
    && state.tsc?.exitCode === 0
    && state.build?.exitCode === 0
    && state.shots.length === CAMERAS.length * 2
    && state.comparisons.length === CAMERAS.length
    && state.comparisons.every(item => item.passed)
    && state.shots.every(shot => shot.validation.passed)
    && !!state.bundleChecks.start && !!state.bundleChecks.end
    && state.sourceCleanBeforeBuild === true && state.sourceCleanAfterBuild === true && state.sourceCleanAfterCapture === true
    && state.chromium?.actualCommandLine?.headless === true;
  const cleanExitBaseline = state.chromium?.exitCode === 0 && state.chromium?.exitSignal === null && state.chromium?.exitObserved === true
    && state.cleanup?.portClosed === true && state.cleanup?.preview?.httpServerListeningAfterClose === false
    && state.cleanup?.childrenRemaining?.length === 0 && state.cleanup?.knownUnclosedResources === 0;
  const selfExitCode = capturePassed && cleanExitBaseline ? 0 : 1;

  const result = {
    taskId: TASK_ID,
    commit: COMMIT,
    tree: TREE,
    captureInvocation: RESUME
      ? 'Resume invocation: two gameplay takes reused unchanged from attempt-04; the three remaining cameras captured here. No gameplay retake, no second build.'
      : 'Single capture invocation: tsc, vite build, preview, one Chromium, four cameras twice each.',
    previousAttempt: state.previousAttempt,
    reusedShots: state.shots.filter(shot => shot.reused === true).map(shot => ({camera: shot.camera, take: shot.take, sourceInvocation: shot.sourceInvocation, pngSha256: shot.pngSha256, rgbaSha256: shot.rgbaSha256})),
    harness,
    capturePassed,
    cleanExitBaseline,
    harnessSelfReportedExitCode: selfExitCode,
    source: {
      headObserved: state.headObserved,
      treeObserved: state.treeObserved,
      headMatchesFixed: state.headObserved === COMMIT,
      treeMatchesFixed: state.treeObserved === TREE,
      trackedCleanBeforeBuild: state.sourceCleanBeforeBuild,
      trackedCleanAfterBuild: state.sourceCleanAfterBuild,
      trackedCleanAfterCapture: state.sourceCleanAfterCapture,
      lfPreservedForKeyFiles: state.lfPreserved,
    },
    environment: {
      node: process.version,
      nodePathVersion: process.env.MOBA_CAPTURE_NODE24_VERSION || null,
      chromium: {
        precheckedFileVersion: state.chrome?.FileVersion ?? null,
        precheckedProductVersion: state.chrome?.ProductVersion ?? null,
        precheckedSha256: state.chrome?.Sha256 ?? null,
        versionSource: state.chrome?.versionSource ?? null,
        launchedVersion: state.chromium?.version ?? null,
        launchedVersionMatchesPrecheck: state.chromium?.versionMatchesPrecheck ?? null,
      },
      dependencies: state.dependencies?.packages ?? null,
      dependenciesSource: 'installed node_modules versions, each checked against package-lock.json before the build; no install or upgrade performed',
      packageLockSha256: state.dependencies?.packageLockSha256 ?? null,
    },
    preload: state.preload && {
      file: 'windows-hide-preload.mjs',
      stubTest: {exitCode: state.preload.exitCode, passed: state.preload.passed, processesStarted: state.preload.processesStarted, checks: state.preload.checks, log: state.preload.log, pid: state.preload.pid, startedAt: state.preload.startedAt, endedAt: state.preload.endedAt},
      injection: 'node --import windows-hide-preload.mjs for tsc, vite build, and this harness process',
      coverage: 'public spawn/spawnSync/exec/execSync/execFile/execFileSync/fork overloads plus ChildProcess.prototype.spawn; syncBuiltinESMExports refreshes ESM named exports',
    },
    build: {
      tsc: state.tsc,
      vite: state.build,
      output: 'outputs/capture-build',
      fileCount: state.buildFiles?.length ?? null,
      bundle: state.buildBundle,
      filesEvidence: 'build-files.json',
      bundleEvidence: 'capture-bundle.build.json',
    },
    server: state.preview,
    bundleChecks: state.bundleChecks.start && state.bundleChecks.end ? {
      start: {checkedAt: state.bundleChecks.start.checkedAt, fileCount: state.bundleChecks.start.fileCount, mismatchCount: state.bundleChecks.start.files.filter(item => !item.match).length},
      end: {checkedAt: state.bundleChecks.end.checkedAt, fileCount: state.bundleChecks.end.fileCount, mismatchCount: state.bundleChecks.end.files.filter(item => !item.match).length},
    } : null,
    chromium: state.chromium,
    shots: state.shots,
    comparisons: state.comparisons,
    cleanup: state.cleanup,
    failure: state.failure,
    externalProcessesObserved: state.externalProcesses,
    qualityCapabilities: {
      rendererClass: state.shots[0]?.rendererEvidence?.rendererClass ?? null,
      webglVersion: state.shots[0]?.rendererEvidence?.version ?? null,
      maxSamples: 'unknown',
      maxAnisotropy: 'unknown',
      textureFormats: 'unknown',
      note: 'The capture page does not expose these quality limits and no extra WebGL context was created to probe them.',
    },
    openIssues: [
      'SwiftShader software rendering only; this is not a hardware-GPU baseline.',
      'One fixed seed=1 march state at t=10 per camera, not a full match or live player control.',
      'Audio, feel, reference registration, and picture ranking are not verified by this capture.',
      'MAX_SAMPLES, anisotropy limits, and texture formats are unknown because the page does not expose them and no probe context was created.',
    ],
  };
  await writeFile(path.join(outDir, 'capture-result.json'), JSON.stringify(result, null, 2), {flag: 'wx'});
  process.exitCode = selfExitCode;
}

function readFileSyncSafe(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

function parseDebugLog(logPath, browserPid) {
  if (!logPath || !existsSync(logPath)) return {available: false};
  const text = readFileSyncSafe(logPath);
  const lines = text.split(/\r?\n/);
  const launched = lines.find(line => line.includes('<launched>'));
  const exitLines = lines.filter(line => line.includes('<browser closed>') || line.includes('<kill>') || line.includes('browser process exited'));
  const pidFromLog = launched ? (/(?:pid=)(\d+)/.exec(launched)?.[1] ?? null) : null;
  return {
    available: true,
    hasLaunchingEvent: lines.some(line => line.includes('<launching>')),
    hasLaunchedEvent: !!launched,
    pidFromLog,
    pidMatches: pidFromLog === String(browserPid),
    exitEventCount: exitLines.length,
    localOnly: true,
    redacted: 'raw DEBUG=pw:browser events are kept local and are not part of the public copy',
  };
}

main().catch(async error => {
  console.error(error instanceof Error ? (error.stack || error.message) : String(error));
  try {
    if (existsSync(outDir)) {
      await writeFile(path.join(outDir, 'harness-fatal.json'), JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack || '') : '', at: now(),
      }, null, 2), {flag: 'wx'});
    }
  } catch { /* best effort */ }
  process.exitCode = 1;
});
