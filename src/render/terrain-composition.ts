import {bindQuietGround,groundHeightAt,type QuietTextures,ROAD_SURFACE_Y,roadDistance,roadShoulderWidth,SHOULDER_FALLOFF,shoulderBankHeight} from './quiet-family.js';
import {surfaceMaterial,type LightingStyle} from './lighting-style.js';
import * as THREE from 'three';
import layout from '../../asset-pipeline/terrain-composition/source/layout.json';

export type TerrainTextures={road:THREE.Texture;forest:THREE.Texture};
/** Visual surface only: grass is still walkable, and no simulation bounds change. */
export function roadCrossSection(x:number){
  const center=.35*Math.sin(x*.07);
  let south=center-layout.road.halfWidth-.22*Math.sin(x*.39),north=center+layout.road.halfWidth+.27*Math.sin(x*.31+1);
  for(const clearing of layout.clearings){
    const dx=x-clearing.x;
    if(Math.abs(dx)>=clearing.radius)continue;
    const radius=Math.sqrt(clearing.radius**2-dx**2);
    south=Math.min(south,-radius);north=Math.max(north,radius);
  }
  const cap=Math.min(1,Math.max(0,(110-Math.abs(x))/2));
  return {south:south*cap,north:north*cap};
}
interface TerrainPoint {z:number;y:number}
interface TerrainColumns {south:TerrainPoint[];north:TerrainPoint[]}
/** Equal row counts on every column keep the bank mesh a continuous strip while
 * the crest itself moves in and out with the low-frequency shoulder width. The
 * flat walkable surface stays at y=0; this bank is a decorative overlay that
 * rises from the road edge and settles back into it outside the falloff. */
function columns(x:number):TerrainColumns{
  const section=roadCrossSection(x),width=Math.max(.85,roadShoulderWidth(x));
  const distances=[0,width*.42,width,width+1.05,width+SHOULDER_FALLOFF*.55,width+SHOULDER_FALLOFF,width+SHOULDER_FALLOFF+12,layout.world.halfDepth];
  const profile=distances.map(distance=>({distance,y:shoulderBankHeight(x,distance)+.006}));
  return {
    south:profile.map(point=>({z:section.south-point.distance,y:point.y})),
    north:profile.map(point=>({z:section.north+point.distance,y:point.y})),
  };
}
/** Flat base surfaces; the separate shoulder overlay carries the bank relief. */
function flatQuad(out:number[],x:number,next:number,left:number,right:number,nextLeft:number,nextRight:number,y:number){
  const a=[x,y,left],b=[next,y,nextLeft],c=[x,y,right],d=[next,y,nextRight];
  out.push(...a,...c,...b,...b,...c,...d);
}
function stripQuad(out:number[],x:number,next:number,leftAtX:TerrainPoint,leftAtNext:TerrainPoint,rightAtX:TerrainPoint,rightAtNext:TerrainPoint){
  const a=[x,leftAtX.y,leftAtX.z],b=[next,leftAtNext.y,leftAtNext.z],c=[x,rightAtX.y,rightAtX.z],d=[next,rightAtNext.y,rightAtNext.z];
  out.push(...a,...c,...b,...b,...c,...d);
}
export function createTerrainComposition(textures:TerrainTextures,lighting:LightingStyle='baseline',quiet?:QuietTextures){
  const root=new THREE.Group();root.name='TerrainComposition';
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],extras:{dispose():void}[]=[];
  const road:number[]=[],forest:number[]=[],bank:number[]=[];
  for(let x=layout.world.minX;x<layout.world.maxX;x+=layout.road.sampleMeters){
    const next=Math.min(x+layout.road.sampleMeters,layout.world.maxX),a=roadCrossSection(x),b=roadCrossSection(next);
    flatQuad(road,x,next,a.south,a.north,b.south,b.north,ROAD_SURFACE_Y);
    // The walkable/grass base stays flat. Height lives in the shoulder overlay.
    flatQuad(forest,x,next,-layout.world.halfDepth,a.south,-layout.world.halfDepth,b.south,0);
    flatQuad(forest,x,next,a.north,layout.world.halfDepth,b.north,layout.world.halfDepth,0);
    const left=columns(x),right=columns(next);
    // South lies at smaller z: outer row first keeps every face upward.
    for(let row=0;row<5;row++)stripQuad(bank,x,next,left.south[row+1]!,right.south[row+1]!,left.south[row]!,right.south[row]!);
    for(let row=0;row<5;row++)stripQuad(bank,x,next,left.north[row]!,right.north[row]!,left.north[row+1]!,right.north[row+1]!);
  }
  flatQuad(forest,layout.world.minX-90,layout.world.minX,-90,90,-90,90,0);
  flatQuad(forest,layout.world.maxX,layout.world.maxX+90,-90,90,-90,90,0);
  function geometryFor(vertices:number[],period:number){
    const geometry=new THREE.BufferGeometry(),uv:number[]=[];
    for(let i=0;i<vertices.length;i+=3)uv.push(vertices[i]!/period,vertices[i+2]!/period);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    return geometry;
  }
  function add(name:string,vertices:number[],texture:THREE.Texture,period:number){
    const geometry=geometryFor(vertices,period);
    const material=surfaceMaterial(lighting,{map:texture,color:0xffffff});
    if(quiet)bindQuietGround(material,quiet);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.raycast=()=>{};root.add(mesh);geometries.push(geometry);materials.push(material);
    return mesh;
  }
  add('ContinuousRoadAndClearings',road,textures.road,layout.road.tileMeters);
  const forestMesh=add('ContinuousForestFloor',forest,textures.forest,layout.forest.tileMeters);
  // The bank is a child of the grass surface so direct surface readers still see
  // the flat, walkable base while the shoulder can carry its full relief.
  const bankGeometry=geometryFor(bank,layout.forest.tileMeters);
  const bankMesh=new THREE.Mesh(bankGeometry,forestMesh.material);bankMesh.name='ShoulderBank';
  bankMesh.receiveShadow=true;bankMesh.castShadow=false;bankMesh.raycast=()=>{};forestMesh.add(bankMesh);extras.push(bankGeometry);
  const stones=addShoulderStones(lighting);
  if(stones){forestMesh.add(stones.root);geometries.push(...stones.geometries);materials.push(...stones.materials);extras.push(stones.root);}
  let disposed=false;return {root,dispose(){if(disposed)return;disposed=true;for(const x of [...geometries,...materials,...extras])x.dispose();forestMesh.clear();root.clear();}};
}
/** A handful of grouped, flattened slabs at bends and the outer edge of tower
 * clearings. They stay on the grass bank; the lane centre line is never touched. */
