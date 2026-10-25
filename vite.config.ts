import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['recast-navigation', '@recast-navigation/core', '@recast-navigation/wasm'] },
  assetsInclude: ['**/*.navmesh'],
  build: { outDir: 'web-dist', emptyOutDir: true, target: 'es2022' },
});
