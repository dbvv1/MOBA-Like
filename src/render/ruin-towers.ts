import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {surfaceMaterial,type LightingStyle} from './lighting-style.js';
import {CRYSTAL_BLOOM_LAYER} from './selective-bloom.js';

const STONE={base:'#7e7867',shaft:'#958f7a',shaftLight:'#a59d85',coping:'#b6ab91',recess:'#6c695b',moss:'#61705a'} as const;
const RADIANS=Math.PI*2/3;

/** A four-sided tapered prism. The local +X axis is radial, so one primitive
 * turns into a buttress with a broad foot and a narrow shoulder against the
 * existing stone body. */
function wedge(xInBottom:number,xOutBottom:number,zHalfBottom:number,xInTop:number,xOutTop:number,zHalfTop:number,height:number){
  const positions=[
    xInBottom,0,-zHalfBottom, xOutBottom,0,-zHalfBottom, xOutBottom,0,zHalfBottom, xInBottom,0,zHalfBottom,
    xInTop,height,-zHalfTop, xOutTop,height,-zHalfTop, xOutTop,height,zHalfTop, xInTop,height,zHalfTop,
  ];
  const indices=[
    0,1,2, 0,2,3,
    4,6,5, 4,7,6,
    1,5,6, 1,6,2,
    3,4,0, 3,7,4,
    0,4,5, 0,5,1,
    3,2,6, 3,6,7,
  ];
  const uv=positions.filter((_,index)=>index%3!==1).map((value,index)=>value*(index%2===0?.5:.35));
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function paint(geometry:THREE.BufferGeometry,color:THREE.Color){
  const count=geometry.getAttribute('position').count,values=new Float32Array(count*3);
  for(let i=0;i<count;i++)color.toArray(values,i*3);
  geometry.setAttribute('color',new THREE.BufferAttribute(values,3));return geometry;
}

function transformed(geometry:THREE.BufferGeometry,matrix:THREE.Matrix4,color:THREE.Color){
  const clone=geometry.clone().applyMatrix4(matrix);paint(clone,color);return clone;
}

/** Tall, faceted energy shard. Kept separate from the stone merge so it can
 * occupy the selective-bloom layer and carry controlled emissive. */
function shard(height:number,width:number){
  const rings=[{y:0,r:width*.58},{y:.22*height,r:width},{y:.62*height,r:width*.86},{y:height,r:width*.03}];
  const sides=6,positions:number[]=[],indices:number[]=[];
  for(const ring of rings)for(let i=0;i<sides;i++){
    const angle=i/sides*Math.PI*2;positions.push(Math.cos(angle)*ring.r,ring.y,Math.sin(angle)*ring.r);
  }
  for(let ring=0;ring<rings.length-1;ring++)for(let i=0;i<sides;i++){
    const a=ring*sides+i,b=ring*sides+(i+1)%sides,c=(ring+1)*sides+i,d=(ring+1)*sides+(i+1)%sides;
    indices.push(a,c,b,b,c,d);
  }
  for(let i=1;i<sides-1;i++)indices.push(0,i,i+1);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(Array.from({length:positions.length/3*2},(_,i)=>(i%2)*.5),2));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function compose(x:number,y:number,z:number,rotation=0){
  return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,rotation,0)),new THREE.Vector3(1,1,1));
}

