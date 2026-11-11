import {afterEach,describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {heroSourceForEntry,heroPresentationAssets,VEYRA_MOTION_OPTIONS,type HeroSource} from '../../src/render/hero-presentation.js';
import {createPresentation} from '../../asset-pipeline/presentation/adapter.js';
import contactManifest from '../../asset-pipeline/veyra-death-contact/manifest.json';
import heroManifest from '../../asset-pipeline/heroes/veyra-release/manifest.json';
import {makeSim} from '../helpers.js';

const trial='?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('existing combat trial death-source boundary',()=>{
  it('selects only the full existing candidate route, never default, quiet or partial/ambiguous variants',()=>{
    expect(heroSourceForEntry(trial,true)).toBe('death-contact');
    expect(heroSourceForEntry(trial+'&materials=baseline',true)).toBe('death-contact');
    expect(heroSourceForEntry(trial)).toBe('baseline');
    for(const search of ['',trial.replace('&audio=critical-v1',''),trial.replace('&camera=hold-follow-v1',''),trial.replace('commands=buffer-v1','commands=other'),trial+'&materials=quiet-family-v1',trial+'&materials=unknown'])
      expect(heroSourceForEntry(search,true),search).toBe('baseline');
    for(const [name,value] of [['commands','buffer-v1'],['audio','critical-v1'],['camera','hold-follow-v1'],['lighting','forest-light-v1'],['materials','baseline']])
      expect(heroSourceForEntry(trial+`&${name}=${value}&${name}=${value}`,true),name).toBe('baseline');
  });

  it.each(['baseline','death-contact'] as const)('loads actual %s GLBs through production loader and snapshot consumer',async(source:HeroSource)=>{
    const {PNG}=createRequire(import.meta.url)('pngjs');
    const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){
      const texture=parser.json.textures[index],image=parser.json.images[texture.source];
      const bytes=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(bytes));
      const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;return value;
    }}));
    const requests:Array<{path:string;hash:string}>=[];
    const assets=await loadBattleAssets(async url=>{
      const path=url.split('?')[0]!.replace(/^\//,'');
      const bytes=await readFile(new URL(`../../${path}`,import.meta.url));
      requests.push({path,hash:sha(bytes)});
      return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    },'forest-light-v1',source);
    const viewAssets=heroPresentationAssets(assets);
    const sim=await makeSim(12,61),snapshot=sim.snapshot();
    const view=createPresentation({catalog:sim.catalog,assets:viewAssets,heroesOnly:true});
    try{
      expect(requests).toHaveLength(19);
      expect(requests.some(entry=>entry.path.includes('runtime-fallback'))).toBe(false);
      expect(requests.filter(entry=>entry.path.includes('veyra-'))).toHaveLength(2);
      for(const team of ['teal','rust']){
        const entry=(source==='baseline'?heroManifest:contactManifest).assets.find(asset=>asset.id===`veyra-${team}`)!;
        const request=requests.find(row=>row.path.endsWith(`/veyra-${team}.glb`))!;
        expect(request.hash).toBe(entry.sha256);
        expect(request.path).toContain(source==='baseline'?'heroes/veyra-release/exported/':'veyra-death-contact/exported/');
      }
      expect(viewAssets.byDefinition!.veyra!.motionOptions).toBe(VEYRA_MOTION_OPTIONS);
      // Actual production loader -> definition mapping -> snapshot consumer.
      // Only life flags and clock are fixture-controlled; the rig and mixer are real.
      view.sync(snapshot);view.advance(0,1);
      const dead={...snapshot,tick:1,timeSeconds:1/30,events:[],heroes:snapshot.heroes.map(hero=>({...hero,alive:false}))};
      view.sync(dead);view.advance(0,1);view.advance(.4);
      for(const hero of snapshot.heroes){
        const root=view.root.getObjectByName(`hero-${hero.id}`)!;
        const clip=assets.models[hero.team===0?'veyra-teal':'veyra-rust']!.animations.find(clip=>clip.name==='death')!;
        const track=clip.tracks.find(track=>track.name==='Root.position')!;
        expect(root.getObjectByName('Root')!.position.y).toBeCloseTo(track.values[12*3+1]!,5);
        expect(view.motionState().find(state=>state.id===hero.id)!.actions.map(action=>action.clip)).toEqual(['death.full']);
      }
      let released=0;const resources=new Set<THREE.BufferGeometry>();
      for(const model of Object.values(assets.models))model.scene.traverse(node=>{if((node as THREE.Mesh).isMesh)resources.add((node as THREE.Mesh).geometry);});
      for(const geometry of resources)geometry.addEventListener('dispose',()=>released++);
      view.dispose();expect(released).toBe(0);
      assets.dispose();assets.dispose();expect(released).toBe(resources.size);
    }finally{view.dispose();assets.dispose();}
  });
});

