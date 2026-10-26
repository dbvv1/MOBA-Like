import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../../asset-pipeline/battle/manifest.json';

// Vite emits every referenced GLB; source manifest URLs are not server-root assumptions.
const urls=import.meta.glob('../../asset-pipeline/battle/exported/*.glb',{query:'?url',import:'default',eager:true}) as Record<string,string>;
export type BattleAssets={models:Record<string,GLTF>;dispose():void};
export function releaseModels(models:Iterable<GLTF>){
  const resources=new Set<{dispose():void}>();
  for(const model of models)model.scene.traverse(node=>{
    const mesh=node as THREE.Mesh; if(!mesh.isMesh)return;
    resources.add(mesh.geometry);
    if((mesh as THREE.SkinnedMesh).isSkinnedMesh)resources.add((mesh as THREE.SkinnedMesh).skeleton);
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      resources.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)resources.add(value);
    }
  });
  for(const resource of resources)resource.dispose();
}
export async function loadBattleAssets(load=(url:string)=>new GLTFLoader().loadAsync(url)):Promise<BattleAssets>{
  const results=await Promise.allSettled(manifest.assets.map(async asset=>{
    const url=urls[`../../asset-pipeline/battle/exported/${asset.id}.glb`];
    if(!url)throw new Error(`Missing bundled battle asset ${asset.id}`);
    return [asset.id,await load(url)] as const;
  }));
  const fulfilled=results.filter((r):r is PromiseFulfilledResult<readonly[string,GLTF]>=>r.status==='fulfilled');
  const failed=results.find(r=>r.status==='rejected');
  if(failed){releaseModels(fulfilled.map(r=>r.value[1]));throw failed.reason;}
  const models=Object.fromEntries(fulfilled.map(r=>r.value));let disposed=false;
  return {models,dispose(){if(!disposed){disposed=true;releaseModels(Object.values(models));}}};
}
export const battleManifest=manifest;
