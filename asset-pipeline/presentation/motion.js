import * as THREE from 'three';
import {reactionClip} from './reactions.js';
import {attackSample} from './motion-state.js';

// Track masks and source phase mapping adopt the original a1 character-animation
// consumer (53ec276). Own only actions/mixer here: adapter owns clone/materials.
const prepared=new WeakMap();
const upper=new Set(['Torso','Head','UpperArm_L','Forearm_L','Hand_L','UpperArm_R','Forearm_R','Hand_R']);
export function createMotion(root,asset,{hurtRegion='upper',strike=5/30,recovery=17/30}={}){
  if(!['upper','full'].includes(hurtRegion))throw new Error('Invalid hurt region');
  if(![strike,recovery].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid visual phase duration');
  if(!prepared.has(asset)){
    const clips=Object.fromEntries(['idle','walk','attack','hurt','death'].map(name=>[name,reactionClip(asset,name)]));
    if(Object.values(clips).some(clip=>!clip))throw new Error('Five motion source clips required');
    prepared.set(asset,{clips,regions:new Map()});
  }
  const {clips,regions}=prepared.get(asset);
  const mixer=new THREE.AnimationMixer(root),actions={};
  for(const [name,clip] of Object.entries(clips))for(const region of name==='death'?['full']:name==='hurt'?[hurtRegion]:name==='attack'?['upper']:['lower','upper']){
    const key=`${name}.${region}`;
    if(!regions.has(key)){const tracks=clip.tracks.filter(track=>region==='full'||upper.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)===(region==='upper'));regions.set(key,new THREE.AnimationClip(key,clip.duration,tracks));}
    const action=mixer.clipAction(regions.get(key));
    action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;actions[`${name}.${region}`]=action;
  }
  const rigRoot=root.getObjectByName('Root'),offset=new THREE.Vector3(),point=new THREE.Vector3(),inverse=new THREE.Matrix4();
  const skins=[];root.traverse(node=>{if(node.isSkinnedMesh)skins.push(node);});
  let base='idle',baseTime=0,current='idle';
  function sample({time,attack=null,hurtAt=null,deathElapsed=null}){
    const swing=attackSample(time,attack,{strike,recovery}),hurtElapsed=hurtAt===null?Infinity:Math.max(0,time-hurtAt);
    const death=deathElapsed!==null;
    const hurt=death?0:Math.min(1,hurtElapsed/.06)*Math.min(1,Math.max(0,(clips.hurt.duration-hurtElapsed)/.06));
    const attackWeight=death?0:swing.weight*(1-hurt);
    for(const [key,action] of Object.entries(actions)){
      const [name,region]=key.split('.');let weight=0,t=0;
      if(name==='death'){weight=death?1:0;t=death?Math.min(clips.death.duration,deathElapsed):0;}
      else if(!death&&name==='hurt'){weight=hurt;t=Math.min(clips.hurt.duration,hurtElapsed);}
      else if(!death&&name==='attack'){weight=attackWeight;t=swing.time;}
      else if(!death&&name===base){weight=region==='upper'?1-hurt-attackWeight:hurtRegion==='full'?1-hurt:1;t=baseTime%clips[name].duration;}
      action.enabled=true;action.paused=true;action.setEffectiveWeight(weight);action.time=Number.isFinite(t)?t:0;
    }
    rigRoot.position.sub(offset);offset.set(0,0,0);mixer.update(0);root.updateMatrixWorld(true);
    // Only active attack/hurt overlays pay this flat-floor contact correction. The motor-owned
    // outer root is untouched. No per-frame skin bounds scan is introduced.
    if(hurt>0||attackWeight>0){
      inverse.copy(root.matrixWorld).invert();let lowest=Infinity;
      for(const mesh of skins)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
        mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);lowest=Math.min(lowest,point.y);
      }
      if(lowest<0){inverse.copy(rigRoot.parent.matrixWorld).invert().multiply(root.matrixWorld);offset.set(0,-lowest,0).applyMatrix4(inverse).sub(point.set(0,0,0).applyMatrix4(inverse));rigRoot.position.add(offset);root.updateMatrixWorld(true);}
    }
    current=death?'death':hurt>0?'hurt':attackWeight>0?'attack':base;
  }
  return {mixer,deathDuration:clips.death.duration,
    play(name){if(name!==base){base=name;baseTime=0;}},advance(seconds){baseTime+=seconds;},sample,
    get action(){return current;},inspect(){return Object.values(actions).filter(action=>action.enabled&&action.getEffectiveWeight()>0).map(action=>({clip:action.getClip().name,tracks:action.getClip().tracks.length,weight:action.getEffectiveWeight(),time:action.time}));},reset(){base='idle';baseTime=0;rigRoot.position.sub(offset);offset.set(0,0,0);},
    dispose(){mixer.stopAllAction();mixer.uncacheRoot(root);}
  };
}
