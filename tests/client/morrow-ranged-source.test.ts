import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {Vector3} from 'three';
import {createHash} from 'node:crypto';
import manifest from '../../asset-pipeline/battle/morrow-ranged/manifest.json';
import {createMotion} from '../../asset-pipeline/presentation/motion.js';
import {MORROW_MOTION_OPTIONS} from '../../src/render/hero-presentation.js';
const load=async(path:string)=>{const b=await readFile(path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
describe('Morrow isolated ranged source',()=>{
 it.each(['teal','rust'])('%s preserves body rig and other actions, plays real release and death',async team=>{
 const bytes=await readFile(`asset-pipeline/battle/morrow-ranged/exported/morrow-${team}.glb`),pin=manifest.assets.find(a=>a.team===team)!;expect(bytes.length).toBe(pin.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
 const original=await load(`asset-pipeline/battle/exported/hero-${team}.glb`),made=await load(`asset-pipeline/battle/morrow-ranged/exported/morrow-${team}.glb`);
 const bones=(asset:any)=>{const out:any[]=[];asset.scene.traverse((b:any)=>{if(b.isBone)out.push([b.name,b.parent.name,b.position.toArray(),b.quaternion.toArray(),b.scale.toArray()]);});return out;};
 expect(bones(made)).toEqual(bones(original));expect(bones(made)).toHaveLength(15);
 const changed=new Set(['Torso','UpperArm_R','Forearm_R','Hand_R']);
 for(const clip of original.animations){const actual=made.animations.find(c=>c.name===clip.name)!;expect(actual.duration).toBe(clip.duration);expect(actual.tracks.map(t=>t.name)).toEqual(clip.tracks.map(t=>t.name));for(let i=0;i<clip.tracks.length;i++){const t=clip.tracks[i]!,a=actual.tracks[i]!;if(clip.name==='attack'&&changed.has(t.name.split('.')[0]!)&&t.name.endsWith('.quaternion'))continue;expect(a.times).toEqual(t.times);a.values.forEach((v,index)=>expect(Math.abs(v-t.values[index]!),`${team}/${clip.name}/${t.name}`).toBeLessThan(1e-6));}}
 const root=clone(made.scene),motion=createMotion(root,made);const hand=root.getObjectByName('Hand_R')!;
 motion.sample({time:0});root.updateMatrixWorld(true);const idle=hand.getWorldPosition(new Vector3());
 const attack={action:'basicAttack',startedAt:0,windup:.3,resolvedAt:.3,cancelledAt:null};motion.sample({time:.3,attack});root.updateMatrixWorld(true);const release=hand.getWorldPosition(new Vector3());
 expect(motion.inspect().find((a:any)=>a.clip==='attack.upper').time).toBeCloseTo(18/30);expect(release.z-idle.z).toBeGreaterThan(.3);
 motion.sample({time:.1,attack:{...attack,resolvedAt:null}});expect(motion.inspect().find((a:any)=>a.clip==='attack.upper').time).toBeCloseTo((13/30)/3);
 motion.sample({time:.25,attack:{...attack,resolvedAt:null,cancelledAt:.1}});expect(motion.inspect().some((a:any)=>a.clip==='attack.upper')).toBe(false);
 motion.sample({time:1.1,attack});expect(motion.inspect().some((a:any)=>a.clip==='attack.upper')).toBe(false);
 motion.sample({time:.4,hurtAt:.35,attack});expect(motion.inspect().some((a:any)=>a.clip==='hurt.upper')).toBe(true);
 motion.sample({time:.4,deathElapsed:.1,attack});expect(motion.inspect().map((a:any)=>a.clip)).toEqual(['death.full']);
 motion.reset();motion.sample({time:0});expect(motion.action).toBe('idle');motion.dispose();
 });
});

describe('Morrow committed release under damage',()=>{
 it.each(['teal','rust'])('%s keeps real source arms readable with torso recoil and interruption',async team=>{
  const asset=await load(`asset-pipeline/battle/morrow-ranged/exported/morrow-${team}.glb`);
  const root=clone(asset.scene),referenceRoot=clone(asset.scene);
  const motion=createMotion(root,asset,MORROW_MOTION_OPTIONS),plain=createMotion(referenceRoot,asset);
  const attack={action:'basicAttack',startedAt:0,windup:.3,resolvedAt:.3,cancelledAt:null};
  try{
   for(const hurtAt of [.26,.32,.33]){
    motion.sample({time:.4,attack,hurtAt});plain.sample({time:.4,attack});
    expect(motion.inspect().find(a=>a.clip==='attack.upper')?.weight).toBeCloseTo(1);
    expect(motion.inspect().find(a=>a.clip==='hurt.additiveTorso')?.weight).toBeCloseTo(.3);
    for(const bone of ['UpperArm_R','Forearm_R','Hand_R','UpperArm_L'])
     expect(root.getObjectByName(bone)!.quaternion.angleTo(referenceRoot.getObjectByName(bone)!.quaternion)).toBeLessThan(1e-7);
    expect(root.getObjectByName('Torso')!.quaternion.angleTo(referenceRoot.getObjectByName('Torso')!.quaternion)).toBeGreaterThan(.001);
    expect(root.position.toArray()).toEqual([0,0,0]);
   }
   motion.sample({time:.4,attack,hurtAt:.32,controlled:true});
   expect(motion.inspect().some(a=>a.clip==='attack.upper'||a.clip==='hurt.additiveTorso')).toBe(false);
   motion.sample({time:.4,attack,hurtAt:.32,deathElapsed:.1});expect(motion.inspect().map(a=>a.clip)).toEqual(['death.full']);
   motion.reset();motion.sample({time:.55,attack,hurtAt:.47,drawn:true});
   expect(motion.inspect().find(a=>a.clip==='attack.upper')?.weight).toBeCloseTo(1);
   motion.sample({time:.56,attack,hurtAt:.47,drawn:true});expect(motion.inspect().some(a=>a.clip==='hurt.additiveTorso')).toBe(false);
   for(const stopped of [{...attack,cancelledAt:.31},{...attack,visualStopAt:.31}]){
    motion.reset();motion.sample({time:.55,attack:stopped,hurtAt:.47,drawn:true});
    expect(motion.inspect().some(a=>a.clip==='attack.upper'||a.clip==='hurt.additiveTorso')).toBe(false);
   }
   motion.reset();motion.sample({time:2,attack,drawn:true});expect(motion.inspect().some(a=>a.clip==='attack.upper')).toBe(false);
   motion.reset();motion.sample({time:0});expect(motion.action).toBe('idle');
  }finally{motion.dispose();plain.dispose();}
 });
});
