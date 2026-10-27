import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {AnimationMixer,Vector3,SkinnedMesh} from 'three';
import manifest from '../../asset-pipeline/heroes/veyra-release/manifest.json';
import {createPresentation} from '../../asset-pipeline/presentation/adapter.js';
import {createMotion} from '../../asset-pipeline/presentation/motion.js';
import {makeSim} from '../helpers.js';
const read=async(path:string)=>{const bytes=await readFile(new URL(path,import.meta.url));return {bytes,asset:await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')};};
const blue=await read('../../asset-pipeline/heroes/veyra-release/exported/veyra-teal.glb');
const red=await read('../../asset-pipeline/heroes/veyra-release/exported/veyra-rust.glb');
const old=await read('../../asset-pipeline/battle/exported/hero-teal.glb');
const bones=(asset:GLTF)=>{const rows:string[]=[];asset.scene.traverse(o=>{if(o.type==='Bone')rows.push(`${o.name}:${o.parent?.name}`);});return rows;};
describe('definition-specific Veyra release source',()=>{
 it('retains the original official animation input and maps actual bind sides, not suffixes',async()=>{
  const source=await read('../../asset-pipeline/heroes/veyra-release/source/UAL1_Standard.glb');
  expect(createHash('sha256').update(source.bytes).digest('hex')).toBe(manifest.animationSource.sha256);
  expect(source.asset.animations).toHaveLength(43);
  for(const name of manifest.animationSource.clips)expect(source.asset.animations.some(c=>c.name===name)).toBe(true);
  source.asset.scene.updateMatrixWorld(true);blue.asset.scene.updateMatrixWorld(true);
  expect(source.asset.scene.getObjectByName('hand_l')!.getWorldPosition(new Vector3()).x).toBeGreaterThan(0);
  expect(blue.asset.scene.getObjectByName('Hand_R')!.getWorldPosition(new Vector3()).x).toBeGreaterThan(0);
  expect(manifest.animationSource.boneMap.Hand_R).toBe('hand_l');
 });
 it('uses fixed real exports with the same fifteen-bone hierarchy and five named clips',()=>{
  for(const [index,source] of [blue,red].entries()){
   expect(createHash('sha256').update(source.bytes).digest('hex')).toBe(manifest.assets[index]!.sha256);
   expect(bones(source.asset)).toEqual(bones(old.asset));expect(bones(source.asset)).toHaveLength(15);
   expect(source.asset.animations.map(c=>c.name).sort()).toEqual(['attack','death','hurt','idle','walk']);
   for(const name of ['idle','walk','hurt','death']){
    const a=source.asset.animations.find(c=>c.name===name)!,b=old.asset.animations.find(c=>c.name===name)!;
    expect(a.duration).toBeCloseTo(b.duration,6);expect(a.tracks.map(t=>t.name)).toEqual(b.tracks.map(t=>t.name));
    a.tracks.forEach((t,i)=>{expect(t.values.length).toBe(b.tracks[i]!.values.length);for(let j=0;j<t.values.length;j++)expect(Math.abs(t.values[j]!-b.tracks[i]!.values[j]!)).toBeLessThan(1e-5);});
   }
  }
 });
 it('samples the real committed release forward without moving the simulation-owned root',()=>{
  const root=clone(blue.asset.scene),motion=createMotion(root,blue.asset);root.position.set(4,0,2);
  motion.sample({time:0});root.updateMatrixWorld(true);const idle=root.getObjectByName('Hand_R')!.getWorldPosition(new Vector3());
  motion.sample({time:.1,attack:{castId:null,startedAt:0,windup:0,resolvedAt:0,cancelledAt:null}});root.updateMatrixWorld(true);
  const released=root.getObjectByName('Hand_R')!.getWorldPosition(new Vector3());expect(released.z-idle.z).toBeGreaterThan(.35);expect(root.position.toArray()).toEqual([4,0,2]);
  motion.sample({time:.5,attack:{castId:1,startedAt:0,windup:.5,resolvedAt:null,cancelledAt:null}});root.updateMatrixWorld(true);
  const held=root.getObjectByName('Hand_R')!.getWorldPosition(new Vector3());expect(held.z-idle.z).toBeGreaterThan(.7,'the source Enter ends in its extended ready stance');expect(motion.inspect().find(a=>a.clip==='attack.upper')?.time).toBeCloseTo(13/30);motion.dispose();
 });
 it('layers ordinary pre/post-commit and repeated damage without replacing the release, but honors control/death',()=>{
  const attack={castId:null,startedAt:1,windup:0,resolvedAt:1,cancelledAt:null};
  const plain=createMotion(clone(blue.asset.scene),blue.asset),layered=createMotion(clone(blue.asset.scene),blue.asset,{recoilLayer:'torso-additive'});
  for(const hurtAt of [.9,1.02,1.06]){
   for(const motion of [plain,layered])motion.sample({time:1.12,attack,hurtAt});
   expect(plain.inspect().find(a=>a.clip==='attack.upper')?.weight??0).toBeLessThan(.01);
   expect(layered.inspect().find(a=>a.clip==='attack.upper')?.weight).toBeCloseTo(1);
   expect(layered.inspect().find(a=>a.clip==='hurt.additiveTorso')?.weight).toBeCloseTo(.3);
  }
  for(const time of [1.1,1.13,1.16,1.19]){
   layered.sample({time,attack,hurtAt:time-.07});expect(layered.inspect().find(a=>a.clip==='attack.upper')?.weight).toBeCloseTo(1);
  }
  layered.sample({time:1.12,attack,hurtAt:1.02,controlled:true});
  expect(layered.inspect().some(a=>a.clip==='attack.upper')).toBe(false);expect(layered.inspect().some(a=>a.clip==='hurt.additiveTorso')).toBe(false);
  layered.sample({time:1.12,attack,hurtAt:1.02,deathElapsed:.1});expect(layered.inspect().map(a=>a.clip)).toEqual(['death.full']);
  layered.sample({time:1.3,attack,hurtAt:1.2});expect(layered.inspect().some(a=>a.clip==='hurt.additiveTorso')).toBe(false);
  expect(layered.inspect().find(a=>a.clip==='hurt.upper')?.weight).toBeCloseTo(1);
  plain.dispose();layered.dispose();
 });
 it('confirms a skipped committed main pose once on actual draw, not sync, and never replays control/death or expired actions',()=>{
  const root=clone(blue.asset.scene),motion=createMotion(root,blue.asset,{recoilLayer:'torso-additive',firstDrawRelease:.1});
  const attack={castId:null,startedAt:1,windup:0,resolvedAt:1,cancelledAt:null};
  const weight=()=>motion.inspect().find(a=>a.clip==='attack.upper')?.weight??0;
  motion.sample({time:1.25,attack,hurtAt:1.15});expect(weight()).toBe(0);
  motion.sample({time:1.25,attack,hurtAt:1.15,drawn:true});expect(weight()).toBeCloseTo(1);
  expect(motion.inspect().find(a=>a.clip==='attack.upper')?.time).toBeCloseTo(13/30+.1);
  motion.sample({time:1.26,attack,hurtAt:1.15,drawn:true});expect(weight()).toBe(0);
  motion.reset();motion.sample({time:1.2,attack,controlled:true});motion.sample({time:1.3,attack,hurtAt:1.2,drawn:true});expect(weight()).toBe(0);
  motion.reset();motion.sample({time:1.2,attack,deathElapsed:.1});motion.sample({time:1.3,attack,hurtAt:1.2,drawn:true});expect(weight()).toBe(0);
  motion.reset();motion.sample({time:2,attack,drawn:true});expect(weight()).toBe(0);
  motion.reset();motion.sample({time:1.3,attack:{...attack,cancelledAt:1.1},drawn:true});expect(weight()).toBe(0);
  motion.dispose();
 });
 it('selects by hero definition in either team and resets without taking source ownership',async()=>{
  const sim=await makeSim(10,61),snap=structuredClone(sim.snapshot());snap.heroes[0]!.definitionId='veyra';snap.heroes[1]!.definitionId='morrow';
  const assets={blue:old.asset,amber:old.asset,byDefinition:{veyra:{blue:blue.asset,amber:red.asset}}};
  let sourceDisposals=0;blue.asset.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)(o as SkinnedMesh).geometry.addEventListener('dispose',()=>sourceDisposals++);});
  const view=createPresentation({catalog:sim.catalog,assets,heroesOnly:true});view.sync(snap);
  expect(view.root.getObjectByName(`hero-${snap.heroes[0]!.id}`)!.getObjectByName('veyra-body')).toBeDefined();
  expect(view.root.getObjectByName(`hero-${snap.heroes[1]!.id}`)!.getObjectByName('veyra-body')).toBeUndefined();
  view.reset();snap.heroes[1]!.definitionId='veyra';view.sync(snap);expect(view.root.getObjectByName(`hero-${snap.heroes[1]!.id}`)!.getObjectByName('veyra-body')).toBeDefined();
  view.dispose();view.dispose();expect(sourceDisposals).toBe(0);
 });
 it('does not add floor penetration beyond the adopted body source through all five actions',()=>{
  for(const asset of [blue.asset,red.asset]){
   const root=clone(asset.scene),mixer=new AnimationMixer(root);
   for(const clip of asset.animations){const action=mixer.clipAction(clip);action.play();let lowest=Infinity;
    for(let i=0;i<=60;i++){mixer.setTime(clip.duration*i/60);root.updateMatrixWorld(true);root.traverse(o=>{const skin=o as SkinnedMesh;if(skin.isSkinnedMesh)for(let v=0;v<skin.geometry.attributes['position']!.count;v++)lowest=Math.min(lowest,skin.getVertexPosition(v,new Vector3()).applyMatrix4(skin.matrixWorld).y);});}
    // The original body already dips at the feet during death; compare the
    // unchanged source rather than falsely claiming zero floor penetration.
    const originalRoot=clone(old.asset.scene),originalMixer=new AnimationMixer(originalRoot),originalClip=old.asset.animations.find(c=>c.name===clip.name)!;originalMixer.clipAction(originalClip).play();let originalLowest=Infinity;
    for(let i=0;i<=60;i++){originalMixer.setTime(originalClip.duration*i/60);originalRoot.updateMatrixWorld(true);originalRoot.traverse(o=>{const skin=o as SkinnedMesh;if(skin.isSkinnedMesh)for(let v=0;v<skin.geometry.attributes['position']!.count;v++)originalLowest=Math.min(originalLowest,skin.getVertexPosition(v,new Vector3()).applyMatrix4(skin.matrixWorld).y);});}
    expect(lowest,clip.name).toBeGreaterThanOrEqual(originalLowest-.00001);originalMixer.stopAllAction();originalMixer.uncacheRoot(originalRoot);action.stop();
   }mixer.stopAllAction();mixer.uncacheRoot(root);
  }
 });
});
