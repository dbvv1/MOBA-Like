import * as THREE from 'three';
import {applyWorldDiffuse,type LightingStyle} from './lighting-style.js';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../../asset-pipeline/battle/manifest.json';
import heroManifest from '../../asset-pipeline/heroes/veyra-release/manifest.json';
import siegeManifest from '../../asset-pipeline/content-set/siege/manifest.json';

// Vite emits every referenced GLB; source manifest URLs are not server-root assumptions.
const urls=import.meta.glob('../../asset-pipeline/battle/exported/*.glb',{query:'?url',import:'default',eager:true}) as Record<string,string>;
const heroUrls=import.meta.glob('../../asset-pipeline/heroes/veyra-release/exported/*.glb',{query:'?url',import:'default',eager:true}) as Record<string,string>;
const siegeUrls=import.meta.glob('../../asset-pipeline/content-set/siege/exported/*.glb',{query:'?url',import:'default',eager:true}) as Record<string,string>;
export type BattleAssets={models:Record<string,GLTF>;dispose():void};
function modelResources(models:Iterable<GLTF>,resources=new Set<{dispose():void}>()){
  for(const model of models)model.scene.traverse(node=>{
    const mesh=node as THREE.Mesh; if(!mesh.isMesh)return;
    resources.add(mesh.geometry);
    if((mesh as THREE.SkinnedMesh).isSkinnedMesh)resources.add((mesh as THREE.SkinnedMesh).skeleton);
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      resources.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)resources.add(value);
    }
  });
  return resources;
}
export function releaseModels(models:Iterable<GLTF>){
  for(const resource of modelResources(models))resource.dispose();
}
function orderedModelLoader(){
  let previous=Promise.resolve();
  return (url:string)=>{
    const loader=new GLTFLoader(),manager=loader.manager;
    // Keep GLTFLoader's extra manager item open through parsing (including textures).
    manager.itemStart(url);
    // Fetch every bundled GLB concurrently, but construct its Three resources in
    // manifest order: native opaque sorting uses material.id. FileLoader retains
    // URL modifiers, caching and data-URL support. Observe early failures now,
    // rather than leaving a rejected download unhandled behind a pending parse.
    const data=new THREE.FileLoader(manager).setResponseType('arraybuffer').loadAsync(url)
      .then(bytes=>({ok:true as const,bytes}),error=>({ok:false as const,error}));
    const loaded=previous.then(async()=>{
      const result=await data;if(!result.ok)throw result.error;
      // Same URL base as an unconfigured GLTFLoader.load; embedded resources and
      // relative external references keep their existing resolution contract.
      return loader.parseAsync(result.bytes as ArrayBuffer,THREE.LoaderUtils.extractUrlBase(url));
    }).then(model=>{manager.itemEnd(url);return model;},error=>{manager.itemError(url);manager.itemEnd(url);throw error;});
    // A failed asset must not strand later successes: allSettled owns cleanup.
    previous=loaded.then(()=>{},()=>{});
    return loaded;
  };
}
// Injected complete-model loaders retain their own construction/ordering contract.
export async function loadBattleAssets(load=orderedModelLoader(),lighting:LightingStyle='baseline'):Promise<BattleAssets>{
  const results=await Promise.allSettled([...manifest.assets.map(asset=>({id:asset.id,url:urls[`../../asset-pipeline/battle/exported/${asset.id}.glb`]})),...heroManifest.assets.map(asset=>({id:asset.id,url:heroUrls[`../../asset-pipeline/heroes/veyra-release/${asset.file}`]})),...siegeManifest.assets.map(asset=>({id:asset.id,url:siegeUrls[`../../asset-pipeline/content-set/siege/${asset.file}`]}))].map(async asset=>{
    const url=asset.url;
    if(!url)throw new Error(`Missing bundled battle asset ${asset.id}`);
    return [asset.id,await load(url)] as const;
  }));
  const fulfilled=results.filter((r):r is PromiseFulfilledResult<readonly[string,GLTF]>=>r.status==='fulfilled');
  const failed=results.find(r=>r.status==='rejected');
  if(failed){releaseModels(fulfilled.map(r=>r.value[1]));throw failed.reason;}
  const models=Object.fromEntries(fulfilled.map(r=>r.value));
  // Retain original resources too: diffuse conversion does not sample PBR-only
  // maps, but must not leak their textures or dispose shared maps early.
  const resources=modelResources(Object.values(models)),cache=new Map<THREE.Material,THREE.Material>();
  try{for(const model of Object.values(models))applyWorldDiffuse(model.scene,lighting,cache);}
  catch(error){modelResources(Object.values(models),resources);for(const material of cache.values())resources.add(material);for(const resource of resources)resource.dispose();throw error;}
  modelResources(Object.values(models),resources);let disposed=false;
  return {models,dispose(){if(!disposed){disposed=true;for(const resource of resources)resource.dispose();resources.clear();}}};
}
export const battleManifest=manifest;
export const siegeAssetManifest=siegeManifest;
