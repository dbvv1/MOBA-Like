import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
import {saveCompatibility} from './tools/save-compatibility.js';
export default defineConfig({
  define: {__MOBA_SAVE_COMPATIBILITY__:JSON.stringify(saveCompatibility(fileURLToPath(new URL('.',import.meta.url))))},
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['recast-navigation', '@recast-navigation/core', '@recast-navigation/wasm'] },
  assetsInclude: ['**/*.navmesh'],
  build: { outDir: 'web-dist', emptyOutDir: true, target: 'es2022' },
});
