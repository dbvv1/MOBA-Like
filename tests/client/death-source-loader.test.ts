import {afterEach,describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadBattleAssets} from '../../src/render/battle-assets.js';
import {heroSourceForEntry,heroPresentationAssets,MORROW_MOTION_OPTIONS,VEYRA_MOTION_OPTIONS,type HeroSource} from '../../src/render/hero-presentation.js';
import {createPresentation} from '../../asset-pipeline/presentation/adapter.js';
import contactManifest from '../../asset-pipeline/veyra-death-contact/canonical/manifest.json';
import morrowManifest from '../../asset-pipeline/battle/morrow-ranged/manifest.json';
import battleManifest from '../../asset-pipeline/battle/manifest.json';
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
    const viewAssets=heroPresentationAssets(assets,source);
    expect(viewAssets.byDefinition!.morrow!.motionOptions).toBe(source==='death-contact'?MORROW_MOTION_OPTIONS:undefined);
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
        expect(request.path).toContain(source==='baseline'?'heroes/veyra-release/exported/':'veyra-death-contact/canonical/exported/');
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
      expect(parsed).toHaveLength(19);expect(digest).toHaveBeenCalledTimes(4);
      const selected=parsed.filter(path=>path.includes('veyra-'));
      expect(selected).toHaveLength(2);
      for(const [index,team] of ['teal','rust'].entries()){
        expect(selected[index]).toContain(`/veyra-death-contact/canonical/exported/veyra-${team}.glb`);
        const model=assets.models[`veyra-${team}`]!;
        const source=await readFile(new URL(`../../asset-pipeline/veyra-death-contact/canonical/exported/veyra-${team}.glb`,import.meta.url));
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
      if(!url.includes('/veyra-death-contact/canonical/exported/veyra-teal'))return bytes;
      if(failure==='truncated')return bytes.slice(0,-1);
      if(failure==='same-size'){new Uint8Array(bytes)[bytes.byteLength-1]^=1;}
      return bytes;
    });
    const disposed=vi.spyOn(THREE.BufferGeometry.prototype,'dispose');
    if(failure==='missing-crypto')vi.stubGlobal('crypto',undefined);
    const message=failure==='truncated'?'byte count mismatch':failure==='same-size'?'SHA-256 mismatch':'verification unavailable';
    await expect(loadBattleAssets(undefined,'forest-light-v1','death-contact')).rejects.toThrow(message);
    expect(parsed.some(path=>path.includes('/veyra-death-contact/canonical/exported/veyra-teal'))).toBe(false);
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
  it.each(['same-size','truncated','download'] as const)('rejects Morrow %s before parse and releases successful models',async failure=>{
    const parsed=downloaded((bytes,url)=>{
      if(!url.includes('/morrow-ranged/exported/morrow-teal'))return bytes;
      if(failure==='download')throw new Error('Morrow download failed');
      if(failure==='truncated')return bytes.slice(0,-1);
      new Uint8Array(bytes)[bytes.byteLength-1]^=1;return bytes;
    });
    const disposed=vi.spyOn(THREE.BufferGeometry.prototype,'dispose');
    await expect(loadBattleAssets(undefined,'forest-light-v1','death-contact')).rejects.toThrow(failure==='download'?'download failed':failure==='truncated'?'byte count mismatch':'SHA-256 mismatch');
    expect(parsed.some(p=>p.includes('/morrow-ranged/exported/morrow-teal'))).toBe(false);expect(disposed).toHaveBeenCalled();
    const restored=await loadBattleAssets(undefined,'forest-light-v1','baseline');restored.dispose();
  });
  it('rejects changed or missing Morrow source pins before downloads',async()=>{
    const load=vi.fn(),first=morrowManifest.assets[0]!,old=first.sha256;
    try{first.sha256='0'.repeat(64);await expect(loadBattleAssets(load,'forest-light-v1','death-contact')).rejects.toThrow('Morrow ranged release pin mismatch');expect(load).not.toHaveBeenCalled();}finally{first.sha256=old;}
    const removed=morrowManifest.assets.pop()!;
    try{await expect(loadBattleAssets(load,'forest-light-v1','death-contact')).rejects.toThrow('Morrow ranged release pin mismatch');expect(load).not.toHaveBeenCalled();}finally{morrowManifest.assets.push(removed);}
  });
  it('maps both verified Morrow models into isolated production actors and keeps closed routes on original hashes',async()=>{
    const parsed=downloaded();
    const assets=await loadBattleAssets(undefined,'forest-light-v1','death-contact');
    const sim=await makeSim(12,61),snapshot=sim.snapshot();
    const mapped=heroPresentationAssets(assets,'death-contact');expect(mapped.byDefinition!.morrow!.blue).toBe(assets.models['hero-teal']);expect(mapped.byDefinition!.morrow!.amber).toBe(assets.models['hero-rust']);
    const view=createPresentation({catalog:sim.catalog,assets:mapped,heroesOnly:true});
    const heroes=snapshot.heroes.map(h=>({...h,definitionId:'morrow'}));
    try{
      expect(parsed.filter(p=>p.includes('/morrow-ranged/exported/'))).toHaveLength(2);
      view.sync({...snapshot,heroes,events:[{type:'castStarted',heroId:heroes[0]!.id,action:'basicAttack',castId:9,windupTicks:9,tick:0,ordinal:0}]});view.advance(0,1);
      const roots=heroes.map(h=>view.root.getObjectByName(`hero-${h.id}`)!);
      const reference=createPresentation({catalog:sim.catalog,assets:mapped,heroesOnly:true});reference.sync({...snapshot,heroes});reference.advance(0,1);reference.sync({...snapshot,tick:1,timeSeconds:.3,heroes,events:[]});reference.advance(0,1);
      const baseline=reference.root.getObjectByName(`hero-${heroes[1]!.id}`)!.getObjectByName('Hand_R')!.quaternion.clone();reference.dispose();
      const actor=heroes[0]!;
      view.sync({...snapshot,tick:1,timeSeconds:.3,heroes,events:[{type:'castResolved',heroId:actor.id,castId:9,tick:1,ordinal:0}]});view.advance(0,1);
      expect(view.motionState().find(a=>a.id===actor.id)!.actions.some(a=>a.clip==='attack.upper'&&Math.abs(a.time-.6)<1e-6)).toBe(true);
      expect(roots[1]!.getObjectByName('Hand_R')!.quaternion.equals(baseline)).toBe(true);
      view.sync({...snapshot,tick:2,timeSeconds:.32,heroes,events:[{type:'heroDamaged',targetId:actor.id,sourceId:heroes[1]!.id,hpDamage:5,shieldAbsorbed:0,abilityId:null,tick:2,ordinal:0}]});view.advance(0,1);
      view.sync({...snapshot,tick:3,timeSeconds:.4,heroes,events:[]});view.advance(0,1);
      const damaged=view.motionState().find(a=>a.id===actor.id)!.actions;
      expect(damaged.find(a=>a.clip==='attack.upper')?.weight).toBeCloseTo(1);
      expect(damaged.find(a=>a.clip==='hurt.additiveTorso')?.weight).toBeCloseTo(.3);
      expect(roots[0]!.getObjectByName('Hand_R')).not.toBe(roots[1]!.getObjectByName('Hand_R'));
      view.reset();view.sync({...snapshot,heroes});view.advance(0,1);expect(view.inspect().heroes.every(h=>h.action==='idle')).toBe(true);
    }finally{view.dispose();assets.dispose();}
    for(const [search,candidate] of [[trial,false],['',true],[trial+'&materials=quiet-family-v1',true],[trial+'&camera=baseline',true]] as const){
      const paths:string[]=[];
      const closed=await loadBattleAssets(async url=>{const path=url.split('?')[0]!.replace(/^\//,'');paths.push(path);const bytes=await readFile(path);const id=path.split('/').pop()!.replace('.glb','');if(id==='hero-teal'||id==='hero-rust')expect(sha(bytes)).toBe(battleManifest.assets.find(a=>a.id===id)!.sha256);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');},'forest-light-v1',heroSourceForEntry(search,candidate));
      expect(paths.some(p=>p.includes('/morrow-ranged/'))).toBe(false);closed.dispose();
    }
  });

});
