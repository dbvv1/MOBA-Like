import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./consumer.mjs', import.meta.url));
function run(args = []) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { status: result.status, report: JSON.parse(result.stdout) };
}
test('whole scene translation and scale move animated skin points and bones together', () => {
  const { status, report } = run();
  assert.equal(status, 0);
  assert.equal(report.exit, 0);
  assert.equal(report.threePackage, '0.186.1');
  assert.equal(report.results.length, 9);
  for (const r of report.results) {
    assert.equal(r.pass, true);
    assert.ok(r.vertices >= 2340);
    assert.ok(r.weightedBones.includes('Hand_R'));
  }
});
test('mesh-only transform fails the independent whole-character expectation', () => {
  const { status, report } = run(['--mesh-only']);
  assert.equal(status, 1);
  assert.equal(report.exit, 1);
  assert.equal(report.results.length, 3);
  for (const r of report.results) {
    assert.equal(r.pass, false);
    assert.ok(r.maxVertexError > 1);
    assert.ok(r.maxBoneError > 1);
  }
});
