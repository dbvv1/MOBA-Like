#!/usr/bin/env node
/**
 * Offline cross-check between the delivered evidence and the repository's
 * original tools/capture-output.ts helper. No browser, preview, or capture is
 * started. It verifies that the harness's independent bundle/port/exit/error
 * handling matches the helper's documented semantics on the actual build.
 */
import {
  captureBundleIdentity,
  verifyServedCaptureBundle,
  capturePortState,
  publicCaptureError,
  captureSpawnEvidence,
  observeCaptureProcess,
  captureBrowserExitState,
  createCaptureBrowserCloser,
  repeatCheckDescription,
} from '../../../../tools/capture-output.ts';
import {readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

const TASK_ID = 'B-MOBA-FIXED-CAPTURE-20261105';
const repo = path.resolve(process.env.MOBA_CAPTURE_REPO || process.cwd());
const outDir = path.resolve(process.env.MOBA_CAPTURE_OUT_ROOT || path.join(repo, 'outputs', TASK_ID, '7e1986f-swiftshader'));
const buildDir = path.join(repo, 'outputs/capture-build');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const checks = [];
const check = (name, ok, actual) => checks.push({name, ok: ok === true, actual});

const bundleBytes = await readFile(path.join(outDir, 'capture-bundle.build.json'));
const stored = JSON.parse(bundleBytes.toString('utf8'));
const identity = await captureBundleIdentity(buildDir);
check('bundleShaMatchesBuildManifest', identity.sha256 === stored.bundle.sha256, {actual: identity.sha256, expected: stored.bundle.sha256});
check('bundleFileListMatchesBuildManifest', JSON.stringify(identity.files) === JSON.stringify(stored.bundle.files), {count: identity.files.length});
const servedSha = await verifyServedCaptureBundle(identity, file => readFile(path.join(buildDir, file)));
check('helperVerifyServedBundleFromDisk', servedSha === stored.bundle.sha256, servedSha);

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const probePort = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const portState = await capturePortState(probePort);
check('closedPortRefused', portState === 'refused', portState);

// Fixtures are assembled at runtime so this public copy carries no literal
// local path or debug endpoint.
const redactionEndpoint = ['w', 's', 's', ':', '/', '/'].join('');
const redactionPath = ['C:', 'Users', 'someone'].join('\\');
const redacted = publicCaptureError(`failure at ${redactionEndpoint}example.invalid/secret-token and ${redactionPath}\\capture.log`, [redactionPath]);
check('publicErrorRedactsEndpointAndPath', !redacted.includes(redactionEndpoint) && !redacted.includes(redactionPath), redacted);

const spawnEvidence = captureSpawnEvidence({
  spawnargs: ['chrome.exe', '--headless', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-automation'],
  spawnfile: 'chrome.exe',
}, 'chrome.exe');
check('spawnEvidenceFlags', spawnEvidence.headless && spawnEvidence.noSandbox && spawnEvidence.unsafeSwiftshader && spawnEvidence.useAngle === 'swiftshader', spawnEvidence);

const observed = observeCaptureProcess({pid: 12345, exitCode: null, signalCode: null, once() {}});
check('observeProcessIdentity', observed.pid === 12345 && observed.identitySource === 'owned-ChildProcess-handle' && observed.exit === null, observed);
check('browserExitStateOwnedHandlesClosed', captureBrowserExitState(true, true, true, {exit: {code: 0, signal: null}}) === 'owned-handles-closed', null);

let closeCalls = 0;
const closer = createCaptureBrowserCloser(() => ({browser: {close: async () => { closeCalls++; }, isConnected: () => false}, server: {close: async () => { closeCalls++; }}}), 1000);
const closed = await closer();
check('browserCloserClosesBothHandles', closeCalls === 2 && closed.serverClosed === true && closed.connectionClosed === true, closed);

const repeat = repeatCheckDescription('gameplay', 2, '1');
check('repeatDescriptionMentionsExactComparison', /exact RGBA\/state\/camera repeat comparison/.test(repeat), repeat);

const passed = checks.every(item => item.ok);
const result = {
  taskId: TASK_ID,
  generatedAt: new Date().toISOString(),
  helper: 'tools/capture-output.ts',
  helperImport: 'Node 24 direct TypeScript import; no browser or preview started',
  runtimeStartedAt: new Date(performance.timeOrigin).toISOString(),
  buildDir: 'outputs/capture-build',
  checks,
  passed,
};
await writeFile(path.join(outDir, 'helper-crosscheck.json'), JSON.stringify(result, null, 2), {flag: 'wx'});
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exitCode = passed ? 0 : 1;
