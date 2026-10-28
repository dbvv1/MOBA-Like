import type {Intersection,Object3D} from 'three';
import type {Snapshot} from '../sim/types.js';

// A rendered corpse is not a living input target and must not occlude targets behind it.
export function pickLivingEntity(hits:readonly Intersection[],snapshot:Snapshot|null):number|null {
  if(!snapshot)return null;
  const alive=new Set(snapshot.entities.filter(entity=>entity.alive).map(entity=>entity.id));
  for(const hit of hits){
    let visible=true;for(let node:Object3D|null=hit.object;node;node=node.parent)if(!node.visible)visible=false;
    if(!visible)continue;
    for(let node:Object3D|null=hit.object;node;node=node.parent){
      const id:unknown=node.userData['simEntityId'];
      if(typeof id==='number'){if(alive.has(id))return id;break;}
    }
  }
  return null;
}
