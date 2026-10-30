import {execFileSync} from 'node:child_process';
import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
import {saveCompatibility} from './tools/save-compatibility.js';
const source={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!==''};
export default defineConfig({
  plugins:[{name:'source-identity',generateBundle(){this.emitFile({type:'asset',fileName:'build-identity.json',source:JSON.stringify(source)});}}],
  define: {__MOBA_SAVE_COMPATIBILITY__:JSON.stringify(saveCompatibility(fileURLToPath(new URL('.',import.meta.url))))},
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['recast-navigation', '@recast-navigation/core', '@recast-navigation/wasm'] },
  assetsInclude: ['**/*.navmesh'],
  build: { outDir: 'web-dist', emptyOutDir: true, target: 'es2022', rollupOptions: {input: {main:'index.html',candidate:'candidate.html',legacy:'legacy-v10.html'}} },
});
