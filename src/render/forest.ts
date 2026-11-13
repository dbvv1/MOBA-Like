import * as THREE from 'three';
import {groundHeightAt,roadDistance,roadShoulderWidth} from './quiet-family.js';
import {roadCrossSection} from './terrain-composition.js';
import {surfaceMaterial,type LightingStyle} from './lighting-style.js';
import type {BattleAssets} from './battle-assets.js';
import layout from '../../asset-pipeline/terrain-composition/source/layout.json';

interface TreePlacement {x:number;z:number;height:number;rotation:number;shade:number;band:'mid'|'back'}
interface ShrubPlacement {x:number;z:number;width:number;height:number;rotation:number;shade:number}
interface RockPlacement {x:number;z:number;scale:number;rotation:number;shade:number}
interface AccentPlacement {x:number;z:number;scale:number;rotation:number;shade:number}

/** A deterministic clumped forest belt. It is presentation-only: no simulation
 * random stream, navigation mesh or entity bounds are read or changed. The
 * front row is low understory, the middle row is small canopies, and the back
 * keeps the tall silhouette while gaps open up the rhythm. */
export function createForest(lighting:LightingStyle,assets:BattleAssets){
  const root=new THREE.Group();root.name='ForestBelt';root.userData['renderRole']='world';
  const owned:Array<{dispose():void}>=[];
  let seed=0x6d2b79f5;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const southwest=(x:number,side:number)=>side<0?roadCrossSection(x).south:roadCrossSection(x).north;
  const edgeZ=(x:number,side:number)=>southwest(x,side)+side*(Math.max(.85,roadShoulderWidth(x)));
  const clearOfRoad=(x:number,z:number,radius:number)=>roadDistance(x,z)<=-(radius+.35);
  const clearOfStructures=(x:number,z:number,radius:number,extra=2.2)=>layout.clearings.every(clearing=>Math.hypot(x-clearing.x,z)>=clearing.radius+radius+extra);
  const trees:TreePlacement[]=[],shrubs:ShrubPlacement[]=[],rocks:RockPlacement[]=[],accents:AccentPlacement[]=[];
  const placeClusters=(side:-1|1,step:number,jitter:number,count:[number,number],offset:[number,number],spread:number,tree:(x:number,z:number)=>void)=>{
    let cursor=layout.world.minX-12;
    while(cursor<layout.world.maxX+12){
      cursor+=step+random()*jitter;
      if(random()<.17)continue;
      const centerX=cursor+(random()-.5)*5;
      const close=random()<.4;
      const n=count[0]+Math.floor(random()*(count[1]-count[0]+1));
      for(let index=0;index<n;index++){
        const x=centerX+(random()-.5)*spread*(close?.72:1.18);
        const width=Math.max(.85,roadShoulderWidth(x));
        const outward=width+(close?offset[0]:offset[1])+random()*(close?offset[0]*.55:offset[1]*.55);
        tree(x,edgeZ(x,side)+side*outward);
      }
    }
  };
  for(const side of [-1,1] as const){
    // Front: low, wide understory in clusters that alternately hug the verge
    // and step back, leaving readable gaps instead of a continuous hedge.
    placeClusters(side,10,7,[6,12],[.4,1.4],5.6,(x,z)=>{
      const width=1.0+random()*.9,height=.6+random()*.65;
      if(!clearOfRoad(x,z,width*.82)||!clearOfStructures(x,z,width,1.2))return;
      shrubs.push({x,z,width,height,rotation:random()*Math.PI*2,shade:random()});
    });
    // A second understory band fills the floor between the low edge and the
    // middle canopies without turning into an even scatter.
    placeClusters(side,14,8,[3,8],[2.6,5.8],7.2,(x,z)=>{
      const width=1.05+random()*.95,height=.7+random()*.7;
      if(!clearOfRoad(x,z,width*.82)||!clearOfStructures(x,z,width,1.5))return;
      shrubs.push({x,z,width,height,rotation:random()*Math.PI*2,shade:random()});
    });
    // Middle: smaller canopies, set back far enough that their crowns clear the lane.
    placeClusters(side,13,8,[4,8],[2.2,4.2],7.6,(x,z)=>{
      const height=3.2+random()*1.5,canopy=height*.30;
      if(!clearOfRoad(x,z,canopy)||!clearOfStructures(x,z,canopy,2.1))return;
      trees.push({x,z,height,rotation:random()*Math.PI*2,shade:random(),band:'mid'});
    });
    // Back: retain the existing tall band, but in large overlapping clumps with
    // broad openings so distant depth reads as a forest, not a wall.
    placeClusters(side,13,7,[8,16],[6,11],11,(x,z)=>{
      const height=5.2+random()*2.3,canopy=height*.32;
      if(!clearOfRoad(x,z,canopy)||!clearOfStructures(x,z,canopy,2.4))return;
      trees.push({x,z,height,rotation:random()*Math.PI*2,shade:random(),band:'back'});
    });
    // Deep silhouette row: large crowns close the horizon behind the playable band.
    placeClusters(side,17,10,[8,16],[16,30],14,(x,z)=>{
      const height=5.6+random()*2.4,canopy=height*.32;
      if(!clearOfRoad(x,z,canopy)||!clearOfStructures(x,z,canopy,2.4))return;
      trees.push({x,z,height,rotation:random()*Math.PI*2,shade:random(),band:'back'});
    });
    // Grouped edge rocks share the front-row rhythm and never enter the lane.
    placeClusters(side,24,12,[2,4],[.35,1.4],4.2,(x,z)=>{
      const scale=.34+random()*.36;
      if(!clearOfRoad(x,z,scale)||!clearOfStructures(x,z,scale,.9))return;
      rocks.push({x,z,scale,rotation:random()*Math.PI*2,shade:random()});
    });
    // A few authored tree silhouettes break up the rounded canopy mass.
    placeClusters(side,30,15,[1,3],[4.8,8.5],6,(x,z)=>{
      const scale=.95+random()*.42;
      if(!clearOfRoad(x,z,scale*.7)||!clearOfStructures(x,z,scale*.7,2.4))return;
      accents.push({x,z,scale,rotation:random()*Math.PI*2,shade:random()});
    });
  }
  const canopyGeometry=new THREE.IcosahedronGeometry(1,1);
  const topGeometry=new THREE.IcosahedronGeometry(1,0);
  const trunkGeometry=new THREE.CylinderGeometry(.62,.9,1,5,1);
  const canopyMaterial=surfaceMaterial(lighting,{color:0xffffff});
  const topMaterial=surfaceMaterial(lighting,{color:0xffffff});
  const trunkMaterial=surfaceMaterial(lighting,{color:'#5c4732'});
  for(const material of [canopyMaterial,topMaterial,trunkMaterial]){
    if(material instanceof THREE.MeshStandardMaterial){material.roughness=1;material.metalness=0;material.flatShading=true;}
  }
  owned.push(canopyGeometry,topGeometry,trunkGeometry,canopyMaterial,topMaterial,trunkMaterial);
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3(),color=new THREE.Color(),euler=new THREE.Euler();
  const transform=(mesh:THREE.InstancedMesh,slot:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,rotation:number,shade:number,palette:[THREE.Color,THREE.Color])=>{
    euler.set(0,rotation,0);quaternion.setFromEuler(euler);position.set(x,y,z);scale.set(sx,sy,sz);matrix.compose(position,quaternion,scale);
    mesh.setMatrixAt(slot,matrix);mesh.setColorAt(slot,color.copy(palette[0]).lerp(palette[1],shade));
  };
  const shrubPalette:[THREE.Color,THREE.Color]=[new THREE.Color('#355a3c'),new THREE.Color('#668c55')];
  const canopyPalette:[THREE.Color,THREE.Color]=[new THREE.Color('#2f5738'),new THREE.Color('#628b52')];
  const rockPalette:[THREE.Color,THREE.Color]=[new THREE.Color('#7f7968'),new THREE.Color('#b4ab90')];
  const accentPalette:[THREE.Color,THREE.Color]=[new THREE.Color('#d8d8d0'),new THREE.Color('#ffffff')];
  const shrubMaterial=surfaceMaterial(lighting,{color:0xffffff});
  if(shrubMaterial instanceof THREE.MeshStandardMaterial){shrubMaterial.roughness=1;shrubMaterial.metalness=0;shrubMaterial.flatShading=true;}
  owned.push(shrubMaterial);
  const shrubMesh=new THREE.InstancedMesh(topGeometry,shrubMaterial,shrubs.length*2);
  const mids=trees.filter(tree=>tree.band==='mid'),backs=trees.filter(tree=>tree.band==='back');
  const main=new THREE.InstancedMesh(canopyGeometry,canopyMaterial,mids.length+backs.length*2);
  const upper=new THREE.InstancedMesh(topGeometry,topMaterial,backs.length);
  const trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
  let shrubIndex=0,mainIndex=0,upperIndex=0,trunkIndex=0;
  for(const shrub of shrubs){
    const baseY=groundHeightAt(shrub.x,shrub.z);
    transform(shrubMesh,shrubIndex++,shrub.x,baseY+shrub.height*.72,shrub.z,shrub.width,shrub.height,shrub.width,shrub.rotation,shrub.shade,shrubPalette);
    const angle=shrub.rotation+Math.PI*.66;
    transform(shrubMesh,shrubIndex++,shrub.x+Math.cos(angle)*shrub.width*.52,baseY+shrub.height*.55,shrub.z+Math.sin(angle)*shrub.width*.52,shrub.width*.68,shrub.height*.82,shrub.width*.68,shrub.rotation+1.9,Math.min(1,shrub.shade+.22),shrubPalette);
  }
  for(const tree of trees){
    const baseY=groundHeightAt(tree.x,tree.z),height=tree.height,canopy=height*(tree.band==='mid'?.30:.33),trunk=height*.38;
    transform(main,mainIndex++,tree.x,baseY+height*.59,tree.z,canopy,canopy*.94,canopy,tree.rotation,tree.shade*.55,canopyPalette);
    if(tree.band==='back'){
      const sideAngle=tree.rotation+Math.PI*.5;
      transform(upper,upperIndex++,tree.x+Math.cos(sideAngle)*height*.035,baseY+height*.78,tree.z+Math.sin(sideAngle)*height*.035,canopy*.66,canopy*.62,canopy*.66,tree.rotation+1.7,.42+tree.shade*.5,canopyPalette);
      transform(main,mainIndex++,tree.x+Math.cos(sideAngle)*height*.17,baseY+height*.53,tree.z+Math.sin(sideAngle)*height*.17,canopy*.7,canopy*.68,canopy*.7,tree.rotation+2.9,.3+tree.shade*.45,canopyPalette);
    }
    euler.set(0,tree.rotation,0);quaternion.setFromEuler(euler);position.set(tree.x,baseY+trunk*.5,tree.z);scale.set(height*.1,trunk,height*.1);matrix.compose(position,quaternion,scale);trunks.setMatrixAt(trunkIndex++,matrix);
  }
  const addInstanced=(name:string,mesh:THREE.InstancedMesh,count:number)=>{
    mesh.name=name;mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.computeBoundingSphere();root.add(mesh);owned.push(mesh);
  };
  addInstanced('Forest-understory',shrubMesh,shrubIndex);
  addInstanced('Forest-canopies',main,mainIndex);
  addInstanced('Forest-upper-canopies',upper,upperIndex);
  addInstanced('Forest-trunks',trunks,trunkIndex);
  const rock=firstMesh(assets.models['rock']);
  if(rock&&rocks.length){
    const mesh=new THREE.InstancedMesh(rock.geometry,rock.material,rocks.length);
    rocks.forEach((value,index)=>{
      const baseY=groundHeightAt(value.x,value.z);
      transform(mesh,index,value.x,baseY,value.z,value.scale,value.scale*.8,value.scale,value.rotation,value.shade,rockPalette);
    });
    addInstanced('Forest-rocks',mesh,rocks.length);
  }
  const accent=firstMesh(assets.models['tree']);
  if(accent&&accents.length){
    const mesh=new THREE.InstancedMesh(accent.geometry,accent.material,accents.length);
    accents.forEach((value,index)=>{
      const baseY=groundHeightAt(value.x,value.z);
      transform(mesh,index,value.x,baseY,value.z,value.scale,value.scale,value.scale,value.rotation,value.shade,accentPalette);
    });
    addInstanced('Forest-accent-trees',mesh,accents.length);
  }
  let disposed=false;
  return {root,dispose(){if(disposed)return;disposed=true;for(const resource of owned)resource.dispose();root.clear();}};
}
function firstMesh(model:{scene:THREE.Object3D}|undefined){
  let found:{geometry:THREE.BufferGeometry;material:THREE.Material}|undefined;
  model?.scene.traverse(node=>{const mesh=node as THREE.Mesh;if(!found&&mesh.isMesh&&!Array.isArray(mesh.material))found={geometry:mesh.geometry,material:mesh.material};});
  return found;
}
