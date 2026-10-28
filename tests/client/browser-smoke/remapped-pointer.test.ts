import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach,describe,it,expect,vi} from 'vitest';

// Run the actual runner segment, not a duplicated fix. No browser or GPU is launched.
// Model the existing client contract: closing settings clears pointer ownership;
// focus does not restore it; only the normal page mouse action does.
const source=readFileSync('tests/client/browser-smoke/run.mjs','utf8');
const start=source.indexOf("  assert.match(await page.locator('[data-skills] button').first().textContent(),/^F /);");
const end=source.indexOf('  const beforeResume=',start);
assert.ok(start>=0&&end>start);
const segment=source.slice(start,end);
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
afterEach(()=>vi.unstubAllGlobals());
async function execute(code=segment,visible=true){
 const calls:unknown[]=[];let inside=false,aim=false;
 const box={x:30,y:45,width:1000,height:700};
 vi.stubGlobal('window',{mobaClient:{state:()=>({targeting:{visible:inside&&aim}})}});
 const canvas={focus:async()=>{calls.push('focus');},boundingBox:async()=>visible?box:null};
 const page={locator:()=>({first:()=>({textContent:async()=> 'F Rift Lancet'})}),
  mouse:{move:async(x:number,y:number)=>{calls.push(['move',x,y]);inside=x>box.x&&x<box.x+box.width&&y>box.y&&y<box.y+box.height;}},
  keyboard:{press:async(key:string)=>{calls.push(['key',key]);aim=key==='f';}},
  waitForFunction:async(predicate:()=>boolean)=>{calls.push('visible-check');assert.ok(predicate(),'Targeting must really be visible');},
 };
 await new AsyncFunction('page','canvas','assert',code)(page,canvas,assert);
 return calls;
}
describe('remapped skill smoke after settings clears pointer ownership',()=>{
 it('uses the fresh canvas bounds and real page mouse action before the unchanged visible assertion',async()=>{
  expect(await execute()).toEqual(['focus',['move',610,409],['key','f'],'visible-check',['key','Escape']]);
 });
 it('reproduces the old focus-only failure if the real mouse movement is removed',async()=>{
  const omitted=segment.replace(/  await page\.mouse\.move\([^\n]+\);\n/,'');expect(omitted).not.toBe(segment);
  await expect(execute(omitted)).rejects.toThrow('Targeting must really be visible');
 });
 it('fails closed instead of guessing a pointer position when the current canvas is missing',async()=>{
  await expect(execute(segment,false)).rejects.toThrow('Current canvas must be visible');
 });
});
