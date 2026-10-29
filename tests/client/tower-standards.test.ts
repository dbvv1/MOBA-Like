import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PNG} from 'pngjs';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {createBattlefield} from '../../src/render/battlefield.js';
import {loadTerrainTexturePair,loadTerrainTextures} from '../../src/render/terrain-textures.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';
const draft=path.resolve('asset-pipeline/tower-standards');
function loader(){return new GLTFLoader().register(parser=>({name:'CPU_EMBEDDED_PNG',async loadTexture(index:number){const image=parser.json.images[parser.json.textures[index].source];const b=await parser.getDependency('bufferView',image.bufferView);const png=PNG.sync.read(Buffer.from(b));const t=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);t.flipY=false;return t;}}));}
async function assets(){const l=loader();const result=await loadBattleAssets(async url=>{const name=path.basename(url.split('?')[0]!);const clean=url.split('?')[0]!;const file=clean.startsWith('file:')?new URL(clean):path.resolve(clean.replace(/^\//,''));const b=readFileSync(file);return l.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');},'baseline','tower-standards');expect(result.standards).toEqual({'tower-teal':'candidate','barracks-teal':'candidate'});for(const id of ['tower-teal','barracks-teal']){let draws=0;result.models[id]!.scene.traverse(n=>{if((n as THREE.Mesh).isMesh)draws++;});expect(draws).toBe(4);}return result;}
it('real GLBs fit old final-metres envelopes, no animated or hidden external dependency',async()=>{const a=await assets();try{for(const [id,min,max] of [['tower-teal',[-2.18,0,-2.18],[2.18,5.3,2.18]],['barracks-teal',[-1.31704,0,-1.31704],[1.31704,3,1.54764]]] as const){const model=a.models[id]!;expect(model.animations).toHaveLength(0);const box=new THREE.Box3().setFromObject(model.scene);for(let k=0;k<3;k++){expect(box.min.getComponent(k)).toBeGreaterThanOrEqual(min[k]!-1e-5);expect(box.max.getComponent(k)).toBeLessThanOrEqual(max[k]!+1e-5);}expect(box.min.y).toBeCloseTo(0,5);}}finally{a.dispose();a.dispose();}});
it('actual current battlefield consumes standards and continuous road without state/mesh change',async()=>{const a=await assets(),sim=await makeSim(11,1);const before=JSON.stringify(sim.snapshot());const png=PNG.sync.read(readFileSync(path.join(draft,'exported/road-albedo.png')));const road=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height),forest=new THREE.Texture();const tex=await loadTerrainTexturePair({road:'draft',forest:'current'},async url=>url==='draft'?road:forest);expect(tex).toBeDefined();expect(road.colorSpace).toBe(THREE.SRGBColorSpace);expect(road.wrapS).toBe(THREE.RepeatWrapping);const field=createBattlefield(getContent(11),a,'baseline',tex);field.sync(sim.snapshot());field.advance(0,0);expect(field.root.getObjectByName('ContinuousRoadAndClearings')).toBeDefined();for(const e of sim.snapshot().entities.filter(e=>e.team===0&&e.kind==='structure')){const root=field.root.getObjectByName(`entity-${e.id}`)!;expect(root.position.x).toBe(e.position.x);expect(root.position.z).toBe(e.position.z);expect(root.scale.x).toBe(1);}expect(JSON.stringify(sim.snapshot())).toBe(before);const surface=field.root.getObjectByName('ContinuousRoadAndClearings') as THREE.Mesh;expect((surface.material as THREE.MeshStandardMaterial).map).toBe(road);let released=0;road.addEventListener('dispose',()=>released++);field.dispose();expect(released).toBe(0);tex!.dispose();tex!.dispose();expect(released).toBe(1);a.dispose();});

import {parseStandards} from '../../src/render/standards.js';
it('standard selection is explicit, default off, rejects typo and duplicates',()=>{expect(parseStandards('')).toBe('baseline');expect(parseStandards('?standards=tower-standards')).toBe('tower-standards');expect(()=>parseStandards('?standards=yes')).toThrow();expect(()=>parseStandards('?standards=baseline&standards=tower-standards')).toThrow();});
it('failed candidate models fall back to their exact existing IDs; baseline never requests new URLs',async()=>{
 const calls:string[]=[];const model=()=>({scene:new THREE.Group(),animations:[]} as any);
 for(const mode of ['baseline','tower-standards'] as const){calls.length=0;const a=await loadBattleAssets(async url=>{calls.push(url);if(url.includes('tower-standards'))throw new Error('unavailable');return model();},'baseline',mode);expect(calls.filter(u=>u.includes('tower-standards')).length).toBe(mode==='baseline'?0:2);expect(Object.keys(a.models)).toHaveLength(19);if(mode==='tower-standards')expect(a.standards).toEqual({'tower-teal':'fallback','barracks-teal':'fallback'});a.dispose();}
});
it('road load fails safely to original pair and releases partial candidate textures exactly once',async()=>{
 const textures:THREE.Texture[]=[],calls:string[]=[];let forest=0;const a=await loadTerrainTextures('tower-standards',async url=>{calls.push(url);if(url.includes('forest-albedo')&&forest++===0)throw new Error('forest failure');const t=new THREE.Texture();vi.spyOn(t,'dispose');textures.push(t);return t;});expect(a?.standardRoad).toBe('fallback');expect(calls).toHaveLength(4);expect(calls[0]).toContain('tower-standards');expect(calls[2]).toContain('earth-albedo');expect(textures[0]!.dispose).toHaveBeenCalledTimes(1);a!.dispose();a!.dispose();for(const t of textures)expect(t.dispose).toHaveBeenCalledTimes(1);
});
import {CANDIDATE_TIMEOUT_MS} from '../../src/render/candidate-load.js';
it('hung optional models cannot hold base assets; late parsed resources release exactly once',async()=>{
 vi.useFakeTimers();try{
  const late:Array<(value:any)=>void>=[];
  const pending=loadBattleAssets(async url=>url.includes('tower-standards')?new Promise(resolve=>late.push(resolve)):({scene:new THREE.Group(),animations:[]} as any),'baseline','tower-standards');
  await vi.advanceTimersByTimeAsync(CANDIDATE_TIMEOUT_MS+1);const a=await pending;
  expect(a.standards).toEqual({'tower-teal':'fallback','barracks-teal':'fallback'});expect(late).toHaveLength(2);
  const releases=[];for(const done of late){const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material));releases.push(vi.spyOn(geometry,'dispose'),vi.spyOn(material,'dispose'));done({scene,animations:[]});}
  await vi.advanceTimersByTimeAsync(0);for(const dispose of releases)expect(dispose).toHaveBeenCalledTimes(1);a.dispose();for(const dispose of releases)expect(dispose).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('hung candidate texture falls back, then disposes the late texture without touching fallback',async()=>{
 vi.useFakeTimers();try{
  let late!:(value:THREE.Texture)=>void;
  const pending=loadTerrainTextures('tower-standards',async url=>url.includes('tower-standards')?new Promise(resolve=>{late=resolve;}):new THREE.Texture());
  await vi.advanceTimersByTimeAsync(CANDIDATE_TIMEOUT_MS+1);const a=await pending;expect(a?.standardRoad).toBe('fallback');
  const texture=new THREE.Texture(),disposed=vi.spyOn(texture,'dispose');late(texture);await vi.advanceTimersByTimeAsync(0);expect(disposed).toHaveBeenCalledTimes(1);a!.dispose();expect(disposed).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
