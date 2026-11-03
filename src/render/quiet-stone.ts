import * as THREE from 'three';
import regions from '../../asset-pipeline/quiet-family/source/stone-regions.json';

export interface QuietStoneCoverage {assetId:string;nodeName:string;totalTriangles:number;stoneTriangles:number;stoneVertices:number;protectedTriangles:number;projectionConflicts:number}
export interface QuietStonePreparation {meshes:THREE.Mesh[];coverage:QuietStoneCoverage[];dispose():void}
export function isQuietStoneUv(u:number,v:number):boolean {
  const r=regions.stoneRect,e=1e-6;
  return Number.isFinite(u)&&Number.isFinite(v)&&u>r.minU+e&&u<r.maxU-e&&v>r.minV+e&&v<r.maxV-e;
}
/** Geometry-only candidate. Caller owns materials; original geometry/atlas data are never mutated. */
export function prepareQuietStone(root:THREE.Object3D,assetId:string):QuietStonePreparation {
  const expected=(regions.bodies as Record<string,string>)[assetId];
  const meshes:THREE.Mesh[]=[],coverage:QuietStoneCoverage[]=[];
  const owned:{mesh:THREE.Mesh;original:THREE.BufferGeometry;clone:THREE.BufferGeometry}[]=[];
  let disposed=false;
  root.updateWorldMatrix(true,true);
  const rootInverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
  if(expected)root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||object.name!==expected||Array.isArray(object.material)||object.material.name!==regions.material)return;
    const original=object.geometry as THREE.BufferGeometry,p=original.getAttribute('position'),uv=original.getAttribute('uv');
    if(!p||!uv||uv.count!==p.count)return;
    const index=original.index,count=index?.count??p.count;
    if(count%3!==0)return;
    const vertex=(i:number)=>index?index.getX(i):i;
    const triangles:number[][]=[],selected:boolean[]=[];
    for(let i=0;i<count;i+=3){const ids=[vertex(i),vertex(i+1),vertex(i+2)];triangles.push(ids);selected.push(ids.every(id=>isQuietStoneUv(uv.getX(id),uv.getY(id))));}
    // A shared vertex must not interpolate stone into any protected triangle.
    const blocked=new Uint8Array(p.count);
    let changed=true;
    while(changed){changed=false;triangles.forEach((ids,i)=>{if(!selected[i])ids.forEach(id=>{blocked[id]=1;});});triangles.forEach((ids,i)=>{if(selected[i]&&ids.some(id=>blocked[id])){selected[i]=false;changed=true;}});}
    const transform=new THREE.Matrix4().multiplyMatrices(rootInverse,object.matrixWorld);
    const positions=Array.from({length:p.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(transform));
    const assetPosition=new Float32Array(p.count*3),assetNormal=new Float32Array(p.count*3);
    const normalAttribute=original.getAttribute('normal'),normalMatrix=new THREE.Matrix3().getNormalMatrix(transform);
    for(let i=0;i<p.count;i++){positions[i]!.toArray(assetPosition,i*3);const n=normalAttribute?new THREE.Vector3().fromBufferAttribute(normalAttribute,i):new THREE.Vector3(0,1,0);n.applyNormalMatrix(normalMatrix).toArray(assetNormal,i*3);}
    const mask=new Float32Array(p.count),physicalUv=new Float32Array(p.count*2),axes=new Int8Array(p.count).fill(-1);
    let stoneTriangles=0,projectionConflicts=0;
    triangles.forEach((ids,i)=>{if(!selected[i])return;stoneTriangles++;
      const [a,b,c]=ids as [number,number,number];
      const normal=new THREE.Vector3().subVectors(positions[b]!,positions[a]!).cross(new THREE.Vector3().subVectors(positions[c]!,positions[a]!));
      const n=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)];const axis=n.indexOf(Math.max(...n));
      ids.forEach(id=>{mask[id]=1;if(axes[id]!==-1&&axes[id]!==axis)projectionConflicts++;else axes[id]=axis;});
    });
    for(let i=0;i<p.count;i++){const q=positions[i]!;const axis=axes[i];physicalUv[i*2]=(axis===0?q.z:q.x)/regions.periodMeters;physicalUv[i*2+1]=(axis===1?q.z:q.y)/regions.periodMeters;}
    const clone=original.clone();clone.setAttribute('quietStonePosition',new THREE.BufferAttribute(assetPosition,3));clone.setAttribute('quietStoneNormal',new THREE.BufferAttribute(assetNormal,3));clone.setAttribute('quietStoneMask',new THREE.BufferAttribute(mask,1));clone.setAttribute('quietStoneUv',new THREE.BufferAttribute(physicalUv,2));
    object.geometry=clone;owned.push({mesh:object,original,clone});meshes.push(object);
    coverage.push({assetId,nodeName:object.name,totalTriangles:count/3,stoneTriangles,stoneVertices:mask.reduce((a,b)=>a+b,0),protectedTriangles:count/3-stoneTriangles,projectionConflicts});
  });
  return {meshes,coverage,dispose(){if(disposed)return;disposed=true;for(const {mesh,original,clone} of owned){if(mesh.geometry===clone)mesh.geometry=original;clone.dispose();}}};
}
