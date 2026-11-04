import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const NAMES = ['sunsteel-blade', 'warden-plate', 'wayfarer-boots'];
const VARIANTS = ['bright', 'dark'];
const COLOR = /^#[0-9A-Fa-f]{6}$/;

export function validate(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('recipe must be an object');
  if (Object.keys(config).sort().join(',') !== 'sizes,variants') {
    throw new Error('recipe must contain only sizes and variants');
  }
  if (!Array.isArray(config.sizes) || config.sizes.length !== 2 || config.sizes[0] !== 32 || config.sizes[1] !== 48) {
    throw new Error('sizes must be [32, 48]');
  }
  const variants = config.variants;
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) throw new Error('variants must be an object');
  if (Object.keys(variants).sort().join(',') !== 'bright,dark') throw new Error('expected bright and dark variants');
  let strokeWidth;
  for (const [name, theme] of Object.entries(variants)) {
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error(`${name} variant must be an object`);
    if (Object.keys(theme).sort().join(',') !== 'accent,ink,preview_background,stroke_width') {
      throw new Error(`${name} variant has invalid fields`);
    }
    for (const key of ['ink', 'accent', 'preview_background']) {
      if (typeof theme[key] !== 'string' || !COLOR.test(theme[key])) throw new Error(`${name}.${key} must be six-digit hex`);
    }
    if (typeof theme.stroke_width !== 'number' || !Number.isFinite(theme.stroke_width)
        || theme.stroke_width < 3 || theme.stroke_width > 5) {
      throw new Error(`${name}.stroke_width must be a number between 3 and 5`);
    }
    if (strokeWidth === undefined) strokeWidth = theme.stroke_width;
    else if (strokeWidth !== theme.stroke_width) throw new Error('stroke_width must be uniform across themes');
  }
}

export function readRecipe(recipePath = path.join(ROOT, 'recipe.json')) {
  const config = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  validate(config);
  return config;
}

function checkMaster(source, name) {
  const root = /^<svg\b[^>]*\bviewBox="0 0 64 64"[^>]*>/.exec(source);
  if (!root) throw new Error(`${name}: master viewBox must be 0 0 64 64`);
  for (const dimension of ['width', 'height']) {
    if (!new RegExp(`\\b${dimension}="64"`).test(root[0])) throw new Error(`${name}: master ${dimension} must be 64`);
  }
  if (source.includes('<text')) throw new Error(`${name}: text is not allowed in icon masters`);
  if (!source.includes('stroke-width="4"')) throw new Error(`${name}: master must carry the 4-unit identity stroke`);
}

export function themedSvg(source, theme, name = 'master') {
  checkMaster(source, name);
  const svg = source
    .replaceAll('#F1F5F9', theme.preview_background)
    .replaceAll('#15304B', theme.ink)
    .replaceAll('#086E85', theme.accent)
    .replaceAll('stroke-width="4"', `stroke-width="${theme.stroke_width}"`);
  if (!svg.includes(`stroke-width="${theme.stroke_width}"`)) throw new Error(`${name}: themed stroke width was not applied`);
  return svg;
}

function loadSource(authorRoot, name) {
  const file = path.join(authorRoot, 'source', `${name}.svg`);
  return { file, source: fs.readFileSync(file, 'utf8') };
}

function tryRequire(require, id) {
  try {
    return require(id);
  } catch {
    try {
      return require(path.resolve(id));
    } catch {
      return null;
    }
  }
}

export function loadCanvas(require = createRequire(import.meta.url)) {
  const candidates = [process.env.EQUIPMENT_ICONS_CANVAS, '@napi-rs/canvas'].filter(Boolean);
  let globalRoot = null;
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  if (globalRoot) {
    candidates.push(
      path.join(globalRoot, '@napi-rs', 'canvas'),
      path.join(globalRoot, '@mermaid-js', 'mermaid-cli', 'node_modules', '@napi-rs', 'canvas'),
    );
  }
  for (const candidate of candidates) {
    const canvas = tryRequire(require, candidate);
    if (canvas?.createCanvas && canvas?.loadImage) return canvas;
  }
  throw new Error('PNG renderer @napi-rs/canvas not found; set EQUIPMENT_ICONS_CANVAS or NODE_PATH');
}

function sizedSvg(svg, size) {
  return svg.replace('<svg ', `<svg width="${size}" height="${size}" `).replace(/width="64" height="64"/, '');
}

async function rasterize(canvas, svg, size) {
  const { createCanvas, loadImage } = canvas;
  const image = await loadImage(Buffer.from(sizedSvg(svg, size)));
  const target = createCanvas(size, size);
  const context = target.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0);
  return target.toBuffer('image/png');
}

