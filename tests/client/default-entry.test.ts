import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import manifest from '../../default-source-manifest.json';
describe('side-by-side candidate isolation',()=>{
 it('keeps every default runtime source pinned independently of candidate changes',()=>{
  for(const file of [...manifest.files,...manifest.sharedAssets])expect(createHash('sha256').update(readFileSync(file.path)).digest('hex'),file.path).toBe(file.sha256);
 });
 it('selects separate entry modules and retains old default version',()=>{
  const original=readFileSync('index.html','utf8').replace('/default-src/client.ts','/src/client.ts').replace('<a href="/candidate.html">Try the combat / terrain / keyboard / continue candidate</a>','');
  expect(createHash('sha256').update(original).digest('hex')).toBe(manifest.htmlSourceSha256);
  expect(readFileSync('index.html','utf8')).toContain('src="/default-src/client.ts"');
  expect(readFileSync('candidate.html','utf8')).toContain('src="/src/client.ts"');
  expect(readFileSync('default-src/client.ts','utf8')).toContain('contentVersion=10');
  expect(readFileSync('src/client.ts','utf8')).toContain("get('commands')==='buffer-v1'?12:11");
 });
});
