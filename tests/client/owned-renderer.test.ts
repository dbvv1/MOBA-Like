import {describe,expect,it} from 'vitest';
import {disposeOwnedRenderer} from '../../src/render/owned-renderer.js';
function owned(name:string,events:string[],fail=false){return {dispose(){events.push(`${name}:dispose`);if(fail)throw Error('resource cleanup failed');},forceContextLoss(){events.push(`${name}:lose`);},domElement:{remove(){events.push(`${name}:remove`);}}} as unknown as Parameters<typeof disposeOwnedRenderer>[0];}
describe('final owned renderer shutdown',()=>{
 it('releases resources, closes its own context and removes its canvas in order',()=>{const events:string[]=[];disposeOwnedRenderer(owned('old',events));expect(events).toEqual(['old:dispose','old:lose','old:remove']);});
 it('does not affect a separately created next world',()=>{const events:string[]=[],old=owned('old',events),next=owned('next',events);disposeOwnedRenderer(old);expect(events.some(e=>e.startsWith('next'))).toBe(false);disposeOwnedRenderer(next);expect(events.slice(3)).toEqual(['next:dispose','next:lose','next:remove']);});
 it('still closes the owned context and removes the canvas on failed cleanup',()=>{const events:string[]=[];expect(()=>disposeOwnedRenderer(owned('failed',events,true))).toThrow('resource cleanup failed');expect(events).toEqual(['failed:dispose','failed:lose','failed:remove']);});
 it('closes the context even when prior world resource disposal fails, and is idempotent',()=>{const events:string[]=[],renderer=owned('world',events);expect(()=>disposeOwnedRenderer(renderer,()=>{events.push('scene');throw Error('scene cleanup failed');})).toThrow('scene cleanup failed');disposeOwnedRenderer(renderer,()=>{events.push('again');});expect(events).toEqual(['scene','world:dispose','world:lose','world:remove']);});
 it('removes the canvas even when explicit context loss throws',()=>{const events:string[]=[],renderer=owned('world',events);renderer.forceContextLoss=()=>{events.push('loss-failed');throw Error('extension failed');};expect(()=>disposeOwnedRenderer(renderer)).toThrow('extension failed');expect(events).toEqual(['world:dispose','loss-failed','world:remove']);});

});
