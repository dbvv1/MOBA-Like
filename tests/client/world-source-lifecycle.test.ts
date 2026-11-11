import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createPlayableWorld} from '../../src/render/playable-world.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';

const doubles=vi.hoisted(()=>({renderers:[] as any[]}));
// GPU submission only is doubled. Route, world, GLB parsing/pins, presentation,
// battlefield and all owned resource disposal remain production consumers.
vi.mock('three',async original=>{
  const actual=await original<typeof import('three')>();
  return {...actual,WebGLRenderer:class {
    shadowMap={};domElement={tabIndex:0,remove:vi.fn()};
    info={render:{frame:0},memory:{}};
    dispose=vi.fn();forceContextLoss=vi.fn();setPixelRatio(){}getPixelRatio(){return 1;}setSize(){}
    getContext(){return {isContextLost:()=>false};}
    render(){this.info.render.frame++;}
    constructor(){doubles.renderers.push(this);}
  }};
});
vi.mock('../../src/render/lighting-post.js',()=>({createLightingPost:(renderer:any,scene:any,camera:any)=>({render:()=>renderer.render(scene,camera),resize(){},dispose(){}})}));
const trial='?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();doubles.renderers.length=0;});

function setup(stage?:'models'|'combat'|'terrain-road'|'terrain',corrupt=false){
  const controller=new AbortController(),paths:string[]=[],textures:string[]=[],resources=new Set<THREE.BufferGeometry>(),disposed=new Map<THREE.BufferGeometry,number>();
  vi.stubGlobal('window',{devicePixelRatio:1,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.spyOn(THREE.FileLoader.prototype,'loadAsync').mockImplementation(async url=>{
    const path=url.split('?')[0]!.replace(/^\//,'');paths.push(path);
    const buffer=await readFile(path),bytes=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
    if(corrupt&&path.includes('/morrow-ranged/exported/morrow-teal'))new Uint8Array(bytes)[bytes.byteLength-1]^=1;
    return bytes;
  });
  const parse=GLTFLoader.prototype.parseAsync;let parsed=0;
  vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async function(this:GLTFLoader,bytes,path){
    const {PNG}=createRequire(import.meta.url)('pngjs');
    this.register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){
      const texture=parser.json.textures[index],image=parser.json.images[texture.source];
      const input=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(input));
      const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;return value;
    }}));
    const model=await parse.call(this,bytes,path);
    model.scene.traverse(node=>{if((node as THREE.Mesh).isMesh){const geometry=(node as THREE.Mesh).geometry;if(!resources.has(geometry)){resources.add(geometry);geometry.addEventListener('dispose',()=>disposed.set(geometry,(disposed.get(geometry)??0)+1));}}});
    if(++parsed===19&&stage==='models')controller.abort();
    return model;
  });
  vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{
    textures.push(url);
    // Exercise real shipped file existence, while leaving browser image decode
    // outside this CPU test (embedded GLB PNGs are actually decoded above).
    await readFile(new URL(url));
    if(stage==='combat'&&url.includes('/combat-vfx/'))controller.abort();
    if(stage==='terrain-road'&&url.includes('/earth-albedo.webp'))controller.abort();
    if(stage==='terrain'&&url.includes('/forest-albedo.webp'))controller.abort();
    return new THREE.Texture();
  });
  const host={clientWidth:800,clientHeight:600,replaceChildren:vi.fn()} as unknown as HTMLElement;
  const run=(signal=controller.signal)=>createPlayableWorld(host,getContent(12),{search:trial,defaultLightingSearch:'?lighting=forest-light-v1',cameraFollow:'hold-follow-v1',candidateEntry:true,signal});
  return {run,controller,host,paths,textures,resources,disposed};
}

it.each(['models','combat','terrain-road','terrain'] as const)('cancel after actual %s acquisition releases the obsolete world without starting the next request',async stage=>{
  const test=setup(stage);
  await expect(test.run()).rejects.toMatchObject({name:'AbortError'});
  expect(test.paths).toHaveLength(19);expect(test.paths.filter(path=>path.includes('/morrow-ranged/'))).toHaveLength(2);
  expect(test.textures).toHaveLength(stage==='models'?0:stage==='combat'?1:stage==='terrain-road'?2:3);
  expect(test.textures.some(path=>path.includes('/control.svg'))).toBe(false);
  expect(test.resources.size).toBeGreaterThan(0);
  for(const resource of test.resources)expect(test.disposed.get(resource)).toBe(1);
  expect(doubles.renderers).toHaveLength(1);expect(doubles.renderers[0].dispose).toHaveBeenCalledTimes(1);expect(doubles.renderers[0].forceContextLoss).toHaveBeenCalledTimes(1);
  expect(test.host.replaceChildren).not.toHaveBeenCalled();
});

it('a corrupt shipped character fails the integrated route, releases it and restores a usable real baseline View',async()=>{
  const test=setup(undefined,true),result=await test.run();
  try{
    expect(result.heroSource).toBe('baseline');expect(result.cameraPolicy).toBe('baseline');expect(result.fallbackReason).toContain('SHA-256 mismatch');
    expect(test.paths).toHaveLength(38);expect(doubles.renderers).toHaveLength(2);expect(doubles.renderers[0].dispose).toHaveBeenCalledTimes(1);
    expect(test.paths.slice(19).some(path=>path.includes('/morrow-ranged/')||path.includes('/veyra-death-contact/'))).toBe(false);
    const sim=await makeSim(12,61),player=sim.getHero(0,0)!;
    result.world.sync(sim.snapshot(),player.id);result.world.draw(0,1,false);
    expect(result.world.cameraState().position.x).toBe(player.position.x);
    expect(test.host.replaceChildren).toHaveBeenCalledTimes(1);
  }finally{result.world.dispose();result.world.dispose();}
  for(const resource of test.resources)expect(test.disposed.get(resource)).toBe(1);
  for(const renderer of doubles.renderers)expect(renderer.dispose).toHaveBeenCalledTimes(1);
});


it('restarts the actual full character consumer after cancellation within the terrain pair',async()=>{
  const test=setup('terrain-road');
  await expect(test.run()).rejects.toMatchObject({name:'AbortError'});
  expect(test.textures).toHaveLength(2);
  for(const resource of test.resources)expect(test.disposed.get(resource)).toBe(1);
  const result=await test.run(new AbortController().signal);
  try{
    expect(result.heroSource).toBe('death-contact');
    expect(test.paths).toHaveLength(38);
    expect(test.paths.slice(19).filter(path=>path.includes('/morrow-ranged/'))).toHaveLength(2);
    expect(test.textures).toHaveLength(6);
    const sim=await makeSim(12,61),player=sim.getHero(0,0)!;
    result.world.sync(sim.snapshot(),player.id);result.world.draw(0,1,false);
    expect(test.host.replaceChildren).toHaveBeenCalledTimes(1);
  }finally{result.world.dispose();result.world.dispose();}
  for(const resource of test.resources)expect(test.disposed.get(resource)).toBe(1);
  for(const renderer of doubles.renderers)expect(renderer.dispose).toHaveBeenCalledTimes(1);
});
