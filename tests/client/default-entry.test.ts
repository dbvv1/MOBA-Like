import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import manifest from '../../default-source-manifest.json';
import {entryLightingSearch} from '../../src/ui/entry-lighting.js';
import {parseMaterialFamily} from '../../src/render/quiet-family.js';
import {parseLightingStyle} from '../../src/render/lighting-style.js';
import {parseSceneDressing} from '../../src/render/scene-dressing.js';
describe('promoted lighting and preserved previous entries',()=>{
 it('keeps every default runtime source pinned independently of candidate changes',()=>{
  for(const file of [...manifest.files,...manifest.sharedAssets])expect(createHash('sha256').update(readFileSync(file.path)).digest('hex'),file.path).toBe(file.sha256);
 });
 it('applies quiet only on the player entry and preserves explicit rollback',()=>{
  const html=readFileSync('index.html','utf8');
  expect(html).toContain('data-default-materials="quiet-family-v1"');
  expect(html).toContain('<details id="diagnostics" hidden>');
  expect(html).not.toMatch(/href="[^"]*(?:candidate|legacy-v10|diagnostics)/);
  expect(readFileSync('candidate.html','utf8')).not.toContain('data-default-materials');
  expect(parseMaterialFamily(entryLightingSearch('',undefined,'quiet-family-v1'))).toBe('quiet-family-v1');
  expect(parseMaterialFamily(entryLightingSearch('',undefined))).toBe('baseline');
  for(const query of ['materials=baseline','materials=unknown','materials=quiet-family-v1&materials=baseline']){
   expect(new URLSearchParams(entryLightingSearch(query,undefined,'quiet-family-v1')).getAll('materials')).toEqual(new URLSearchParams(query).getAll('materials'));
   expect(parseMaterialFamily(entryLightingSearch(query,undefined,'quiet-family-v1'))).toBe('baseline');
  }
 });
 it('applies the forest-lane scene only on the player entry and preserves explicit rollback',()=>{
  const html=readFileSync('index.html','utf8');
  expect(html).toContain('data-default-scene="forest-lane-v1"');
  expect(readFileSync('candidate.html','utf8')).not.toContain('data-default-scene');
  expect(parseSceneDressing(entryLightingSearch('',undefined,undefined,'forest-lane-v1'))).toBe('forest-lane-v1');
  expect(parseSceneDressing(entryLightingSearch('',undefined))).toBe('baseline');
  for(const query of ['scene=baseline','scene=unknown','scene=forest-lane-v1&scene=baseline']){
   expect(new URLSearchParams(entryLightingSearch(query,undefined,undefined,'forest-lane-v1')).getAll('scene')).toEqual(new URLSearchParams(query).getAll('scene'));
   expect(parseSceneDressing(entryLightingSearch(query,undefined,undefined,'forest-lane-v1'))).toBe('baseline');
  }
  const rollback=entryLightingSearch('?scene=baseline','forest-light-v1','quiet-family-v1','forest-lane-v1');
  expect(parseSceneDressing(rollback)).toBe('baseline');
  expect(parseLightingStyle(rollback)).toBe('forest-light-v1');
  expect(parseMaterialFamily(rollback)).toBe('quiet-family-v1');
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
