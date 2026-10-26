import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';
/** Short-lived confirmed hero impacts; basic swings get a trail, never a fabricated hit. */
export function createImpacts(scene:THREE.Scene){
  const root=new THREE.Group();root.name='battle-feedback';scene.add(root);
  const geometry=new THREE.RingGeometry(.62,1,20),swingGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,1)]);
  type Burst={object:THREE.Object3D;material:THREE.Material;age:number;duration:number};const bursts:Burst[]=[];
  let tick=-1,ordinal=-1;
  function remove(burst:Burst){root.remove(burst.object);burst.material.dispose();}
  function sync(snapshot:Snapshot){
    for(const event of snapshot.events){
      if(event.tick<tick||(event.tick===tick&&event.ordinal<=ordinal))continue;tick=event.tick;ordinal=event.ordinal;
      if(event.type==='heroDamaged'){
        const target=snapshot.entities.find(entity=>entity.id===event.targetId);if(!target)continue;
        const shield=event.hpDamage<=0,color=shield?0x95e1ee:target.team===0?0xfff0bd:0xffb39a;
        const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false});
        const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.set(target.position.x,.15,target.position.z);root.add(mesh);
        if(bursts.length>=48){const old=bursts.shift();if(old)remove(old);}
        bursts.push({object:mesh,material,age:0,duration:shield?.3:.2});
      }else if(event.type==='basicAttack'){
        const source=snapshot.entities.find(entity=>entity.id===event.sourceId),target=snapshot.entities.find(entity=>entity.id===event.targetId);
        if(!source||!target)continue;
        const material=new THREE.LineBasicMaterial({color:source.team===0?0xbce8ce:0xf4b29a,transparent:true,opacity:.65,depthWrite:false});
        const line=new THREE.Line(swingGeometry,material),dx=target.position.x-source.position.x,dz=target.position.z-source.position.z;
        const startY=source.kind==='structure'?4.3:source.kind==='hero'?1.2:.7;
        const endY=target.kind==='hero'?1.2:target.kind==='structure'?2:.7;
        line.position.set(source.position.x,startY,source.position.z);line.lookAt(target.position.x,endY,target.position.z);line.scale.z=Math.hypot(dx,dz,endY-startY);root.add(line);
        if(bursts.length>=48){const old=bursts.shift();if(old)remove(old);}
        bursts.push({object:line,material,age:0,duration:.10});
      }
    }
  }
  return {sync,draw(seconds:number){for(let i=bursts.length-1;i>=0;i--){const b=bursts[i]!;b.age+=Math.min(Math.max(seconds,0),.1);if(b.age>=b.duration){remove(b);bursts.splice(i,1);continue;}const remaining=1-b.age/b.duration;(b.material as THREE.MeshBasicMaterial).opacity=remaining*.8;if((b.object as THREE.Mesh).isMesh)b.object.scale.setScalar(.6+b.age*3);}},dispose(){for(const b of bursts)remove(b);bursts.length=0;scene.remove(root);geometry.dispose();swingGeometry.dispose();}};
}
