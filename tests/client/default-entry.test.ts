import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import manifest from '../../default-source-manifest.json';
describe('promoted lighting and preserved previous entries',()=>{
 it('keeps every default runtime source pinned independently of candidate changes',()=>{
  for(const file of [...manifest.files,...manifest.sharedAssets])expect(createHash('sha256').update(readFileSync(file.path)).digest('hex'),file.path).toBe(file.sha256);
 });
 it('promotes the v11 visual entry while retaining the pinned v10 entry',()=>{
  const original=readFileSync('legacy-v10.html','utf8').replace('<title>Legacy v10 · Ashen Furrow','<title>Ashen Furrow').replace('/default-src/client.ts','/src/client.ts').replace('<a href="/candidate.html">Try the combat / terrain / keyboard / continue candidate</a>','');
  expect(createHash('sha256').update(original).digest('hex')).toBe(manifest.htmlSourceSha256);
  expect(readFileSync('legacy-v10.html','utf8')).toContain('src="/default-src/client.ts"');
  expect(readFileSync('index.html','utf8')).toContain('src="/src/client.ts"');
  expect(readFileSync('index.html','utf8')).toContain('data-default-lighting="forest-light-v1"');
  expect(readFileSync('candidate.html','utf8')).not.toContain('data-default-lighting');
  expect(readFileSync('candidate.html','utf8')).toContain('src="/src/client.ts"');
  expect(readFileSync('default-src/client.ts','utf8')).toContain('contentVersion=10');
  expect(readFileSync('src/client.ts','utf8')).toContain("get('commands')==='buffer-v1'?12:11");
 });
});
