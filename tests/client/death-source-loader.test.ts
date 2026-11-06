import {describe,it,expect} from 'vitest';
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
