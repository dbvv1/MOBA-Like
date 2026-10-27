import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {loadBattleAssets} from '../../src/render/battle-assets.js';

const {PNG}=createRequire(import.meta.url)('pngjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function downloads(){
  const queue:Array<{url:string;resolve:(bytes:ArrayBuffer)=>void;reject:(error:Error)=>void}>=[];
  vi.spyOn(THREE.FileLoader.prototype,'loadAsync').mockImplementation(function(this:THREE.FileLoader,url:string){
    expect(this.responseType).toBe('arraybuffer');expect(this.manager).toBe(THREE.DefaultLoadingManager);
    return new Promise<ArrayBuffer>((resolve,reject)=>queue.push({url,resolve,reject}));
  });
  return queue;
}
function fixture(){
  const geometry=new THREE.BoxGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture}),skeleton=new THREE.Skeleton([]),mesh=new THREE.SkinnedMesh(geometry,material),scene=new THREE.Group();mesh.skeleton=skeleton;scene.add(mesh);
  const disposals=[geometry,texture,material,skeleton].map(resource=>vi.spyOn(resource,'dispose'));
  return {model:{scene,scenes:[scene],animations:[],cameras:[],asset:{version:'2.0'},parser:null!,userData:{}} as GLTF,disposals};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();THREE.DefaultLoadingManager.setURLModifier((url:string)=>url);});

