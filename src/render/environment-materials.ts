import * as THREE from 'three';
import {loadBoundedEnvironmentTexture} from './environment-materials-loader.js';

export const environmentSpecs={
  lane:{url:new URL('../../assets/environment-materials/lane-stone-albedo.png',import.meta.url).href+'#lane-stone-albedo.png',metres:8},
  structure:{url:new URL('../../assets/environment-materials/structure-stone-albedo.png',import.meta.url).href+'#structure-stone-albedo.png',metres:4},
  forest:{url:new URL('../../assets/environment-materials/forest-edge-albedo-v2.png',import.meta.url).href+'#forest-edge-albedo-v2.png',metres:8},
} as const;
export type EnvironmentKind=keyof typeof environmentSpecs;
export function environmentCandidate(search:string){return new URLSearchParams(search).get('environment-materials')==='v1';}

// Candidate-only CPU mapping: retain positions/normals, split triangles where
// projection changes, and use world coordinates so reused GLBs do not reset phase.
// MirroredRepeat avoids opposite-edge jumps but can create mirrored motifs. It
// is not evidence that the source is seamless or the game image is acceptable.
export function projectedGeometry(mesh:THREE.Mesh,metres:number,boxProjection=false){
  if(!Number.isFinite(metres)||metres<=0)throw new Error('Invalid environment texture scale');
  mesh.updateWorldMatrix(true,false);
  const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
  const positions=geometry.getAttribute('position'),uv=new Float32Array(positions.count*2);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<positions.count;i+=3){
    a.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions,i+1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions,i+2).applyMatrix4(mesh.matrixWorld);
    normal.crossVectors(b.clone().sub(a),c.clone().sub(a));
    const axis=!boxProjection||Math.abs(normal.y)>=Math.max(Math.abs(normal.x),Math.abs(normal.z))?'y':Math.abs(normal.x)>Math.abs(normal.z)?'x':'z';
    for(const [offset,p] of [a,b,c].entries()){
      uv[(i+offset)*2]=(axis==='x'?p.z:p.x)/metres;
      uv[(i+offset)*2+1]=(axis==='y'?p.z:p.y)/metres;
    }
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}
export type EnvironmentFamily=Awaited<ReturnType<typeof loadEnvironmentFamily>>;
export async function loadEnvironmentFamily(signal?:AbortSignal,load:(url:string)=>Promise<THREE.Texture>=url=>loadBoundedEnvironmentTexture(url,signal)){
  if(signal?.aborted)throw new Error('Environment material load cancelled');
  const kinds=Object.keys(environmentSpecs) as EnvironmentKind[];
  // A cancelled bitmap request can still decode; wait for all settlements
// and dispose those late resources, never attach them to a disposed battlefield.
  const results=await Promise.allSettled(kinds.map(kind=>Promise.resolve().then(()=>load(environmentSpecs[kind].url))));
  const textures=new Set(results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]));
  const failed=results.find(result=>result.status==='rejected');
  if(failed||signal?.aborted){for(const texture of textures)texture.dispose();throw failed?.reason??new Error('Environment material load cancelled');}
  const materials={} as Record<EnvironmentKind,THREE.MeshStandardMaterial>;
  try { results.forEach((result,index)=>{if(result.status!=='fulfilled')return;const texture=result.value;
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.MirroredRepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
    materials[kinds[index]!]=new THREE.MeshStandardMaterial({map:texture,color:0xffffff,roughness:1});
  }); }catch(error){for(const material of Object.values(materials))material.dispose();for(const texture of textures)texture.dispose();throw error;}
  const geometries=new Set<THREE.BufferGeometry>(),bound=new WeakSet<THREE.Mesh>();let disposed=false;
  return {materials,apply(mesh:THREE.Mesh,kind:EnvironmentKind){
    if(disposed||bound.has(mesh))return;
    const geometry=projectedGeometry(mesh,environmentSpecs[kind].metres,kind==='structure');
    geometries.add(geometry);mesh.geometry=geometry;mesh.material=materials[kind];bound.add(mesh);
  },dispose(){if(disposed)return;disposed=true;for(const geometry of geometries)geometry.dispose();geometries.clear();for(const material of Object.values(materials))material.dispose();for(const texture of textures)texture.dispose();}};
}
