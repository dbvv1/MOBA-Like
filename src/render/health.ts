import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';

/** Geometry-only HUD markers in the real Three scene; no alternate renderer. */
export function createHealthBars(scene:THREE.Scene){
  const geometry=new THREE.PlaneGeometry(1,1);
  const background=new THREE.MeshBasicMaterial({color:0x172026,depthTest:false});
  const fills=[new THREE.MeshBasicMaterial({color:0x8fd5b2,depthTest:false}),new THREE.MeshBasicMaterial({color:0xf28c75,depthTest:false})];
  const bars=new Map<number,{group:THREE.Group;fill:THREE.Mesh;anchor:THREE.Object3D;height:number}>();
  function sync(snapshot:Snapshot,root:THREE.Object3D,playerId?:number){
    const seen=new Set<number>();
    for(const entity of snapshot.entities){
      if(!entity.alive)continue;
      const anchor=root.getObjectByName(`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`);if(!anchor)continue;
      seen.add(entity.id);let bar=bars.get(entity.id);
      const isHero=entity.kind==='hero',isPlayer=entity.id===playerId;
      const width=isHero?2.1:entity.kind==='minion'?.9:1.65;
      const thickness=isHero?.22:entity.kind==='minion'?.105:.15;
      const order=isPlayer?30:isHero?25:entity.kind==='minion'?10:15;
      const height=typeof anchor.userData['visualHeight']==='number'?anchor.userData['visualHeight']+.35:entity.kind==='hero'?2.5:entity.radius*(entity.kind==='minion'?.75:entity.structureKind==='barracks'?.5:1)+.5;
      if(!bar){const group=new THREE.Group();group.name=`health-${entity.id}`;const back=new THREE.Mesh(geometry,background);back.name="health-background";const fill=new THREE.Mesh(geometry,fills[entity.team]!);fill.name="health-fill";group.add(back,fill);scene.add(group);bar={group,fill,anchor,height};bars.set(entity.id,bar);}
      bar.anchor=anchor;bar.height=height;const back=bar.group.children[0] as THREE.Mesh;back.scale.set(width,thickness,1);back.renderOrder=order;bar.fill.renderOrder=order+1;bar.group.userData["priority"]=isPlayer?"player":entity.kind;const ratio=THREE.MathUtils.clamp(entity.hp/Math.max(entity.maxHp,1),0,1);const inner=width-.07;bar.fill.scale.set(inner*ratio,thickness-.055,1);bar.fill.position.set(-inner/2+inner/2*ratio,0,.01);
    }
    for(const[id,bar]of bars)if(!seen.has(id)){scene.remove(bar.group);bars.delete(id);}
  }
  return{sync,draw(camera:THREE.Camera){for(const bar of bars.values()){bar.anchor.getWorldPosition(bar.group.position);bar.group.position.y+=bar.height;bar.group.quaternion.copy(camera.quaternion);}},dispose(){for(const bar of bars.values())scene.remove(bar.group);bars.clear();geometry.dispose();background.dispose();for(const material of fills)material.dispose();}};
}
