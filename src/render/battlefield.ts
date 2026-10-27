import * as THREE from 'three';
import {surfaceMaterial,type LightingStyle} from './lighting-style.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {ContentCatalog} from '../content/types.js';
import type {Snapshot,EntitySnapshot} from '../sim/types.js';
import type {BattleAssets} from './battle-assets.js';
import {battleManifest,siegeAssetManifest} from './battle-assets.js';
import {createGroundSurfaces} from './ground-surfaces.js';
import {createMotionState} from '../../asset-pipeline/presentation/motion-state.js';

export function battleAssetId(entity:EntitySnapshot){
  const team=entity.team===0?'teal':'rust';
  return `${entity.kind==='minion'?(entity.minionKind==='siege'?'siege':entity.minionKind==='ranged'?'ranged':'melee'):entity.structureKind}-${team}`;
}
export function createBattlefield(catalog:ContentCatalog,assets:BattleAssets,lighting:LightingStyle='baseline'){
  const root=new THREE.Group();root.name='Battlefield';root.userData['renderRole']='world';
  const owned:Array<{dispose():void}>=[];
  const actors=new Map<number,{root:THREE.Group;from:THREE.Vector3;to:THREE.Vector3;mixer:THREE.AnimationMixer;actions:Map<string,THREE.AnimationAction>;action:string;activeClip:string;attackUntil:number;events:ReturnType<typeof createMotionState>;visualTime:number;kind:EntitySnapshot['kind'];siege:boolean;walkNominalSpeed:number;walkTimeScale:number;wheelTravel:number;wheelStep:number;wheelSamples:Array<{bone:THREE.Object3D;sample:THREE.Interpolant}>;death:{elapsed:number;duration:number}|null;skeletons:Set<THREE.Skeleton>}>();
  function useClip(actor:NonNullable<ReturnType<typeof actors.get>>,name:string){
    if(actor.activeClip===name)return;
    for(const action of actor.actions.values())action.stop();
    const action=actor.actions.get(name);if(action){action.setEffectiveTimeScale(1);action.play();}
    actor.activeClip=name;
  }
  const world=catalog.map.world;
  // The playable strip is not the edge of the world: ground fills the oblique
  // camera, while all trees/rocks remain outside the unchanged navigation lane.
  const groundGeometry=new THREE.PlaneGeometry(world.maxX-world.minX+180,180);
  const groundMaterial=surfaceMaterial(lighting,{color:'#284c43'});owned.push(groundGeometry,groundMaterial);
  const ground=new THREE.Mesh(groundGeometry,groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-.035;ground.receiveShadow=true;root.add(ground);
  function decorate(id:string,x:number,z:number,scale=1,angle=0){
    const model=assets.models[id];if(!model)throw new Error(`Missing battle model ${id}`);
    const object=model.scene.clone(true);object.position.set(x,0,z);object.scale.setScalar(scale);object.rotation.y=angle;
    object.traverse(node=>{if((node as THREE.Mesh).isMesh){node.castShadow=id!=='lane-ground';node.receiveShadow=true;}});root.add(object);return object;
  }
  for(let x=world.minX+6;x<world.maxX;x+=12)decorate('lane-ground',x,0);
  const groundSurfaces=createGroundSurfaces(lighting);root.add(groundSurfaces.root);owned.push(groundSurfaces);
  // Deterministic art layout only; no simulation random stream consumption.
  for(let group=0;group<26;group++)for(const side of [-1,1]){
    const x=world.minX-18+group*10.4+Math.sin(group*2.1+side)*3.2;
    const z=side*(13.5+(group%4)*2.6);
    const count=2+group%3;
    for(let n=0;n<count;n++)decorate('tree',x+Math.sin(n*2.7+group)*3.2,z+side*Math.cos(n*1.8)*2, .72+((group+n)%5)*.14,group*.71+n);
    if(group%3!==1)decorate('rock',x+4,z-side*2,.7+(group%4)*.2,group);
  }
  function remove(id:number){const actor=actors.get(id);if(!actor)return;actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.root);for(const skeleton of actor.skeletons)skeleton.dispose();root.remove(actor.root);actors.delete(id);}
  let tick=-1,terminal=false,logicTime=0;
  function sync(snapshot:Snapshot){
    if(snapshot.tick===tick)return;if(snapshot.tick<tick)throw new Error('Reset battlefield before replay');
    const elapsedLogic=Math.max(1/catalog.rules.tickRate,snapshot.timeSeconds-logicTime);
    tick=snapshot.tick;terminal=snapshot.status!=='running';logicTime=snapshot.timeSeconds;
    for(const event of snapshot.events){
      if(event.type!=='minionDied')continue;
      const actor=actors.get(event.entityId);if(!actor||actor.kind!=='minion'||actor.death)continue;
      const action=actor.actions.get('death');if(!action){remove(event.entityId);continue;}
      actor.from.set(event.position.x,0,event.position.z);actor.to.copy(actor.from);actor.root.position.copy(actor.to);
      delete actor.root.userData['simEntityId'];
      for(const other of actor.actions.values())other.stop();
      action.reset().setEffectiveTimeScale(1).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
      actor.action='death';actor.activeClip='death';actor.death={elapsed:0,duration:action.getClip().duration};actor.mixer.update(0);
    }
    const seen=new Set<number>();
    for(const entity of snapshot.entities){
      if(entity.kind==='hero'||!entity.alive)continue;seen.add(entity.id);
      let actor=actors.get(entity.id);
      if(!actor){
        const id=battleAssetId(entity),model=assets.models[id];if(!model)throw new Error(`Missing battle model ${id}`);
        const object=clone(model.scene) as THREE.Group,skeletons=new Set<THREE.Skeleton>();
        object.traverse(node=>{const mesh=node as THREE.SkinnedMesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}if(mesh.isSkinnedMesh){mesh.frustumCulled=false;const raycast=mesh.raycast;mesh.raycast=function(ray,hits){this.computeBoundingBox();this.boundingSphere??=new THREE.Sphere();this.boundingBox!.getBoundingSphere(this.boundingSphere);raycast.call(this,ray,hits);};const s=mesh.skeleton;const existing=[...skeletons].find(other=>other.bones.length===s.bones.length&&other.bones.every((b,i)=>b===s.bones[i])&&other.boneInverses.length===s.boneInverses.length&&other.boneInverses.every((b,i)=>b.equals(s.boneInverses[i]!)));if(existing&&existing!==s){mesh.skeleton=existing;s.dispose();}else skeletons.add(s);}});
        const siege=entity.kind==='minion'&&entity.minionKind==='siege';
        const entry=battleManifest.assets.find(item=>item.id===id);
        const siegeEntry=siegeAssetManifest.assets.find(item=>item.id===id);
        // GLB is already final metres. The 1.85m bar clears its sampled 1.77m arm envelope.
        object.scale.setScalar(1);object.userData['visualHeight']=siege?1.85:entry!.nominalHeight;object.userData['simEntityId']=entity.id;object.name=`entity-${entity.id}`;
        const mixer=new THREE.AnimationMixer(object),actions=new Map(model.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
        // Wheels are locomotion, not a cast phase. Sample only their authored
        // quaternion tracks after the primary mixer, so recovery can coexist with travel.
        const wheelSamples=siege&&catalog.basicAttacks?['Wheel_L','Wheel_R'].map(name=>{
          const track=model.animations.find(clip=>clip.name==='walk')!.tracks.find(track=>track.name===`${name}.quaternion`)!;
          return {bone:object.getObjectByName(name)!,sample:new THREE.QuaternionLinearInterpolant(track.times,track.values,4)};
        }):[];
        const to=new THREE.Vector3(entity.position.x,0,entity.position.z);
        actor={root:object,from:to.clone(),to,mixer,actions,action:'',activeClip:'',attackUntil:0,events:createMotionState(entity.id,catalog),visualTime:snapshot.timeSeconds,kind:entity.kind,siege,walkNominalSpeed:siegeEntry?.nominalWalkSpeed??1,walkTimeScale:1,wheelTravel:0,wheelStep:0,wheelSamples,death:null,skeletons};actors.set(entity.id,actor);root.add(object);object.rotation.y=entity.team===0?Math.PI/2:-Math.PI/2;
      }
      actor.from.copy(actor.to);actor.to.set(entity.position.x,0,entity.position.z);actor.root.position.copy(actor.to);
      const dx=actor.to.x-actor.from.x,dz=actor.to.z-actor.from.z;
      if(actor.siege){actor.walkTimeScale=Math.hypot(dx,dz)/elapsedLogic/actor.walkNominalSpeed;actor.wheelTravel+=actor.wheelStep;actor.wheelStep=Math.hypot(dx,dz);}
      if(Math.hypot(dx,dz)>1e-5&&snapshot.timeSeconds>=actor.attackUntil)actor.root.rotation.y=Math.atan2(dx,dz);
      actor.events.consume(snapshot.events,snapshot.timeSeconds,true);
      if(terminal)actor.events.finish(snapshot.timeSeconds);
      const attack=snapshot.events.find(event=>event.type==='basicAttack'&&event.sourceId===entity.id);
      if(entity.kind==='minion'&&attack?.type==='basicAttack'&&!catalog.basicAttacks){
        const target=snapshot.entities.find(value=>value.id===attack.targetId);
        if(target)actor.root.rotation.y=Math.atan2(target.position.x-entity.position.x,target.position.z-entity.position.z);
        const strike=actor.actions.get('attack');
        if(strike){actor.attackUntil=snapshot.timeSeconds+strike.getClip().duration;strike.reset().setLoop(THREE.LoopOnce,1);strike.clampWhenFinished=true;}
      }
      const preparation=actor.events.inspect().attack;
      const recovery=actor.siege?(actor.actions.get('attack_release')!.getClip().duration+actor.actions.get('attack_recover')!.getClip().duration):.36;
      const cycling=entity.kind==='minion'&&!!catalog.basicAttacks&&preparation!==null&&preparation.cancelledAt===null&&preparation.visualStopAt===undefined&&(preparation.resolvedAt===null||snapshot.timeSeconds-preparation.resolvedAt<recovery);
      if(cycling&&preparation){const target=snapshot.entities.find(value=>value.id===preparation.targetId)??snapshot.events.find(event=>event.type==='minionDied'&&event.entityId===preparation.targetId);if(target&&'position'in target)actor.root.rotation.y=Math.atan2(target.position.x-entity.position.x,target.position.z-entity.position.z);}
      const next=cycling||snapshot.timeSeconds<actor.attackUntil?'attack':Math.hypot(dx,dz)>1e-5?'walk':'idle';
      if(actor.action!==next){useClip(actor,next);actor.action=next;}
      actor.actions.get('walk')?.setEffectiveTimeScale(actor.siege&&next==='walk'?actor.walkTimeScale:1);
    }
    for(const [id,actor] of actors)if(!seen.has(id)&&!actor.death)remove(id);
  }
  return {root,sync,advance(seconds:number,alpha:number){for(const [id,actor] of actors){
    if(actor.death){
      // A bounded presentation-only tail; hidden tabs do not draw, and final
      // match state may finish the tail without advancing gameplay.
      actor.death.elapsed+=Math.max(0,seconds);
      if(actor.death.elapsed>=actor.death.duration+.15){remove(id);continue;}
      actor.mixer.update(Math.max(0,seconds));
    }else{
      actor.root.position.lerpVectors(actor.from,actor.to,terminal?1:alpha);
      actor.visualTime=Math.max(actor.visualTime,logicTime-(terminal?0:(1-alpha)/catalog.rules.tickRate));
      const cycle=actor.events.inspect().attack,strike=actor.actions.get('attack');
      if(actor.siege&&catalog.basicAttacks&&cycle&&actor.action==='attack'){
        // Mechanical phases sample the existing authoritative cycle; they emit no events.
        const at=cycle.cancelledAt??cycle.visualStopAt??actor.visualTime;
        const prepare=actor.actions.get('attack_prepare')!,release=actor.actions.get('attack_release')!,recover=actor.actions.get('attack_recover')!;
        const beforeRelease=cycle.resolvedAt===null||at<cycle.resolvedAt;
        const elapsed=beforeRelease?0:Math.max(0,at-cycle.resolvedAt!);
        const name=beforeRelease?'attack_prepare':elapsed<release.getClip().duration?'attack_release':'attack_recover';
        useClip(actor,name);const phase=actor.actions.get(name)!;phase.paused=true;
        phase.time=beforeRelease?prepare.getClip().duration*THREE.MathUtils.clamp((at-cycle.startedAt)/Math.max(cycle.windup,1e-9),0,1):name==='attack_release'?elapsed:Math.min(recover.getClip().duration,elapsed-release.getClip().duration);
        actor.mixer.update(0);
      }else if(catalog.basicAttacks&&cycle&&actor.action==='attack'&&strike){
        // Troop source keys: frame 7 anticipation, frame 11 contact/release.
        // Retiming is presentation-only; a cancelled preparation never reaches 11.
        const at=cycle.cancelledAt??cycle.visualStopAt??actor.visualTime;
        const ready=6/30,contact=10/30;
        strike.paused=true;
        strike.time=cycle.resolvedAt===null||at<cycle.resolvedAt?ready*Math.min(1,Math.max(0,(at-cycle.startedAt)/cycle.windup)):Math.min(strike.getClip().duration,contact+Math.max(0,at-cycle.resolvedAt));
        actor.mixer.update(0);
      }else{if(strike)strike.paused=false;actor.mixer.update(terminal?0:seconds);}
      if(actor.wheelSamples.length){
        const distance=actor.wheelTravel+actor.wheelStep*(terminal?1:THREE.MathUtils.clamp(alpha,0,1));
        const time=(distance/actor.walkNominalSpeed)%actor.actions.get('walk')!.getClip().duration;
        for(const {bone,sample} of actor.wheelSamples)bone.quaternion.fromArray(sample.evaluate(time));
      }
    }
  }},dispose(){for(const id of actors.keys())remove(id);for(const resource of owned)resource.dispose();root.clear();}};
}
