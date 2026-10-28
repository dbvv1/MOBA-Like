import {defineConfig,mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import normal from './vite.config.js';
import {writeFile} from 'node:fs/promises';
import {captureBundleIdentity} from './tools/capture-output.js';
// Separate receiver build. The production entry/config remains owned by the
// live client; import it so its asset and build-fingerprint rules are retained.
const root=fileURLToPath(new URL('.',import.meta.url));
const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const source={sourceCommit:git(['rev-parse','HEAD']),sourceDirty:!!git(['status','--porcelain'])};
const output=fileURLToPath(new URL('./outputs/capture-build/',import.meta.url));
export default mergeConfig(normal,defineConfig({
  define:{__MOBA_CAPTURE_BUILD__:JSON.stringify(source)},
  plugins:[{name:'capture-bundle-evidence',async closeBundle(){await writeFile(`${output}/capture-bundle.json`,JSON.stringify({format:1,...source,bundle:await captureBundleIdentity(output)},null,2)+'\n');}}],
  build:{outDir:'outputs/capture-build',rollupOptions:{input:{game:fileURLToPath(new URL('./index.html',import.meta.url)),capture:fileURLToPath(new URL('./capture.html',import.meta.url))}}}
}));
