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
export function createTerrainComposition(textures:TerrainTextures){
  const root=new THREE.Group();root.name='TerrainComposition';
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.MeshStandardMaterial[]=[];
  const road:number[]=[],forest:number[]=[];
  const triangle=(out:number[],a:number[],b:number[],c:number[])=>out.push(...a,...b,...c);
  const quad=(out:number[],x:number,next:number,left:number,right:number,nextLeft:number,nextRight:number,y:number)=>{
    const a=[x,y,left],b=[next,y,nextLeft],c=[x,y,right],d=[next,y,nextRight];
    triangle(out,a,c,b);triangle(out,b,c,d);
  };
  for(let x=layout.world.minX;x<layout.world.maxX;x+=layout.road.sampleMeters){
    const next=Math.min(x+layout.road.sampleMeters,layout.world.maxX),a=roadCrossSection(x),b=roadCrossSection(next);
    quad(road,x,next,a.south,a.north,b.south,b.north,0);
    quad(forest,x,next,-layout.world.halfDepth,a.south,-layout.world.halfDepth,b.south,0);
    quad(forest,x,next,a.north,layout.world.halfDepth,b.north,layout.world.halfDepth,0);
  }
  quad(forest,layout.world.minX-90,layout.world.minX,-90,90,-90,90,0);
  quad(forest,layout.world.maxX,layout.world.maxX+90,-90,90,-90,90,0);
  function add(name:string,vertices:number[],texture:THREE.Texture,period:number){
    const geometry=new THREE.BufferGeometry(),uv:number[]=[];
    for(let i=0;i<vertices.length;i+=3)uv.push(vertices[i]!/period,vertices[i+2]!/period);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({map:texture,color:0xffffff,roughness:1,metalness:0});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.raycast=()=>{};root.add(mesh);geometries.push(geometry);materials.push(material);
  }
  add('ContinuousRoadAndClearings',road,textures.road,layout.road.tileMeters);
  add('ContinuousForestFloor',forest,textures.forest,layout.forest.tileMeters);
  let disposed=false;return {root,dispose(){if(disposed)return;disposed=true;for(const x of [...geometries,...materials])x.dispose();root.clear();}};
}