describe('manifest-ordered construction with parallel downloads',()=>{
  it.each(['manifest','reversed','melee-swapped'] as const)('uses real GLBs and native material order after %s byte completion',async schedule=>{
    const queue=downloads(),parse=GLTFLoader.prototype.parseAsync,constructed:string[]=[],bytesToUrl=new Map<ArrayBuffer,string>();let active=0;
    vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async function(this:GLTFLoader,bytes,path){
      expect(active++).toBe(0);const url=bytesToUrl.get(bytes as ArrayBuffer)!;
      expect(path).toBe(THREE.LoaderUtils.extractUrlBase(url));
      this.register(parser=>{
        // Decode embedded PNG on CPU, retaining native loadTextureImage settings.
        (parser as any).loadImageSource=async(index:number)=>{
          const image=parser.json.images[index],buffer=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(buffer));
          return new THREE.Texture({data:new Uint8Array(png.data),width:png.width,height:png.height} as any);
        };return {name:'CPU_embedded_PNG'};
      });
      const model=await parse.call(this,bytes,path);constructed.push(url);active--;return model;
    });
    const pending=loadBattleAssets();expect(queue).toHaveLength(19);expect(constructed).toEqual([]);
    const completions=[...queue];if(schedule==='reversed')completions.reverse();
    if(schedule==='melee-swapped'){
      const a=completions.findIndex(q=>q.url.includes('melee-teal')),b=completions.findIndex(q=>q.url.includes('melee-rust'));
      [completions[a],completions[b]]=[completions[b]!,completions[a]!];
    }
    for(const q of completions){
      const path=q.url.split('?')[0]!,bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));
      const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
      // The shipped Vite assets are self-contained; no unbundled sidecars assumed.
      expect(json.buffers.every((buffer:any)=>buffer.uri===undefined)).toBe(true);
      expect((json.images??[]).every((image:any)=>image.bufferView!==undefined)).toBe(true);
      const array=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);bytesToUrl.set(array,q.url);q.resolve(array);await flush();
    }
    const assets=await pending;
    try{
      expect(constructed).toEqual(queue.map(q=>q.url));let last=-1;
      for(const model of Object.values(assets.models)){
        const ids=new Set<number>();model.scene.traverse(node=>{if((node as THREE.Mesh).isMesh)for(const material of [(node as THREE.Mesh).material].flat())ids.add(material.id);});
        expect(Math.min(...ids)).toBeGreaterThan(last);last=Math.max(...ids);
      }
    }finally{assets.dispose();assets.dispose();}
  });

  it.each(['download','parse'] as const)('observes an early %s failure, drains late successes and disposes them once',async failure=>{
    const queue=downloads(),created:Array<ReturnType<typeof fixture>>=[];let parsed=0;
    vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async bytes=>{
      parsed++;if(failure==='parse'&&new Uint8Array(bytes as ArrayBuffer)[0]===1)throw new Error('fixture failure');
      const input=fixture();created.push(input);return input.model;
    });
    let settled=false;const pending=loadBattleAssets(undefined,'stylized-diffuse');
    const rejected=expect(pending).rejects.toThrow('fixture failure');void pending.finally(()=>{settled=true;}).catch(()=>{});
    // Failure arrives while the first manifest entry is still pending.
    if(failure==='download')queue[1]!.reject(new Error('fixture failure'));else queue[1]!.resolve(new Uint8Array([1]).buffer);
    await flush();expect(settled).toBe(false);expect(parsed).toBe(0);
    for(const q of queue.slice(2,-1))q.resolve(new Uint8Array([0]).buffer);
    queue[0]!.resolve(new Uint8Array([0]).buffer);await flush();
    expect(settled).toBe(false);expect(created).toHaveLength(17);
    for(const input of created)for(const dispose of input.disposals)expect(dispose).not.toHaveBeenCalled();
    queue.at(-1)!.resolve(new Uint8Array([0]).buffer);await rejected;
    expect(created).toHaveLength(18);for(const input of created){
      expect((input.model.scene.children[0] as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial);
      for(const dispose of input.disposals)expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the manager busy through a delayed parse and balances its model items on failure',async()=>{
    const queue=downloads(),manager=THREE.DefaultLoadingManager,start=vi.spyOn(manager,'itemStart'),end=vi.spyOn(manager,'itemEnd'),error=vi.spyOn(manager,'itemError');
    const input=fixture();let finish!:(model:GLTF)=>void,parses=0;
    vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(()=>++parses===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve(input.model));
    const pending=loadBattleAssets(),rejected=expect(pending).rejects.toThrow('download failed');
    queue[1]!.reject(new Error('download failed'));for(const q of queue.filter((_,i)=>i!==1))q.resolve(new ArrayBuffer(0));
    await flush();expect(start).toHaveBeenCalledTimes(19);expect(end).not.toHaveBeenCalled();expect(parses).toBe(1);
    finish(input.model);await rejected;expect(end).toHaveBeenCalledTimes(19);expect(error).toHaveBeenCalledExactlyOnceWith(queue[1]!.url);
    for(const dispose of input.disposals)expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('retains FileLoader URL modifiers and data-URI decoding without manager completion before parsing',async()=>{
    // Exercise native FileLoader, including Vite-compatible embedded data URLs.
    const json=JSON.stringify({asset:{version:'2.0'},scenes:[{}],scene:0}),chunk=Buffer.from(json.padEnd(Math.ceil(json.length/4)*4,' ')),header=Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+chunk.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
    const uri=`data:model/gltf-binary;base64,${Buffer.concat([header,chunk]).toString('base64')}`;
    vi.doMock('../../asset-pipeline/battle/exported/tree.glb?url',()=>({default:uri}));vi.resetModules();
    const {loadBattleAssets:loadEmbeddedAssets}=await import('../../src/render/battle-assets.js');
    const requested:string[]=[],paths:string[]=[],manager=THREE.DefaultLoadingManager,onLoad=vi.fn(),old=manager.onLoad,parse=GLTFLoader.prototype.parseAsync;
    manager.onLoad=onLoad;manager.setURLModifier(url=>{requested.push(url);return uri;});
    vi.stubGlobal('ProgressEvent',class {constructor(public type:string,public init:unknown){}});
    vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async function(this:GLTFLoader,bytes,path){
      expect(onLoad).not.toHaveBeenCalled();expect(bytes).toBeInstanceOf(ArrayBuffer);paths.push(path);return parse.call(this,bytes,path);
    });
    try{const assets=await loadEmbeddedAssets();expect(requested).toHaveLength(19);expect(requested).toContain(uri);expect(paths).toEqual(requested.map(url=>THREE.LoaderUtils.extractUrlBase(url)));expect(onLoad).toHaveBeenCalledTimes(1);assets.dispose();assets.dispose();}
    finally{manager.onLoad=old;vi.doUnmock('../../asset-pipeline/battle/exported/tree.glb?url');vi.resetModules();}
  });

  it('retains shared resource ownership through successful default loading and repeated disposal',async()=>{
    const queue=downloads(),input=fixture();vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(input.model);
    const pending=loadBattleAssets();for(const q of queue)q.resolve(new ArrayBuffer(0));const assets=await pending;
    for(const dispose of input.disposals)expect(dispose).not.toHaveBeenCalled();
    assets.dispose();assets.dispose();for(const dispose of input.disposals)expect(dispose).toHaveBeenCalledTimes(1);
  });
});
