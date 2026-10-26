import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {ContentCatalog} from '../content/types.js';
import type {Snapshot,EntitySnapshot} from '../sim/types.js';
import type {BattleAssets} from './battle-assets.js';
import {battleManifest} from './battle-assets.js';

export function battleAssetId(entity:EntitySnapshot){
  const team=entity.team===0?'teal':'rust';
  return `${entity.kind==='minion'?(entity.minionKind==='ranged'?'ranged':'melee'):entity.structureKind}-${team}`;
}
export function createBattlefield(catalog:ContentCatalog,assets:BattleAssets){
  const root=new THREE.Group();root.name='Battlefield';
  const owned:Array<{dispose():void}>=[];
  const actors=new Map<number,{root:THREE.Group;from:THREE.Vector3;to:THREE.Vector3;mixer:THREE.AnimationMixer;actions:Map<string,THREE.AnimationAction>;action:string;attackUntil:number;skeletons:Set<THREE.Skeleton>}>();
  const world=catalog.map.world;
  // The playable strip is not the edge of the world: ground fills the oblique
  // camera, while all trees/rocks remain outside the unchanged navigation lane.
  const groundGeometry=new THREE.PlaneGeometry(world.maxX-world.minX+180,180);
  const groundMaterial=new THREE.MeshStandardMaterial({color:'#284c43',roughness:1});owned.push(groundGeometry,groundMaterial);
  const ground=new THREE.Mesh(groundGeometry,groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-.035;ground.receiveShadow=true;root.add(ground);
  function decorate(id:string,x:number,z:number,scale=1,angle=0){
    const model=assets.models[id];if(!model)throw new Error(`Missing battle model ${id}`);
    const object=model.scene.clone(true);object.position.set(x,0,z);object.scale.setScalar(scale);object.rotation.y=angle;
    object.traverse(node=>{if((node as THREE.Mesh).isMesh){node.castShadow=id!=='lane-ground';node.receiveShadow=true;}});root.add(object);return object;
  }
  for(let x=world.minX+6;x<world.maxX;x+=12)decorate('lane-ground',x,0);
  // Deterministic art layout only; no simulation random stream consumption.
  for(let group=0;group<26;group++)for(const side of [-1,1]){
    const x=world.minX-18+group*10.4+Math.sin(group*2.1+side)*3.2;
    const z=side*(13.5+(group%4)*2.6);
    const count=2+group%3;
    for(let n=0;n<count;n++)decorate('tree',x+Math.sin(n*2.7+group)*3.2,z+side*Math.cos(n*1.8)*2, .72+((group+n)%5)*.14,group*.71+n);
    if(group%3!==1)decorate('rock',x+4,z-side*2,.7+(group%4)*.2,group);
  }
  function remove(id:number){const actor=actors.get(id);if(!actor)return;actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.root);for(const skeleton of actor.skeletons)skeleton.dispose();root.remove(actor.root);actors.delete(id);}
  let tick=-1,terminal=false;
  function sync(snapshot:Snapshot){
    if(snapshot.tick===tick)return;if(snapshot.tick<tick)throw new Error('Reset battlefield before replay');tick=snapshot.tick;terminal=snapshot.status!=='running';
    const seen=new Set<number>();
    for(const entity of snapshot.entities){
      if(entity.kind==='hero'||!entity.alive)continue;seen.add(entity.id);
      let actor=actors.get(entity.id);
      if(!actor){
        const id=battleAssetId(entity),model=assets.models[id];if(!model)throw new Error(`Missing battle model ${id}`);
        const object=clone(model.scene) as THREE.Group,skeletons=new Set<THREE.Skeleton>();
        object.traverse(node=>{const mesh=node as THREE.SkinnedMesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}if(mesh.isSkinnedMesh){mesh.frustumCulled=false;const raycast=mesh.raycast;mesh.raycast=function(ray,hits){this.computeBoundingBox();this.boundingSphere??=new THREE.Sphere();this.boundingBox!.getBoundingSphere(this.boundingSphere);raycast.call(this,ray,hits);};const s=mesh.skeleton;const existing=[...skeletons].find(other=>other.bones.length===s.bones.length&&other.bones.every((b,i)=>b===s.bones[i])&&other.boneInverses.length===s.boneInverses.length&&other.boneInverses.every((b,i)=>b.equals(s.boneInverses[i]!)));if(existing&&existing!==s){mesh.skeleton=existing;s.dispose();}else skeletons.add(s);}});
        const entry=battleManifest.assets.find(item=>item.id===id)!;
        const scale=entity.kind==='minion'&&entity.minionKind==='siege'?1.45:1;
        object.scale.setScalar(scale);object.userData['visualHeight']=entry.nominalHeight*scale;object.userData['simEntityId']=entity.id;object.name=`entity-${entity.id}`;
        const mixer=new THREE.AnimationMixer(object),actions=new Map(model.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
        const to=new THREE.Vector3(entity.position.x,0,entity.position.z);
        actor={root:object,from:to.clone(),to,mixer,actions,action:'',attackUntil:0,skeletons};actors.set(entity.id,actor);root.add(object);object.rotation.y=entity.team===0?Math.PI/2:-Math.PI/2;
      }
      actor.from.copy(actor.to);actor.to.set(entity.position.x,0,entity.position.z);actor.root.position.copy(actor.to);
      const dx=actor.to.x-actor.from.x,dz=actor.to.z-actor.from.z;
      if(Math.hypot(dx,dz)>1e-5)actor.root.rotation.y=Math.atan2(dx,dz);
      const attack=snapshot.events.find(event=>event.type==='basicAttack'&&event.sourceId===entity.id);
      if(entity.kind==='minion'&&attack?.type==='basicAttack'){
        const target=snapshot.entities.find(value=>value.id===attack.targetId);
        if(target)actor.root.rotation.y=Math.atan2(target.position.x-entity.position.x,target.position.z-entity.position.z);
        const strike=actor.actions.get('attack');
        if(strike){actor.attackUntil=snapshot.timeSeconds+strike.getClip().duration;strike.reset().setLoop(THREE.LoopOnce,1);strike.clampWhenFinished=true;}
      }
      const next=snapshot.timeSeconds<actor.attackUntil?'attack':Math.hypot(dx,dz)>1e-5?'walk':'idle';
      if(actor.action!==next){for(const action of actor.actions.values())action.stop();actor.actions.get(next)?.play();actor.action=next;}
    }
    for(const id of actors.keys())if(!seen.has(id))remove(id);
  }
  return {root,sync,advance(seconds:number,alpha:number){for(const actor of actors.values()){actor.root.position.lerpVectors(actor.from,actor.to,terminal?1:alpha);actor.mixer.update(terminal?0:seconds);}},dispose(){for(const id of actors.keys())remove(id);for(const resource of owned)resource.dispose();root.clear();}};
}
