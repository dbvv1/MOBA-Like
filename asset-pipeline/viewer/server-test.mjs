import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetServer } from './server.mjs';

async function withServer(run) {
  const server = createAssetServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('serves the real page, modules and three original GLBs on loopback', async () => {
  await withServer(async base => {
    const page = await fetch(`${base}/viewer/index.html`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /type="importmap"/);
    assert.match(html, /viewer.js/);
    for (const id of ['variant', 'action', 'pause']) {
      assert.match(html, new RegExp(`<[^>]+id="${id}"[^>]*\\bdisabled\\b`), `${id} must start disabled until WebGL initializes`);
    }
    const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    const moduleUrl = new URL('./viewer.js', `${base}/viewer/index.html`);
    const moduleResponse = await fetch(moduleUrl);
    assert.equal(moduleResponse.status, 200);
    const source = await moduleResponse.text();
    const specifiers = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.equal(specifiers.length, 3, 'check every actual viewer module import');
    for (const specifier of specifiers) {
      const prefix = Object.keys(map).find(key => key.endsWith('/') && specifier.startsWith(key));
      const mapped = (specifier.startsWith('.') ? specifier : map[specifier]) ?? (prefix ? map[prefix] + specifier.slice(prefix.length) : null);
      assert.ok(mapped, `unmapped import: ${specifier}`);
      const response = await fetch(new URL(mapped, `${base}/viewer/index.html`));
      assert.equal(response.status, 200, specifier);
      assert.equal(response.headers.get('content-type'), 'text/javascript');
      assert.ok((await response.text()).length > 100);
    }
    for (const variant of ['blue', 'amber', 'blue-long']) {
      const response = await fetch(`${base}/placeholder/assets/${variant}.glb`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
      assert.equal(bytes.readUInt32LE(8), bytes.length);
    }
  });
});

test('rejects missing files, unsupported source files, malformed URLs and path escapes', async () => {
  await withServer(async base => {
    for (const path of ['/viewer/missing.js', '/placeholder/assets/blue.blend', '/%ZZ', '/%2e%2e%2fpackage.json', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
  });
});
