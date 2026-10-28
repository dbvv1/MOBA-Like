import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3,AnimationMixer,LoopOnce} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {Simulation} from '../../src/sim/simulation.ts';
import {createPresentation,loadCharacterAssets,disposeCharacterAssets} from './adapter.js';
import {reuseReactionClips,reactionClip} from './reactions.js';
const load=async url=>{const b=await readFile(new URL(url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const navigation={closestPoint:p=>({...p}),findPath:(a,b)=>({success:true,points:[a,b],reason:null})};
const assets=await loadCharacterAssets(load);
const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1});
const snapshot=sim.snapshot();
function nodes(root,kind){const a=[];root.traverse(o=>{if(o[kind])a.push(o);});return a;}
function pose(root){return nodes(root,'isBone').map(b=>b.matrix.toArray());}

test('both faction shapes retain exact bindings while the adopted source supplies five independent clips',async()=>{
  assert.equal(nodes(assets.blue.scene,'isSkinnedMesh').length,25);assert.equal(nodes(assets.amber.scene,'isSkinnedMesh').length,26);
  for(const name of ['idle','walk','attack','hurt','death'])for(const asset of Object.values(assets))assert.equal(asset.animations.filter(c=>c.name===name).length,1);
  const a=reactionClip(assets.blue,'death'),b=reactionClip(assets.amber,'death');assert.ok(Math.abs(a.duration-1)<1e-6);assert.deepEqual(a.toJSON().tracks,b.toJSON().tracks);
  assert.notEqual(assets.blue.animations.find(c=>c.name==='death'),assets.amber.animations.find(c=>c.name==='death'));
  const amber=await load(new URL('../placeholder/assets/amber.glb',import.meta.url).href);const mesh=nodes(amber.scene,'isSkinnedMesh')[0];
  mesh.skeleton.boneInverses[0].elements[12]+=.01;
  assert.throws(()=>reuseReactionClips(assets.blue,amber),/binding/);assert.equal(amber.animations.length,3);disposeCharacterAssets({amber});
  for(const mutate of [asset=>{nodes(asset.scene,'isBone')[0].position.x+=.01;},asset=>{nodes(asset.scene,'isSkinnedMesh')[0].bindMatrix.elements[12]+=.01;}]){const changed=await load(new URL('../placeholder/assets/amber.glb',import.meta.url).href);mutate(changed);assert.throws(()=>reuseReactionClips(assets.blue,changed),/differ/);disposeCharacterAssets({changed});}
});

test('alive reversal plays the actual corpse pose, holds finitely, and respawn cancels the old mixer state',()=>{
  const view=createPresentation({catalog:sim.catalog,assets});view.sync(snapshot);view.advance(.2);
  const id=snapshot.heroes[0].id,otherId=snapshot.heroes[1].id;
  const actor=view.root.getObjectByName(`hero-${id}`),other=view.root.getObjectByName(`hero-${otherId}`);
  const dead=structuredClone(snapshot);dead.tick++;dead.timeSeconds+=1/30;dead.heroes[0].alive=false;
  const before=JSON.stringify(dead);view.sync(dead);assert.equal(view.inspect().heroes[0].action,'death');assert.equal(actor.visible,true);
  view.advance(.5);const halfway=pose(actor);view.sync(dead);assert.deepEqual(pose(actor),halfway,'same tick cannot restart reaction');
  view.advance(.5);assert.notDeepEqual(pose(actor),halfway);assert.equal(view.inspect().heroes[1].action,'idle');assert.equal(other.visible,true);
  actor.updateMatrixWorld(true);let minY=Infinity,maxY=-Infinity;
  for(const mesh of nodes(actor,'isSkinnedMesh'))for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  assert.ok(minY>-.001,`authored corpse below ground: ${minY}`);const reference=clone(assets.blue.scene),mixer=new AnimationMixer(reference);const action=mixer.clipAction(reactionClip(assets.blue,'death'));action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.update(1);reference.position.copy(actor.position);reference.quaternion.copy(actor.quaternion);reference.updateMatrixWorld(true);
  const expected=nodes(reference,'isSkinnedMesh'),actualMeshes=nodes(actor,'isSkinnedMesh');
  for(let j=0;j<expected.length;j++)for(let i=0;i<expected[j].geometry.attributes.position.count;i++){const vertex=mesh=>mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)).applyMatrix4(mesh.matrixWorld);assert.ok(vertex(expected[j]).distanceTo(vertex(actualMeshes[j]))<1e-5,'every corpse vertex matches the authored final pose');}
  mixer.stopAllAction();mixer.uncacheRoot(reference);for(const skeleton of new Set(expected.map(mesh=>mesh.skeleton)))skeleton.dispose();
  view.advance(1.1);assert.equal(actor.visible,false,'finite corpse lifetime');
  const alive=structuredClone(dead);alive.tick++;alive.timeSeconds+=3;alive.heroes[0].alive=true;view.sync(alive);view.advance(.1);
  assert.equal(actor.visible,true);assert.equal(view.inspect().heroes[0].action,'idle');assert.notDeepEqual(pose(actor),halfway);assert.equal(JSON.stringify(dead),before);
  view.reset();view.sync(dead);assert.equal(view.inspect().heroes[0].visible,false,'initial dead snapshot does not invent reaction');
  view.dispose();view.dispose();
});

test('a real Simulation tower death triggers presentation without delaying game death or respawn',()=>{
  const actual=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1});const first=actual.snapshot(),hero=first.heroes[0];
  const tower=first.entities.find(e=>e.team!==hero.team&&e.structureKind==='tower');
  const view=createPresentation({catalog:actual.catalog,assets});view.sync(first);let death=null;
  for(let i=0;i<6000;i++){
    actual.step(i===0?[{type:'move',heroId:hero.id,point:{...tower.position}}]:[]);
    const next=actual.snapshot();view.sync(next);
    if(!next.heroes[0].alive){death=next;break;}
  }
  assert.ok(death,'fixture reaches a real combat death');assert.equal(view.inspect().heroes[0].action,'death');assert.equal(death.heroes[0].hp,0);
  const hash=JSON.stringify(actual.snapshot());view.advance(3);assert.equal(JSON.stringify(actual.snapshot()),hash,'animation has no simulation side effects');view.dispose();
});
