import {it,expect} from 'vitest';
import {Scene,Mesh,BoxGeometry,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {pickLivingEntity} from '../../src/render/picking.js';
import {Simulation} from '../../src/sim/simulation.js';
it('actual ray intersections skip a visible dead hero instead of blocking a living target behind it',()=>{
  const navigation={closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})};
  const snapshot=new Simulation({seed:1,contentVersion:8,navigation}).snapshot();
  const front=snapshot.entities[0]!,back=snapshot.entities[1]!;
  const scene=new Scene(),geometry=new BoxGeometry(1,1,1),material=new MeshBasicMaterial();
  const corpse=new Mesh(geometry,material),target=new Mesh(geometry,material);corpse.userData['simEntityId']=front.id;target.userData['simEntityId']=back.id;target.position.z=-3;scene.add(corpse,target);scene.updateMatrixWorld(true);
  const hits=new Raycaster(new Vector3(0,0,3),new Vector3(0,0,-1)).intersectObjects(scene.children,true);
  const dead={...snapshot,entities:snapshot.entities.map(entity=>({...entity,alive:entity.id!==front.id}))};
  expect(pickLivingEntity(hits,snapshot)).toBe(front.id);expect(pickLivingEntity(hits,dead)).toBe(back.id);
  target.visible=false;expect(pickLivingEntity(hits,dead)).toBeNull();expect(pickLivingEntity(hits,null)).toBeNull();geometry.dispose();material.dispose();
});
