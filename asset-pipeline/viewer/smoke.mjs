import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createAssetServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reports = resolve(here, 'reports');
const server = createAssetServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const responses = [];
  page.on('requestfailed', request => responses.push(request.failure()?.errorText ?? 'request failed'));
  page.on('response', response => { if (response.status() >= 400) responses.push(response.status()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/viewer/index.html`);
  await page.waitForFunction(() => window.assetPreview?.state().ready);
  await mkdir(reports, { recursive: true });
  const samples = [];
  for (const variant of ['blue', 'amber', 'blue-long']) {
    await page.selectOption('#variant', variant);
    await page.waitForFunction(v => window.assetPreview.state().ready && window.assetPreview.state().variant === v, variant);
    for (const clip of ['idle', 'walk', 'attack']) {
      await page.selectOption('#action', clip);
      await page.evaluate(async ({variant, clip}) => window.assetPreview.pose(variant, clip, 0.3), {variant, clip});
      const first = await page.locator('canvas').screenshot();
      await page.evaluate(async ({variant, clip}) => window.assetPreview.pose(variant, clip, 0.6), {variant, clip});
      const second = await page.locator('canvas').screenshot();
      assert.ok(!first.equals(second), `${variant}/${clip}: fixed animation samples must change rendered pixels`);
      const state = await page.evaluate(() => window.assetPreview.state());
      assert.equal(state.bones, 15);
      assert.ok(state.meshes > 0);
      assert.equal(state.clip, clip);
      assert.equal(state.variant, variant);
      const coverage = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL 2 unavailable');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let changed = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] !== pixels[0] || pixels[i+1] !== pixels[1] || pixels[i+2] !== pixels[2]) changed++;
        }
        return changed;
      });
      assert.ok(coverage > 500, 'Canvas must contain rendered non-background pixels');
      await page.screenshot({ path: resolve(reports, `${variant}-${clip}.png`) });
      samples.push({ variant, clip, bones: state.bones, meshes: state.meshes, nonBackgroundPixels: coverage });
    }
  }
  // Invalid external pose requests must reject rather than silently changing the asset.
  for (const args of [['missing', 'idle', 0], ['blue', 'missing', 0], ['blue', 'idle', -1]]) {
    assert.equal(await page.evaluate(async args => {
      try { await window.assetPreview.pose(...args); return false; } catch { return true; }
    }, args), true);
  }
  await page.click('#pause');
  const before = await page.evaluate(() => window.assetPreview.state().animationTime);
  await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.assetPreview.state().animationTime)) > before);
  await page.click('#pause');
  assert.equal(await page.evaluate(() => window.assetPreview.state().paused), true);
  const frozen = await page.evaluate(() => window.assetPreview.state().animationTime);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.assetPreview.state().animationTime), frozen);
  assert.deepEqual(errors, []);
  assert.deepEqual(responses, []);
  const result = { renderer: 'Chromium WebGL 2 / SwiftShader', samples, consoleErrors: errors, failedResponses: responses };
  await writeFile(resolve(reports, 'smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ samples: samples.length, consoleErrors: 0, failedResponses: 0, pass: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
