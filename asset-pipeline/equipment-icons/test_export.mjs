import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  NAMES, ROOT, exportFamily, loadCanvas, readRecipe, snapshot, themedSvg, validate,
} from './export.mjs';

const THEMES = ['bright', 'dark'];
const SIZES = [32, 48];

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equipment-icons-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function copyAuthor(t) {
  const dir = tempDir(t);
  fs.cpSync(path.join(ROOT, 'source'), path.join(dir, 'source'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'recipe.json'), path.join(dir, 'recipe.json'));
  return dir;
}

function pngSize(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buffer.subarray(0, 8), signature);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function alphaBounds(canvas, buffer) {
  const { createCanvas, loadImage } = canvas;
  const image = await loadImage(buffer);
  const board = createCanvas(image.width, image.height);
  const context = board.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixels[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, width: image.width, height: image.height };
}

test('source masters and recipe keep the 64-unit identity contract', () => {
  const config = readRecipe();
  assert.deepEqual(config.sizes, SIZES);
  assert.equal(config.variants.bright.stroke_width, 4.5);
  assert.equal(config.variants.dark.stroke_width, 4.5);
  for (const name of NAMES) {
    const source = fs.readFileSync(path.join(ROOT, 'source', `${name}.svg`), 'utf8');
    assert.match(source, /viewBox="0 0 64 64"/);
    assert.match(source, /width="64" height="64"/);
    assert.match(source, /stroke-width="4"/);
    assert.doesNotMatch(source, /<text/);
    assert.match(source, /\bfill="#086E85"/);
    assert.match(source, /\bstroke="#15304B"/);
  }
});

test('themed output changes stroke 4 to 4.5 and keeps every path identity', () => {
  for (const name of NAMES) {
    const source = fs.readFileSync(path.join(ROOT, 'source', `${name}.svg`), 'utf8');
    const geometry = [...source.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1]);
    assert.equal(geometry.length, 3, `${name} keeps its three authored paths`);
    for (const variant of THEMES) {
      const svg = themedSvg(source, readRecipe().variants[variant], name);
      assert.match(svg, /stroke-width="4.5"/);
      assert.doesNotMatch(svg, /stroke-width="4"/);
      assert.deepEqual([...svg.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1]), geometry);
    }
  }
});

test('invalid parameters are rejected before rendering', () => {
  const good = readRecipe();
  const variants = [
    (config) => { config.variants.dark.stroke_width = 12; },
    (config) => { config.variants.dark.stroke_width = true; },
    (config) => { config.variants.bright.stroke_width = 4; },
    (config) => { config.variants.bright.ink = 'url(external)'; },
    (config) => { config.variants.dark.accent = '#xx0000'; },
    (config) => { config.variants.gray = config.variants.bright; },
    (config) => { config.extra = true; },
    (config) => { config.sizes = [0]; },
  ];
  variants.forEach((mutate, index) => {
    const config = structuredClone(good);
    mutate(config);
    assert.throws(() => validate(config), Error, `variant ${index}`);
  });
  for (const bad of [null, {}, { sizes: SIZES }, { sizes: SIZES, variants: {} }]) {
    assert.throws(() => validate(bad), Error);
  }
});

test('CLI rejects a missing or invalid recipe without creating output', (t) => {
  const dir = tempDir(t);
  const invalid = path.join(dir, 'invalid.json');
  fs.writeFileSync(invalid, '{"sizes":[0],"variants":{}}');
  for (const recipe of [path.join(dir, 'missing.json'), invalid]) {
    const output = path.join(dir, 'not-created');
    assert.throws(
      () => execFileSync(process.execPath, [path.join(ROOT, 'export.mjs'), '--recipe', recipe, '--output', output], { encoding: 'utf8', stdio: 'pipe' }),
      (error) => error.status === 2 && /export failed:/.test(error.stderr),
    );
    assert.equal(fs.existsSync(output), false);
  }
});