// Exercise the actual download -> pin -> GLTFLoader path without a renderer.
// The existing injected-loader tests above exercise model ownership separately.
describe('received contact release bytes reach the actual parser',()=>{
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
  function downloaded(change?:(bytes:ArrayBuffer,url:string)=>ArrayBuffer){
    const parse=GLTFLoader.prototype.parseAsync,parsed:string[]=[],sourceByBytes=new Map<ArrayBuffer,string>();
    vi.spyOn(THREE.FileLoader.prototype,'loadAsync').mockImplementation(async url=>{
      const path=url.split('?')[0]!.replace(/^\//,'');
      const buffer=await readFile(new URL(`../../${path}`,import.meta.url));
      const bytes=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
      const selected=change?change(bytes,url):bytes;sourceByBytes.set(selected,url);return selected;
    });
    vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async function(this:GLTFLoader,bytes,path){
      parsed.push(sourceByBytes.get(bytes as ArrayBuffer)!);
      const {PNG}=createRequire(import.meta.url)('pngjs');
      this.register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){
        const texture=parser.json.textures[index],image=parser.json.images[texture.source];
        const input=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(input));
        const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;return value;
      }}));
      return parse.call(this,bytes,path);
    });
    return parsed;
  }

  it('verifies both source exports, parses them in original slot order and plays their actual death tracks',async()=>{
    const parsed=downloaded(),digest=vi.spyOn(globalThis.crypto.subtle,'digest');
    const assets=await loadBattleAssets(undefined,'forest-light-v1','death-contact');
    try{
      expect(parsed).toHaveLength(19);expect(digest).toHaveBeenCalledTimes(2);
      const selected=parsed.filter(path=>path.includes('veyra-'));
      expect(selected).toHaveLength(2);
      for(const [index,team] of ['teal','rust'].entries()){
        expect(selected[index]).toContain(`/veyra-death-contact/exported/veyra-${team}.glb`);
        const model=assets.models[`veyra-${team}`]!;
        const source=await readFile(new URL(`../../asset-pipeline/veyra-death-contact/exported/veyra-${team}.glb`,import.meta.url));
        const expected=await new GLTFLoader().parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
        const actualRoot=model.scene.clone(),mixer=new THREE.AnimationMixer(actualRoot),clip=model.animations.find(clip=>clip.name==='death')!;
        mixer.clipAction(clip).play();mixer.setTime(13/30);actualRoot.updateMatrixWorld(true);
        const track=expected.animations.find(clip=>clip.name==='death')!.tracks.find(track=>track.name==='Root.position')!;
        expect(actualRoot.getObjectByName('Root')!.position.y).toBeCloseTo(track.values[12*3+1]!,5);
        mixer.stopAllAction();mixer.uncacheRoot(actualRoot);
      }
    }finally{assets.dispose();}
  });

  it.each(['same-size','truncated','missing-crypto'] as const)('rejects %s contact before parsing it, releases other models and allows the original release to load',async failure=>{
    const parsed=downloaded((bytes,url)=>{
      if(!url.includes('/veyra-death-contact/exported/veyra-teal'))return bytes;
      if(failure==='truncated')return bytes.slice(0,-1);
      if(failure==='same-size'){new Uint8Array(bytes)[bytes.byteLength-1]^=1;}
      return bytes;
    });
    const disposed=vi.spyOn(THREE.BufferGeometry.prototype,'dispose');
    if(failure==='missing-crypto')vi.stubGlobal('crypto',undefined);
    const message=failure==='truncated'?'byte count mismatch':failure==='same-size'?'SHA-256 mismatch':'verification unavailable';
    await expect(loadBattleAssets(undefined,'forest-light-v1','death-contact')).rejects.toThrow(message);
    expect(parsed.some(path=>path.includes('/veyra-death-contact/exported/veyra-teal'))).toBe(false);
    expect(disposed).toHaveBeenCalled();
    const afterFailure=parsed.length;
    const restored=await loadBattleAssets(undefined,'forest-light-v1','baseline');
    try{
      const retry=parsed.slice(afterFailure);expect(retry).toHaveLength(19);
      expect(retry.filter(path=>path.includes('/heroes/veyra-release/exported/'))).toHaveLength(2);
      expect(retry.some(path=>path.includes('/veyra-death-contact/'))).toBe(false);
    }finally{restored.dispose();}
  });

  it('rejects a replaced or missing contact manifest entry before requesting assets',async()=>{
    const load=vi.fn();
    const first=contactManifest.assets[0]!,original=first.sha256;
    try{
      first.sha256='0'.repeat(64);
      await expect(loadBattleAssets(load,'forest-light-v1','death-contact')).rejects.toThrow('release pin mismatch');
      expect(load).not.toHaveBeenCalled();
    }finally{first.sha256=original;}
    const removed=contactManifest.assets.pop()!;
    try{
      await expect(loadBattleAssets(load,'forest-light-v1','death-contact')).rejects.toThrow('release pin mismatch');
      expect(load).not.toHaveBeenCalled();
    }finally{contactManifest.assets.push(removed);}
  });
});