function ruinGeometry(){
  const parts:THREE.BufferGeometry[]=[];
  const color=(value:string)=>new THREE.Color(value);
  const base=new THREE.CylinderGeometry(2.4,2.58,.26,8);
  parts.push(transformed(base,compose(0,.13,0,Math.PI/8),color(STONE.base)));base.dispose();
  for(let index=0;index<3;index++){
    const angle=index*RADIANS+Math.PI/6;
    const lower=wedge(1.05,3.04,.94,1.5,2.62,.7,2.52);
    parts.push(transformed(lower,compose(0,.2,0,angle),color(index===1?STONE.shaftLight:STONE.shaft)));lower.dispose();
    const upper=wedge(1.45,2.66,.7,1.66,2.28,.42,1.86);
    parts.push(transformed(upper,compose(0,2.72,0,angle),color(STONE.shaft)));upper.dispose();
    const plinth=new THREE.BoxGeometry(1.99,.32,1.7);
    const plinthMatrix=compose(0,.28,0,angle).multiply(new THREE.Matrix4().makeTranslation(2.04,0,0));
    parts.push(transformed(plinth,plinthMatrix,color(STONE.recess)));plinth.dispose();
    const cap=new THREE.BoxGeometry(.94,.28,.94);
    const capMatrix=compose(0,4.62,0,angle).multiply(new THREE.Matrix4().makeTranslation(1.92,0,0));
    parts.push(transformed(cap,capMatrix,color(STONE.coping)));cap.dispose();
  }
  const cornices=[
    [2.06,2.2,.22,4.67,STONE.shaftLight],
    [1.86,2.04,.2,4.98,STONE.coping],
    [2.04,1.84,.3,5.28,STONE.shaft],
    [1.74,2.02,.28,5.58,STONE.coping],
  ] as const;
  for(const [top,bottom,height,y,tint] of cornices){
    const ring=new THREE.CylinderGeometry(top,bottom,height,8);parts.push(transformed(ring,compose(0,y,0,Math.PI/8),color(tint)));ring.dispose();
  }
  for(let index=0;index<6;index++){
    const angle=index/6*Math.PI*2;
    const block=new THREE.BoxGeometry(.66,.46,.38);
    const matrix=compose(Math.cos(angle)*1.38,5.92,Math.sin(angle)*1.38,Math.PI/2-angle);
    parts.push(transformed(block,matrix,color(index%2===0?STONE.coping:STONE.shaftLight)));block.dispose();
    const cap=new THREE.BoxGeometry(.76,.12,.46);
    parts.push(transformed(cap,compose(Math.cos(angle)*1.38,6.21,Math.sin(angle)*1.38,Math.PI/2-angle),color(STONE.recess)));cap.dispose();
  }
  // Four worn stone prongs clasp the energy core instead of making it look
  // dropped onto the roof.
  for(let index=0;index<4;index++){
    const angle=index/4*Math.PI*2;
    const prong=new THREE.ConeGeometry(.17,.86,4);
    parts.push(transformed(prong,compose(Math.cos(angle)*.9,6.04,Math.sin(angle)*.9,angle),color(STONE.recess)));prong.dispose();
  }
  // A few large, low fragments tie the monumental base into the forest floor.
  for(const [x,z,size,angle] of [[-3.05,.5,1.05,.3],[3,-.6,.8,-.4],[.9,3,.74,.8],[-.8,-3.05,.62,-.2]] as const){
    const fragment=new THREE.BoxGeometry(size,.22+size*.12,size*.55);
    parts.push(transformed(fragment,compose(x,.12,z,angle),color(STONE.moss)));fragment.dispose();
  }
  const merged=mergeGeometries(parts,false);
  for(const part of parts)part.dispose();
  if(!merged)throw new Error('Tower ruin stone merge failed');
  merged.computeBoundingSphere();return merged;
}

function crystalGeometry(){
  const parts:THREE.BufferGeometry[]=[];
  parts.push(shard(2.06,.62));
  function side(height:number,width:number,x:number,y:number,z:number,tiltX:number,tiltZ:number,yaw:number){
    const geometry=shard(height,width);
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX,yaw,tiltZ)),new THREE.Vector3(1,1,1));
    parts.push(geometry.clone().applyMatrix4(matrix));geometry.dispose();
  }
  side(.95,.34,.47,.02,.13,.08,-.42,.4);
  side(.72,.29,-.43,.01,-.1,.1,.34,-.7);
  side(.52,.24,.08,.03,-.48,-.18,.15,1.4);
  const merged=mergeGeometries(parts,false);
  for(const part of parts)part.dispose();
  if(!merged)throw new Error('Tower crystal merge failed');
  merged.computeBoundingSphere();return merged;
}

export type TowerRuins={attach(root:THREE.Object3D,team:0|1):THREE.Group;dispose():void};

/** Shared geometry and stone material across all four towers. Only the crystal
 * material differs by team, and only those meshes join the bloom layer. */
export function createTowerRuins(lighting:LightingStyle):TowerRuins{
  const stoneGeometry=ruinGeometry(),crystalGeometryValue=crystalGeometry();
  const stoneMaterial=surfaceMaterial(lighting,{color:0xffffff,vertexColors:true});
  if(stoneMaterial instanceof THREE.MeshStandardMaterial){stoneMaterial.roughness=1;stoneMaterial.metalness=0;stoneMaterial.flatShading=true;}
  const crystals=[0,1].map(team=>{
    const tint=team===0?{surface:'#176c63',glow:'#39e0c2'}:{surface:'#6e2f1f',glow:'#ff7647'};
    const material=surfaceMaterial(lighting,{color:tint.surface});
    material.emissive.set(tint.glow);material.emissiveIntensity=.95;
    if(material instanceof THREE.MeshStandardMaterial){material.roughness=.3;material.metalness=.04;material.flatShading=true;}
    return material;
  });
  let disposed=false;
  return {
    attach(root,team){
      const group=new THREE.Group();group.name='tower-ruin-architecture';
      const stone=new THREE.Mesh(stoneGeometry,stoneMaterial);stone.name='tower-buttresses-and-cornices';
      stone.castShadow=true;stone.receiveShadow=true;stone.raycast=()=>{};
      const crystal=new THREE.Mesh(crystalGeometryValue,crystals[team]!);crystal.name='tower-energy-crystal';
      crystal.position.y=5.76;crystal.castShadow=false;crystal.receiveShadow=false;crystal.raycast=()=>{};
      crystal.layers.enable(CRYSTAL_BLOOM_LAYER);
      group.add(stone,crystal);root.add(group);return group;
    },
    dispose(){if(disposed)return;disposed=true;stoneGeometry.dispose();crystalGeometryValue.dispose();stoneMaterial.dispose();for(const material of crystals)material.dispose();}
  };
}
