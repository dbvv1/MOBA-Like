import * as THREE from 'three';

// This is same-rig animation reuse, not general retargeting. Require the actual
// bone order, hierarchy, local/world axes, bind and inverse matrices to match.
export function reuseReactionClips(source, target) {
  function bindings(scene) {
    scene.updateMatrixWorld(true);
    const bones = [], meshes = [];
    scene.traverse(node => { if(node.isBone) bones.push(node); if(node.isSkinnedMesh) meshes.push(node); });
    if(!bones.length || !meshes.length || new Set(bones.map(b=>b.name)).size!==bones.length) throw new Error('Unique reaction rig bones required');
    const byName=new Map(bones.map(bone=>[bone.name,bone]));
    if(!meshes.every(mesh=>mesh.skeleton.bones.every(bone=>byName.get(bone.name)===bone)))throw new Error('Reaction skin references a foreign bone');
    return {bones,meshes};
  }
  const a=bindings(source.scene),b=bindings(target.scene);
  if(a.bones.length!==b.bones.length || !a.bones.every((bone,i)=>{
    const other=b.bones[i];return bone.name===other.name && bone.parent?.name===other.parent?.name && bone.matrix.equals(other.matrix) && bone.matrixWorld.equals(other.matrixWorld);
  }))throw new Error('Reaction rig axes/hierarchy differ');
  const canonical=a.meshes[0];
  for(const mesh of [...a.meshes,...b.meshes]){
    if(!mesh.bindMatrix.equals(canonical.bindMatrix)||!mesh.bindMatrixInverse.equals(canonical.bindMatrixInverse)||mesh.skeleton.bones.length!==canonical.skeleton.bones.length||mesh.skeleton.boneInverses.length!==canonical.skeleton.boneInverses.length||!mesh.skeleton.bones.every((bone,i)=>bone.name===canonical.skeleton.bones[i].name)||!mesh.skeleton.boneInverses.every((inverse,i)=>inverse.equals(canonical.skeleton.boneInverses[i])))throw new Error('Reaction skin binding differs');
  }
  const clips=['hurt','death'].map(name=>{
    const matches=source.animations.filter(clip=>clip.name===name);if(matches.length!==1)throw new Error(`One ${name} clip required`);
    return matches[0].clone();
  });
  // Preserve amber's geometry, materials and original idle/walk/attack clips.
  target.animations=[...target.animations.filter(clip=>!['hurt','death'].includes(clip.name)),...clips];
}

export function reactionClip(asset,name) {
  const original=asset.animations.find(clip=>clip.name===name);if(!original)return null;
  const start=Math.min(...original.tracks.map(track=>track.times[0]));
  const end=Math.max(...original.tracks.map(track=>track.times[track.times.length-1]));
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Invalid reaction clip times');
  return new THREE.AnimationClip(name,end-start,original.tracks.map(track=>track.clone().shift(-start)));
}
