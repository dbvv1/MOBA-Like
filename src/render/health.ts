import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';

/** Geometry-only HUD markers in the real Three scene; no alternate renderer. */
export function createHealthBars(scene:THREE.Scene){
  const geometry=new THREE.PlaneGeometry(1,1);
  const background=new THREE.MeshBasicMaterial({color:0x172026,depthTest:false});
  const fills=[new THREE.MeshBasicMaterial({color:0x6edee9,depthTest:false}),new THREE.MeshBasicMaterial({color:0xffc16f,depthTest:false})];
  const bars=new Map<number,{group:THREE.Group;fill:THREE.Mesh;anchor:THREE.Object3D;height:number}>();
  function sync(snapshot:Snapshot,root:THREE.Object3D){
    const seen=new Set<number>();
    for(const entity of snapshot.entities){
      if(!entity.alive)continue;
      const anchor=root.getObjectByName(`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`);if(!anchor)continue;
      seen.add(entity.id);let bar=bars.get(entity.id);
      const height=entity.kind==='hero'?2.5:entity.radius*(entity.kind==='minion'?.75:entity.structureKind==='barracks'?.5:1)+.5;
      if(!bar){const group=new THREE.Group();group.name=`health-${entity.id}`;const back=new THREE.Mesh(geometry,background);back.scale.set(1.4,.14,1);back.renderOrder=9;const fill=new THREE.Mesh(geometry,fills[entity.team]!);fill.renderOrder=10;group.add(back,fill);scene.add(group);bar={group,fill,anchor,height};bars.set(entity.id,bar);}
      bar.anchor=anchor;bar.height=height;const ratio=THREE.MathUtils.clamp(entity.hp/Math.max(entity.maxHp,1),0,1);bar.fill.scale.set(1.34*ratio,.09,1);bar.fill.position.set(-.67+.67*ratio,0,.01);
    }
    for(const[id,bar]of bars)if(!seen.has(id)){scene.remove(bar.group);bars.delete(id);}
  }
  return{sync,draw(camera:THREE.Camera){for(const bar of bars.values()){bar.anchor.getWorldPosition(bar.group.position);bar.group.position.y+=bar.height;bar.group.quaternion.copy(camera.quaternion);}},dispose(){for(const bar of bars.values())scene.remove(bar.group);bars.clear();geometry.dispose();background.dispose();for(const material of fills)material.dispose();}};
}
