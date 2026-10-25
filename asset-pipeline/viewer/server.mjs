import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };

// Local-only static consumer fixture: never serves outside asset-pipeline.
export function createAssetServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      const path = resolve(assetRoot, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(assetRoot + '/') || !types[extname(path)]) { res.writeHead(404).end(); return; }
      const bytes = await readFile(path);
      res.writeHead(200, { 'Content-Type': types[extname(path)] }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
}
