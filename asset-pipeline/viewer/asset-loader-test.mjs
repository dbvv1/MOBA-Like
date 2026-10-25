import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetLoader } from './asset-loader.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('failed loads retry; successful assets share a cached request', async () => {
  let calls = 0;
  const select = createAssetLoader(async () => {
    if (++calls === 1) throw new Error('temporary failure');
    return {name: 'blue'};
  });
  await assert.rejects(select('blue'), /temporary failure/);
  const asset = await select('blue');
  assert.equal(await select('blue'), asset);
  assert.equal(calls, 2);
});

test('obsolete success or failure cannot replace the newest selection', async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const select = createAssetLoader(key => key === 'old' ? old.promise : Promise.resolve({name: key}));
    const stale = select('old');
    const latest = await select('new');
    if (fail) old.reject(new Error('old request failed')); else old.resolve({name: 'old'});
    assert.equal(await stale, null);
    assert.deepEqual(latest, {name: 'new'});
  }
});
