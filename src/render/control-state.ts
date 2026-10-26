import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';
/** Current observed control state, not an inferred effect timer or hit event. */
export function createControlMarkers(scene:THREE.Scene,texture:THREE.Texture){
  const material=new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false});
  const markers=new Map<number,{sprite:THREE.Sprite;anchor:THREE.Object3D}>();
  function sync(snapshot:Snapshot,actors:THREE.Object3D){
    const seen=new Set<number>();
    for(const hero of snapshot.heroes){
      if(!hero.alive||!hero.stunned||snapshot.status!=='running')continue;
      const anchor=actors.getObjectByName(`hero-${hero.id}`);if(!anchor)continue;
      seen.add(hero.id);let marker=markers.get(hero.id);
      if(!marker){const sprite=new THREE.Sprite(material);sprite.name=`control-locked-${hero.id}`;sprite.scale.set(.8,.8,1);sprite.renderOrder=35;scene.add(sprite);marker={sprite,anchor};markers.set(hero.id,marker);}
      marker.anchor=anchor;
    }
    for(const[id,marker]of markers)if(!seen.has(id)){scene.remove(marker.sprite);markers.delete(id);}
  }
  return {sync,draw(){for(const marker of markers.values()){marker.anchor.getWorldPosition(marker.sprite.position);marker.sprite.position.y+=3.25;}},dispose(){for(const marker of markers.values())scene.remove(marker.sprite);markers.clear();material.dispose();}};
}