function addShoulderStones(lighting:LightingStyle){
  const groups:{x:number;side:-1|1}[]=[];
  for(const [index,clearing] of layout.clearings.entries()){
    if(clearing.kind!=='tower'&&clearing.kind!=='barracks')continue;
    groups.push({x:clearing.x+(index%2===0?.62:-.62)*clearing.radius,side:index%2===0?-1:1});
    if(clearing.kind==='tower'&&index%3===0)groups.push({x:clearing.x-.7*clearing.radius,side:1});
  }
  for(const [index,x] of [-44,-12,8,44,68].entries())groups.push({x,side:index%2===0?-1:1});
  let seed=0x2c1b3d4f;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const geometry=new THREE.DodecahedronGeometry(1,0);
  const material=surfaceMaterial(lighting,{color:0xffffff});
  if(material instanceof THREE.MeshStandardMaterial){material.roughness=1;material.metalness=0;material.flatShading=true;}
  const palette=['#b6ad94','#a59c84','#c1b79c','#948c76'].map(value=>new THREE.Color(value));
  const matrices:THREE.Matrix4[]=[],colors:THREE.Color[]=[];
  const position=new THREE.Vector3(),scale=new THREE.Vector3(),quaternion=new THREE.Quaternion(),euler=new THREE.Euler();
  for(const group of groups){
    const count=3+Math.floor(random()*3);
    for(let index=0;index<count;index++){
      const x=group.x+(random()-.5)*3.4;
      const section=roadCrossSection(x),width=Math.max(.85,roadShoulderWidth(x));
      const edge=group.side<0?section.south:section.north;
      const z=edge+group.side*(width+.18+random()*1.15);
      if(roadDistance(x,z)>-.3)continue;
      const y=groundHeightAt(x,z)-.035;
      position.set(x,y,z);
      euler.set(0,random()*Math.PI*2,(random()-.5)*.16);quaternion.setFromEuler(euler);
      scale.set(.42+random()*.58,.09+random()*.13,.36+random()*.52);
      matrices.push(new THREE.Matrix4().compose(position,quaternion,scale));
      colors.push(palette[Math.floor(random()*palette.length)]!);
    }
  }
  if(!matrices.length){geometry.dispose();material.dispose();return null;}
  const mesh=new THREE.InstancedMesh(geometry,material,matrices.length);mesh.name='ShoulderStoneGroups';
  matrices.forEach((matrix,index)=>{mesh.setMatrixAt(index,matrix);mesh.setColorAt(index,colors[index]!);});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.computeBoundingSphere();
  return {root:mesh,geometries:[geometry],materials:[material]};
}
