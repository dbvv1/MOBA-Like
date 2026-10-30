import * as THREE from 'three';
import {loadTerrainTexturePair} from './terrain-textures.js';
export type MaterialStyle='baseline'|'ai-pair-v1';
export function parseMaterialStyle(search:string):MaterialStyle{
  const values=new URLSearchParams(search).getAll('materials');
  if(values.length>1)throw new Error('Duplicate materials parameter');
  const value=values[0]??'baseline';
  if(value!=='baseline'&&value!=='ai-pair-v1')throw new Error(`Unknown materials '${value}'`);
  return value;
}
export type AiMaterialPair={ground:THREE.Texture;wall:THREE.Texture;dispose():void};
export async function loadAiMaterialPair():Promise<AiMaterialPair|undefined>{
  const pair=await loadTerrainTexturePair({road:new URL('../../asset-pipeline/ai-material-pair-v1/exported/ground-stone-earth-v2.webp',import.meta.url).href,forest:new URL('../../asset-pipeline/ai-material-pair-v1/exported/wall-stone-v2.webp',import.meta.url).href});
  if(!pair)return undefined;
  // Existing road UV has 10m period: 2.5 repeats gives 4m/source tile.
  pair.road.repeat.setScalar(2.5);
  return {ground:pair.road,wall:pair.forest,dispose:()=>pair.dispose()};
}
/** Attribute-only projection: preserve positions, indices, normals and all bounds. */
export function wallUvGeometry(source:THREE.BufferGeometry){
  const geometry=source.clone(),position=source.getAttribute('position'),normal=source.getAttribute('normal'),uv:number[]=[];
  for(let i=0;i<position.count;i++){
    const nx=Math.abs(normal.getX(i)),ny=Math.abs(normal.getY(i)),nz=Math.abs(normal.getZ(i));
    uv.push((ny>nx&&ny>nz?position.getX(i):nx>nz?position.getZ(i):position.getX(i))/2,(ny>nx&&ny>nz?position.getZ(i):position.getY(i))/2);
  }
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geometry;
}
/** Only the existing outer-tower masonry body, not team standard/catapult/wood. */
export function applyTowerMaterialSample(root:THREE.Object3D,wall:THREE.Texture){
  const owned:Array<{dispose():void}>=[];
  root.traverse(node=>{const mesh=node as THREE.Mesh;
    if(!mesh.isMesh||mesh.name!=='building_tower_catapult_green'||Array.isArray(mesh.material))return;
    const source=mesh.material as THREE.MeshStandardMaterial;
    const material=source.clone();material.map=wall;material.color.set(0xffffff);material.needsUpdate=true;
    const geometry=wallUvGeometry(mesh.geometry);mesh.geometry=geometry;mesh.material=material;owned.push(geometry,material);
  });
  let disposed=false;return {count:owned.length/2,dispose(){if(disposed)return;disposed=true;for(const resource of owned)resource.dispose();}};
}
