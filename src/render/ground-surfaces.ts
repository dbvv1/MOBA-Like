import * as THREE from 'three';
import source from '../../asset-pipeline/ground-surfaces/exported/grass-geometries.json';
import layout from '../../asset-pipeline/ground-surfaces/source/edge-layout.json';

// Editable layout, not a world-covering texture. Nothing enters the central
// combat strip; each patch is a low, discontinuous bank, never an obstacle.
export function createGroundSurfaces(forestTexture?:THREE.Texture){
  const root=new THREE.Group();root.name='GroundEdgeClusters';
  const owned:Array<{dispose():void}>=[];
  const positions:number[]=[],colours:number[]=[];
  const instances:{blade:THREE.Matrix4[];leaf:THREE.Matrix4[]}={blade:[],leaf:[]};
  const patchColour=new THREE.Color(layout.palette.patch);
  for(const cluster of layout.clusters){
    let seed=cluster.seed;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const side=Math.sign(cluster.z);
    // Coarse polygon outline has a few broad, unequal lobes. No radial fade,
    // continuous shoulder halo, per-pixel noise, or repeated stamped texture.
    const edge:Array<[number,number]>=[];
    for(let i=0;i<11;i++){
      const angle=i*Math.PI*2/11,radius=.72+random()*.28;
      edge.push([cluster.x+Math.cos(angle)*cluster.width*.5*radius,
        side*Math.max(layout.clearHalfWidth,Math.abs(cluster.z)+Math.sin(angle)*cluster.depth*.5*radius)]);
    }
    // Same base colour as the surrounding grass makes the bank part of the
    // ground, not a disconnected flower-bed decal. Keep later seeded placement.
    random();
    const colour=patchColour;
    for(let i=0;i<edge.length;i++){
      // Mirroring the far/near bank also mirrors winding; keep both facing up.
      const pair=side>0?[edge[(i+1)%edge.length]!,edge[i]!]:[edge[i]!,edge[(i+1)%edge.length]!];
      for(const point of [[cluster.x,cluster.z],...pair]){
        positions.push(point[0]!,.009,point[1]!);colours.push(colour.r,colour.g,colour.b);
      }
    }
    for(let i=0;i<7;i++){
      const kind=i%3===0?'leaf':'blade',scale=1.25+random()*.65;
      const x=cluster.x+(random()-.5)*cluster.width*.72;
      const z=side*Math.max(layout.clearHalfWidth+.55,Math.abs(cluster.z)+(random()-.5)*cluster.depth*.65);
      const transform=new THREE.Object3D();transform.position.set(x,.013,z);
      transform.rotation.y=random()*Math.PI*2;transform.scale.set(scale,scale,scale);transform.updateMatrix();
      instances[kind].push(transform.matrix.clone());
    }
  }
  const patchGeometry=new THREE.BufferGeometry();
  patchGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  patchGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
  const uv:number[]=[];for(let i=0;i<positions.length;i+=3)uv.push(positions[i]!/12,positions[i+2]!/12);patchGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  patchGeometry.computeVertexNormals();patchGeometry.computeBoundingSphere();
  const patchMaterial=new THREE.MeshStandardMaterial({vertexColors:!forestTexture,map:forestTexture??null,roughness:1});
  const patches=new THREE.Mesh(patchGeometry,patchMaterial);patches.name='GroundShoulderPatches';patches.receiveShadow=true;
  // Battlefield is traversed for living-target picking. Pure decoration must
  // not pay triangle/instance intersections; ground commands use its own plane.
  patches.raycast=()=>{};root.add(patches);owned.push(patchGeometry,patchMaterial);
  for(const kind of ['blade','leaf'] as const){
    const geometry=new THREE.BufferGeometry(),data=source[kind];
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));
    const material=new THREE.MeshStandardMaterial({color:layout.palette[kind],roughness:1});
    const mesh=new THREE.InstancedMesh(geometry,material,instances[kind].length);mesh.name=`Ground-${kind}`;
    instances[kind].forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.raycast=()=>{};root.add(mesh);owned.push(geometry,material,mesh);
  }
  let disposed=false;
  return {root,dispose(){if(disposed)return;disposed=true;for(const resource of owned)resource.dispose();root.clear();}};
}
