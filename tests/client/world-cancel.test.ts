import {readFile} from 'node:fs/promises';
import * as Three from 'three';
import ts from 'typescript';
import {expect,it} from 'vitest';
import {disposeOwnedRenderer} from '../../src/render/owned-renderer.js';

it('an abandoned async world releases its assets before it can replace the live canvas',async()=>{
  const source=await readFile(new URL('../../src/render/world.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,'').replace('export async function createWorld','async function createWorld').replace(/^export type .*$/gm,'').replaceAll('import.meta.url','SOURCE_URL'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const events:string[]=[];
  let releaseTexture!:(value:{colorSpace:string;dispose:()=>void})=>void,started!:()=>void;
  const loading=new Promise<void>(resolve=>{started=resolve;});
  const host={canvas:'new' as unknown,replaceChildren(value:unknown){events.push('mounted');this.canvas=value;}};
  class Renderer {
    shadowMap={};
    domElement={remove:()=>{events.push('canvas-release');if(host.canvas===this.domElement)host.canvas=null;}};
    setPixelRatio(){}dispose(){events.push('renderer-release');}forceContextLoss(){events.push('context-release');}
  }
  class TextureLoader {loadAsync(){started();return new Promise(resolve=>{releaseTexture=resolve;});}}
  const bindings={THREE:{...Three,WebGLRenderer:Renderer,TextureLoader},window:{devicePixelRatio:1},disposeOwnedRenderer,
    SOURCE_URL:new URL('../../src/render/world.ts',import.meta.url).href,
    loadBattleAssets:async()=>({dispose:()=>events.push('assets-release')}),
    loadCombatTextures:async()=>({dispose:()=>events.push('textures-release')}),
    createPresentation:()=>{throw new Error('Presentation must not be constructed after cancellation');},
  };
  const createWorld=new Function(...Object.keys(bindings),`${code};return createWorld;`)(...Object.values(bindings));
  const abort=new AbortController(),pending=createWorld(host,{},abort.signal);
  await loading;abort.abort();releaseTexture({colorSpace:'',dispose:()=>events.push('status-release')});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(host.canvas).toBe('new');expect(events).not.toContain('mounted');
  expect(events).toEqual(['status-release','textures-release','assets-release','renderer-release','context-release','canvas-release']);
});