test('renderer discovery reports the missing dependency instead of exporting silently', () => {
  assert.throws(
    () => loadCanvas(() => { throw new Error('module not found'); }),
    /PNG renderer @napi-rs\/canvas not found/,
  );
});

test('export rebuilds deterministically at 32 and 48 px with transparent edges', async (t) => {
  const canvas = loadCanvas();
  const first = path.join(tempDir(t), 'first');
  const second = path.join(tempDir(t), 'second');
  await exportFamily({ output: first, canvas });
  await exportFamily({ output: second, canvas });
  const left = snapshot(first);
  const right = snapshot(second);
  assert.deepEqual([...left.keys()].sort(), [...right.keys()].sort());
  assert.equal(left.size, 19, '18 runtime files plus the preview');
  for (const [file, bytes] of left) assert.deepEqual(bytes, right.get(file), `${file} rebuilds byte-for-byte`);
  for (const variant of THEMES) {
    for (const name of NAMES) {
      const svg = fs.readFileSync(path.join(first, variant, `${name}.svg`), 'utf8');
      assert.match(svg, /viewBox="0 0 64 64"/);
      assert.match(svg, /stroke-width="4.5"/);
      for (const size of SIZES) {
        const png = fs.readFileSync(path.join(first, variant, `${name}-${size}.png`));
        assert.deepEqual(pngSize(png), { width: size, height: size });
        const bounds = await alphaBounds(canvas, png);
        assert.ok(bounds.minX >= 2 && bounds.minY >= 2, `${variant}/${name}-${size} top/left margin`);
        assert.ok(bounds.maxX <= size - 3 && bounds.maxY <= size - 3, `${variant}/${name}-${size} bottom/right margin`);
      }
    }
  }
  const preview = pngSize(fs.readFileSync(path.join(first, 'preview.png')));
  assert.deepEqual(preview, { width: 480, height: 400 });
});

test('committed output matches a fresh deterministic rebuild', async (t) => {
  const canvas = loadCanvas();
  const fresh = path.join(tempDir(t), 'fresh');
  await exportFamily({ output: fresh, canvas });
  const left = snapshot(fresh);
  for (const [file, bytes] of left) {
    if (file === 'preview.png') continue;
    const committed = path.join(ROOT, 'exported', file);
    assert.ok(fs.existsSync(committed), `committed ${file} exists`);
    assert.deepEqual(fs.readFileSync(committed), bytes, `committed ${file} is current`);
  }
});

test('authoring inputs and their parents cannot be used as output', async (t) => {
  const author = copyAuthor(t);
  const recipePath = path.join(author, 'recipe.json');
  for (const output of [author, path.join(author, 'source'), path.join(author, 'source', 'nested'), path.dirname(author)]) {
    await assert.rejects(
      exportFamily({ authorRoot: author, recipePath, output, canvas: {} }),
      /output cannot replace authoring inputs/,
    );
    assert.equal(fs.existsSync(path.join(author, 'source', `${NAMES[0]}.svg`)), true);
  }
});

test('a missing source rejects the batch and preserves the previous family', async (t) => {
  const canvas = loadCanvas();
  const author = copyAuthor(t);
  const output = path.join(tempDir(t), 'out');
  await exportFamily({ authorRoot: author, recipePath: path.join(author, 'recipe.json'), output, canvas });
  const before = snapshot(output);
  fs.rmSync(path.join(author, 'source', `${NAMES.at(-1)}.svg`));
  await assert.rejects(
    exportFamily({ authorRoot: author, recipePath: path.join(author, 'recipe.json'), output, canvas }),
    /ENOENT/,
  );
  assert.deepEqual(snapshot(output), before);
  assert.equal(fs.existsSync(`${output}.export-lock`), false);
  assert.equal(fs.existsSync(`${output}.export-backup`), false);
  const fresh = path.join(tempDir(t), 'fresh');
  await assert.rejects(
    exportFamily({ authorRoot: author, recipePath: path.join(author, 'recipe.json'), output: fresh, canvas }),
    /ENOENT/,
  );
  assert.equal(fs.existsSync(fresh), false);
});
