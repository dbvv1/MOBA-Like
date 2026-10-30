import {describe,it,expect} from 'vitest';
import {entryLightingSearch} from '../../src/ui/entry-lighting.js';
import {parseLightingStyle} from '../../src/render/lighting-style.js';
describe('HTML entry lighting default',()=>{
 it('promotes only the main visual entry, leaving candidate baseline and buffering opt-in',()=>{
  const promoted=entryLightingSearch('?seed=1','forest-light-v1');
  expect(parseLightingStyle(promoted)).toBe('forest-light-v1');
  expect(new URLSearchParams(promoted).get('seed')).toBe('1');
  expect(new URLSearchParams(promoted).has('commands')).toBe(false);
  expect(parseLightingStyle(entryLightingSearch('',undefined))).toBe('baseline');
 });
 it('preserves explicit historical styles, buffer opt-in and parser rejection',()=>{
  for(const style of ['baseline','stylized-diffuse','forest-light-v1'])expect(parseLightingStyle(entryLightingSearch('?commands=buffer-v1&lighting='+style,'forest-light-v1'))).toBe(style);
  expect(new URLSearchParams(entryLightingSearch('?commands=buffer-v1','forest-light-v1')).get('commands')).toBe('buffer-v1');
  for(const search of ['?lighting=','?lighting=invalid','?lighting=baseline&lighting=forest-light-v1'])expect(()=>parseLightingStyle(entryLightingSearch(search,'forest-light-v1'))).toThrow();
 });
});
