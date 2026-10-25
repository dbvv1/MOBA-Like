import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { variants } from './validate.mjs';

const cli = fileURLToPath(new URL('./validate.mjs', import.meta.url));
function run(args = []) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test('all three actual GLBs receive full resource validation', () => {
  const { status, report } = run();
  assert.equal(status, 0);
  assert.equal(report.exit, 0);
  assert.deepEqual(report.results.map(r => r.input), variants);
  for (const r of report.results) {
    assert.equal(r.issues.numErrors, 0);
    assert.equal(r.issues.truncated, false);
    assert.equal(r.externalRequests, 0);
    assert.equal(r.info.animationCount, 3);
    assert.equal(r.info.hasSkins, true);
    assert.ok(r.info.resources.some(resource => resource.storage === 'glb'));
  }
});

test('truncated original GLB fails the real CLI with validator errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gltf-negative-'));
  try {
    for (const name of variants) {
      await copyFile(new URL(`../placeholder/assets/${name}`, import.meta.url), join(dir, name));
    }
    // Original 12-byte GLB header: declares a JSON chunk that is absent.
    await writeFile(join(dir, 'blue.glb'), Buffer.from('676c54460200000020000000', 'hex'));
    const { status, report } = run(['--assets-dir', dir]);
    assert.equal(status, 1);
    assert.equal(report.exit, 1);
    assert.equal(report.results.length, 3);
    assert.ok(report.results[0].issues.numErrors > 0);
    assert.ok(report.results[0].issues.messages.some(m => m.code === 'GLB_LENGTH_MISMATCH'));
    assert.equal(report.results[1].issues.numErrors, 0);
    assert.equal(report.results[2].issues.numErrors, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('empty directory rejects all three missing inputs instead of passing zero files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gltf-missing-'));
  try {
    const { status, report } = run(['--assets-dir', dir]);
    assert.equal(status, 1);
    assert.equal(report.exit, 1);
    assert.deepEqual(report.results.map(r => r.failure), ['ENOENT', 'ENOENT', 'ENOENT']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
