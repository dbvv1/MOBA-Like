import {defineConfig,mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import normal from './vite.config.js';
// Separate receiver build. The production entry/config remains owned by the
// live client; import it so its asset and build-fingerprint rules are retained.
const root=fileURLToPath(new URL('.',import.meta.url));
const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
export default mergeConfig(normal,defineConfig({define:{__MOBA_CAPTURE_BUILD__:JSON.stringify({sourceCommit:git(['rev-parse','HEAD']),sourceDirty:!!git(['status','--porcelain'])})},build:{outDir:'outputs/capture-build',rollupOptions:{input:{game:fileURLToPath(new URL('./index.html',import.meta.url)),capture:fileURLToPath(new URL('./capture.html',import.meta.url))}}}}));