async function renderPreview(canvas, config, output, authorRoot) {
  const { createCanvas, loadImage } = canvas;
  const width = 160 * NAMES.length;
  const rowHeight = 200;
  const sheet = createCanvas(width, rowHeight * VARIANTS.length);
  const context = sheet.getContext('2d');
  for (const [row, variant] of VARIANTS.entries()) {
    const theme = config.variants[variant];
    context.fillStyle = theme.preview_background;
    context.fillRect(0, row * rowHeight, width, rowHeight);
    context.fillStyle = theme.ink;
    context.font = '13px sans-serif';
    context.fillText(`${variant} / actual pixels: 32, 48`, 12, row * rowHeight + 18);
    for (const [column, name] of NAMES.entries()) {
      const svg = themedSvg(fs.readFileSync(path.join(authorRoot, 'source', `${name}.svg`), 'utf8'), theme, name);
      for (const [size, offset] of [[32, 52], [48, 108]]) {
        const image = await loadImage(Buffer.from(sizedSvg(svg, size)));
        const x = column * 160 + (160 - size) / 2;
        context.drawImage(image, x, row * rowHeight + offset);
      }
      context.fillStyle = theme.ink;
      context.font = '13px sans-serif';
      context.fillText(name, column * 160 + 10, row * rowHeight + 180);
    }
  }
  fs.writeFileSync(path.join(output, 'preview.png'), sheet.toBuffer('image/png'));
}

function snapshot(root) {
  const files = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [file, bytes] of snapshot(child)) files.set(path.join(entry.name, file), bytes);
    } else if (entry.isFile()) {
      files.set(entry.name, fs.readFileSync(child));
    }
  }
  return files;
}

function expectedFiles(config) {
  return ['preview.png', ...VARIANTS.flatMap((variant) => NAMES.flatMap((name) => (
    ['.svg', '-32.png', '-48.png'].map((suffix) => path.join(variant, `${name}${suffix}`))
  )))];
}

export async function exportFamily({ authorRoot = ROOT, recipePath = path.join(ROOT, 'recipe.json'), output = path.join(ROOT, 'exported'), canvas } = {}) {
  const config = readRecipe(recipePath);
  const renderer = canvas ?? loadCanvas();
  const requested = path.resolve(output);
  const author = path.resolve(authorRoot);
  const sourceRoot = path.join(author, 'source');
  if (requested === author || requested === path.dirname(author) || author.startsWith(`${requested}${path.sep}`)
      || requested === sourceRoot || requested.startsWith(`${sourceRoot}${path.sep}`)
      || sourceRoot.startsWith(`${requested}${path.sep}`)) {
    throw new Error('output cannot replace authoring inputs');
  }
  if (path.resolve(recipePath).startsWith(`${requested}${path.sep}`)) throw new Error('output cannot contain the recipe');
  if (!fs.existsSync(path.dirname(requested)) || !fs.statSync(path.dirname(requested)).isDirectory()) {
    throw new Error('output parent must already exist');
  }
  if (fs.existsSync(requested) && !fs.statSync(requested).isDirectory()) throw new Error('output must be a directory');
  const lock = `${requested}.export-lock`;
  const backup = `${requested}.export-backup`;
  if (fs.existsSync(backup)) throw new Error(`backup exists: ${backup}; inspect before retrying`);
  if (fs.existsSync(lock)) throw new Error(`export lock exists: ${lock}; another or interrupted export owns it`);
  fs.mkdirSync(lock);
  let stage = null;
  let keepRecovery = false;
  try {
    stage = fs.mkdtempSync(path.join(path.dirname(requested), `.${path.basename(requested)}.export-`));
    if (fs.existsSync(requested)) fs.cpSync(requested, stage, { recursive: true });
    for (const file of expectedFiles(config)) fs.rmSync(path.join(stage, file), { force: true });
    fs.mkdirSync(path.join(stage, 'bright'), { recursive: true });
    fs.mkdirSync(path.join(stage, 'dark'), { recursive: true });
    for (const variant of VARIANTS) {
      const theme = config.variants[variant];
      for (const name of NAMES) {
        const { source } = loadSource(author, name);
        const svg = themedSvg(source, theme, name);
        fs.writeFileSync(path.join(stage, variant, `${name}.svg`), svg, 'utf8');
        for (const size of config.sizes) {
          fs.writeFileSync(path.join(stage, variant, `${name}-${size}.png`), await rasterize(renderer, svg, size));
        }
      }
    }
    await renderPreview(renderer, config, stage, author);
    for (const file of expectedFiles(config)) {
      const filePath = path.join(stage, file);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
        throw new Error(`missing generated output: ${file}`);
      }
    }
    const hadTarget = fs.existsSync(requested);
    if (hadTarget) fs.renameSync(requested, backup);
    try {
      fs.renameSync(stage, requested);
      stage = null;
    } catch (error) {
      if (hadTarget) {
        try {
          fs.renameSync(backup, requested);
        } catch (rollbackError) {
          keepRecovery = true;
          throw new Error(`publication and rollback failed; preserve ${lock}, ${backup} and ${stage}`);
        }
      }
      throw error;
    }
    if (hadTarget) {
      try {
        fs.rmSync(backup, { recursive: true, force: false });
      } catch {
        keepRecovery = true;
        throw new Error(`new batch committed to ${requested}, but backup cleanup failed; inspect ${backup} and ${lock}`);
      }
    }
    return config;
  } finally {
    if (!keepRecovery) {
      if (stage) fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
}

export { snapshot };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  try {
    await exportFamily({
      recipePath: option('--recipe') ? path.resolve(option('--recipe')) : path.join(ROOT, 'recipe.json'),
      output: option('--output') ? path.resolve(option('--output')) : path.join(ROOT, 'exported'),
    });
    console.log('exported 3 items x 2 themes x (SVG, 32, 48)');
  } catch (error) {
    console.error(`export failed: ${error.message}`);
    process.exit(2);
  }
}
