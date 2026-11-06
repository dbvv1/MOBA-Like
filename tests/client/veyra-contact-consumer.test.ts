import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {AnimationMixer,LoopOnce,Vector3} from 'three';
import candidateManifest from '../../asset-pipeline/veyra-death-contact/manifest.json';
import fallbackManifest from '../../asset-pipeline/veyra-death-contact/runtime-fallback/manifest.json';
import heroManifest from '../../asset-pipeline/heroes/veyra-release/manifest.json';
import {createMotion} from '../../asset-pipeline/presentation/motion.js';
import {createPresentation} from '../../asset-pipeline/presentation/adapter.js';
import {makeSim} from '../helpers.js';

// This file consumes the received Veyra death-contact candidates through the
// production presentation modules. It does not implement a second animator:
// createMotion wraps the same THREE.AnimationMixer that the game uses, and
// createPresentation is the real snapshot consumer. Only the test fixture is
// swapped to the candidate GLBs; the source model, render code and defaults are
// read-only here.
const read=async(path:string)=>{
  const bytes=await readFile(new URL(path,import.meta.url));
  const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
  return {bytes,asset};
};
const candidatePaths=['../../asset-pipeline/veyra-death-contact/exported/veyra-teal.glb','../../asset-pipeline/veyra-death-contact/exported/veyra-rust.glb'] as const;
const baselinePaths=['../../asset-pipeline/heroes/veyra-release/exported/veyra-teal.glb','../../asset-pipeline/heroes/veyra-release/exported/veyra-rust.glb'] as const;
const fallbackPaths=['../../asset-pipeline/veyra-death-contact/runtime-fallback/exported/veyra-teal.glb','../../asset-pipeline/veyra-death-contact/runtime-fallback/exported/veyra-rust.glb'] as const;
const teams=['teal','rust'] as const;
const candidates=[await read(candidatePaths[0]),await read(candidatePaths[1])] as const;
const baselines=[await read(baselinePaths[0]),await read(baselinePaths[1])] as const;
const fallbacks=[await read(fallbackPaths[0]),await read(fallbackPaths[1])] as const;

const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const clipOf=(asset:GLTF,name:string)=>asset.animations.find(clip=>clip.name===name)!;
const materialName=(mesh:any)=>{
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  return materials[0]?.name??'';
};
const teamPrefixes=['battle-teal','battle-rust'];
const focusMaterials=new Set(['battle-wood','battle-focus']);
const handMaterials=new Set(['battle-gold']);

type VertexClass={bone:string;foot:boolean;weapon:boolean};
type Part={mesh:any;material:string;classes:VertexClass[]};

// Mirrors the source package's contact classification: dominant skin joint per
// vertex, focus-prop materials excluded from the body set, Foot_* dominates the
// foot set. Comparing against check_contact.py's numbers below is what proves
// this test uses the same coordinate convention (+Y up, ground at y=0).
function skinnedParts(root:any):Part[]{
  const parts:Part[]=[];
  root.traverse((node:any)=>{
    if(!node.isSkinnedMesh)return;
    const material=materialName(node);
    const skinIndex=node.geometry.attributes.skinIndex;
    const skinWeight=node.geometry.attributes.skinWeight;
    const classes:VertexClass[]=[];
    for(let index=0;index<skinIndex.count;index+=1){
      let best=0,bestWeight=-1;
      for(let slot=0;slot<4;slot+=1){
        const weight=skinWeight.getComponent(index,slot);
        if(weight>bestWeight){bestWeight=weight;best=slot;}
      }
      const bone=node.skeleton.bones[skinIndex.getComponent(index,best)].name as string;
      const foot=bone==='Foot_L'||bone==='Foot_R';
      const weapon=focusMaterials.has(material)||(handMaterials.has(material)||teamPrefixes.some(prefix=>material.startsWith(prefix)))?bone==='Hand_L':false;
      classes.push({bone,foot,weapon});
    }
    parts.push({mesh:node,material,classes});
  });
  return parts;
}

function contact(root:any,parts:Part[]){
  root.updateMatrixWorld(true);
  const point=new Vector3();
  let body=Infinity,foot=Infinity,bodyBone='',footBone='';
  for(const {mesh,classes} of parts){
    for(let index=0;index<classes.length;index+=1){
      mesh.getVertexPosition(index,point);
      point.applyMatrix4(mesh.matrixWorld);
      const y=point.y;
      if(!classes[index].weapon&&y<body){body=y;bodyBone=classes[index].bone;}
      if(classes[index].foot&&y<foot){foot=y;footBone=classes[index].bone;}
    }
  }
  return {body,foot,bodyBone,footBone};
}

function deathFrames(){
  const rows:{frame:number;sourceTime:number;deathElapsed:number}[]=[];
  for(let frame=1;frame<=31;frame+=0.5){
    rows.push({frame,sourceTime:frame/30,deathElapsed:(frame-1)/30});
  }
  return rows;
}

function boneHierarchy(asset:GLTF){
  const rows:string[]=[];
  asset.scene.traverse(node=>{if(node.type==='Bone')rows.push(`${node.name}:${node.parent?.name??''}`);});
  return rows.sort();
}

function boneWorld(root:any){
  root.updateMatrixWorld(true);
  const pose=new Map<string,number[]>();
  root.traverse((node:any)=>{if(node.isBone)pose.set(node.name,node.matrixWorld.toArray());});
  return pose;
}

function poseDelta(left:Map<string,number[]>,right:Map<string,number[]>){
  let worst=0;
  expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
  for(const [name,matrix] of left){
    const other=right.get(name)!;
    for(let index=0;index<matrix.length;index+=1)worst=Math.max(worst,Math.abs(matrix[index]!-other[index]!));
  }
  return worst;
}

// Decoded mesh identity by material name: positions, normals and skin
// influences keyed by bone name (candidate containers reorder joints, so raw
// JOINTS_0 indices cannot be compared).
function meshSignature(asset:GLTF){
  const groups=new Map<string,{vertices:number;triangles:number;records:string[]}>();
  asset.scene.traverse((node:any)=>{
    if(!node.isMesh)return;
    const material=materialName(node);
    const group=groups.get(material)??{vertices:0,triangles:0,records:[]};
    groups.set(material,group);
    const position=node.geometry.attributes.position;
    const normal=node.geometry.attributes.normal;
    const index=node.geometry.index;
    expect(normal,'every primitive must keep NORMAL').toBeDefined();
    expect(normal.count).toBe(position.count);
    group.vertices+=position.count;
    group.triangles+=(index?index.count:position.count)/3;
    const skinIndex=node.geometry.attributes.skinIndex;
    const skinWeight=node.geometry.attributes.skinWeight;
    for(let vertex=0;vertex<position.count;vertex+=1){
      const influences:string[]=[];
      if(skinIndex&&skinWeight){
        for(let slot=0;slot<4;slot+=1){
          const weight=skinWeight.getComponent(vertex,slot);
          if(weight===0)continue;
          influences.push(`${node.skeleton.bones[skinIndex.getComponent(vertex,slot)].name}=${weight.toFixed(6)}`);
        }
        influences.sort();
      }
      group.records.push([
        position.getX(vertex).toFixed(5),position.getY(vertex).toFixed(5),position.getZ(vertex).toFixed(5),
        normal.getX(vertex).toFixed(4),normal.getY(vertex).toFixed(4),normal.getZ(vertex).toFixed(4),
        influences.join(','),
      ].join('|'));
    }
  });
  return groups;
}

const motionOptions={recoilLayer:'override' as const};

function summary(motion:any){
  return motion.inspect().map((action:any)=>`${action.clip}:${action.tracks}:${action.weight.toFixed(6)}:${action.time.toFixed(6)}`).sort();
}

function driveNonDeath(motion:any,clip:'idle'|'walk'|'attack'|'hurt',time:number){
  if(clip==='idle'||clip==='walk'){motion.play(clip);motion.advance(time);motion.sample({time:0});return;}
  if(clip==='hurt'){motion.sample({time:0.2+time,hurtAt:0.2});return;}
  motion.sample({time,attack:{castId:null,startedAt:0,windup:0,resolvedAt:0,cancelledAt:null}});
}

describe('received Veyra death-contact candidates through the production consumer',()=>{
  it('uses the source-rebuilt two-faction GLBs as fixtures and keeps the runtime fallback separate',()=>{
    expect(candidateManifest.kind).toBe('source-rebuilt-candidate');
    expect(candidateManifest.editableSource.status).toBe('produced');
    expect(fallbackManifest.kind).toBe('runtime-fallback');
    expect(fallbackManifest.editableSource.status).toBe('superseded');
    teams.forEach((team,index)=>{
      const candidate=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const fallback=fallbackManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      expect(candidate.file).not.toContain('runtime-fallback');
      expect(fallback.file).toContain('runtime-fallback');
      expect(sha256(candidates[index]!.bytes)).toBe(candidate.sha256);
      expect(candidates[index]!.bytes.length).toBe(candidate.bytes);
      expect(sha256(fallbacks[index]!.bytes)).toBe(fallback.sha256);
      expect(sha256(fallbacks[index]!.bytes)).not.toBe(candidate.sha256);
      expect(sha256(baselines[index]!.bytes)).toBe(heroManifest.assets[index]!.sha256);
    });
  });

  it('applies every candidate death Root Y key through createMotion, not just GLB metadata',()=>{
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      const entry=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const offsets=entry.deathOffsets.map(offset=>offset.offsetY);
      const baselineTrack=clipOf(baseline,'death').tracks.find(track=>track.name==='Root.position')! as any;
      const candidateTrack=clipOf(candidate,'death').tracks.find(track=>track.name==='Root.position')! as any;
      expect(candidateTrack.times.length).toBe(31);
      expect(Array.from(candidateTrack.times)).toEqual(Array.from(baselineTrack.times));
      const root=clone(candidate.scene),motion=createMotion(root,candidate,motionOptions);
      const shift=Math.min(...clipOf(candidate,'death').tracks.map(track=>track.times[0]!));
      let worst=0;
      for(let key=0;key<31;key+=1){
        motion.sample({time:0,deathElapsed:candidateTrack.times[key]-shift});
        const actual=root.getObjectByName('Root')!.position.y;
        const expected=baselineTrack.values[key*3+1]!+offsets[key]!;
        worst=Math.max(worst,Math.abs(actual-expected));
      }
      expect(worst).toBeLessThan(1e-5);
      // The largest lift (key 12, +0.0518 m) must survive the shift/mixer.
      motion.sample({time:0,deathElapsed:candidateTrack.times[12]-shift});
      expect(root.getObjectByName('Root')!.position.y).toBeCloseTo(baselineTrack.values[12*3+1]!+offsets[12]!,5);
      motion.dispose();
    });
  });

  it('matches the source package check_contact world-space foot and body minima at 0/25/50/75/100% and the last frame',()=>{
    // Source frames for 0/25/50/75/100% of the 30-interval death clip.
    const sampleFrames=[1,8.5,16,23.5,31];
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      const entry=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const candidateRoot=clone(candidate.scene),candidateParts=skinnedParts(candidateRoot);
      const baselineRoot=clone(baseline.scene),baselineParts=skinnedParts(baselineRoot);
      const candidateMotion=createMotion(candidateRoot,candidate,motionOptions);
      const baselineMotion=createMotion(baselineRoot,baseline,motionOptions);
      const rawRoot=clone(candidate.scene),rawParts=skinnedParts(rawRoot);
      const rawMixer=new AnimationMixer(rawRoot),rawAction=rawMixer.clipAction(clipOf(candidate,'death'));
      // Match the production death path: one shot clamped at the final key, so
      // sampling at 100% does not wrap back to frame 1.
      rawAction.setLoop(LoopOnce,1);rawAction.clampWhenFinished=true;rawAction.play();rawAction.paused=true;
      const rawAt=(sourceTime:number)=>{
        rawAction.time=Math.min(rawAction.getClip().duration,sourceTime);
        rawMixer.update(0);
        return contact(rawRoot,rawParts);
      };

      const candidateRows=new Map<number,{body:number;foot:number;bodyBone:string;footBone:string}>();
      const baselineRows=new Map<number,{body:number;foot:number;bodyBone:string;footBone:string}>();
      for(const row of deathFrames()){
        candidateMotion.sample({time:0,deathElapsed:row.deathElapsed});
        candidateRows.set(row.frame,contact(candidateRoot,candidateParts));
        baselineMotion.sample({time:0,deathElapsed:row.deathElapsed});
        baselineRows.set(row.frame,contact(baselineRoot,baselineParts));
      }
      expect(candidateRows.size).toBe(61);
      for(const row of deathFrames()){
        const candidateRow=candidateRows.get(row.frame)!;
        const baselineRow=baselineRows.get(row.frame)!;
        expect(candidateRow.body,`${team} frame ${row.frame} must not fall below the shipped baseline`).toBeGreaterThanOrEqual(baselineRow.body-1e-6);
        expect(candidateRow.foot,`${team} frame ${row.frame} foot tolerance`).toBeGreaterThanOrEqual(-0.005);
        expect(candidateRow.body,`${team} frame ${row.frame} body tolerance`).toBeGreaterThanOrEqual(-0.01);
        expect(candidateRow.body,`${team} frame ${row.frame} must not float`).toBeLessThanOrEqual(0.02);
        // Direct THREE.AnimationMixer sampling of the original (unshifted)
        // clip at source-frame time is the same CPU pose as the production
        // consumer at its shifted deathElapsed.
        const rawRow=rawAt(row.sourceTime);
        expect(rawRow.body).toBeCloseTo(candidateRow.body,5);
        expect(rawRow.foot).toBeCloseTo(candidateRow.foot,5);
      }

      const lowestBody=Math.min(...[...candidateRows.values()].map(row=>row.body));
      const lowestFoot=Math.min(...[...candidateRows.values()].map(row=>row.foot));
      const highestBody=Math.max(...[...candidateRows.values()].map(row=>row.body));
      const baselineWorst=Math.min(...[...baselineRows.values()].map(row=>row.body));
      const lowestBodyRow=[...candidateRows].reduce((left,right)=>right[1].body<left[1].body?right:left);
      const lowestFootRow=[...candidateRows].reduce((left,right)=>right[1].foot<left[1].foot?right:left);
      const baselineWorstRow=[...baselineRows].reduce((left,right)=>right[1].body<left[1].body?right:left);
      // Source package values (check_contact / manifest) reproduced through the
      // real consumer in the same +Y-up world space, including which frame and
      // which bone owns each extreme.
      expect(lowestBody).toBeCloseTo(entry.contactAtFrameAndHalf.lowestBodyMinY,4);
      expect(highestBody).toBeCloseTo(entry.contactAtFrameAndHalf.highestBodyMinY,4);
      expect(lowestFoot).toBeCloseTo(-0.000127,4);
      expect(baselineWorst).toBeCloseTo(-0.051905,4);
      expect(highestBody).toBeCloseTo(0.014601,4);
      expect(lowestBodyRow[0]).toBe(31);
      expect(lowestBodyRow[1].bodyBone).toBe('Hand_R');
      expect(lowestFootRow[0]).toBe(15.5);
      expect(lowestFootRow[1].footBone).toBe('Foot_L');
      expect(baselineWorstRow[0]).toBe(13.5);
      expect(baselineWorstRow[1].bodyBone).toBe('Foot_L');
      // First and last frames are unchanged by the candidate (zero offsets).
      expect(candidateRows.get(1)!.body).toBeCloseTo(baselineRows.get(1)!.body,6);
      expect(candidateRows.get(31)!.body).toBeCloseTo(baselineRows.get(31)!.body,6);
      // 100% of the clip and the real final frame are the same pose; the
      // production death path clamps beyond the duration (freeze).
      candidateMotion.sample({time:0,deathElapsed:candidateMotion.deathDuration});
      const lastFrame=contact(candidateRoot,candidateParts);
      const lastRootY=candidateRoot.getObjectByName('Root')!.position.y;
      expect(lastFrame.body).toBeCloseTo(candidateRows.get(31)!.body,5);
      expect(lastFrame.foot).toBeCloseTo(candidateRows.get(31)!.foot,5);
      candidateMotion.sample({time:0,deathElapsed:candidateMotion.deathDuration+5});
      expect(contact(candidateRoot,candidateParts).body).toBeCloseTo(lastFrame.body,6);
      expect(candidateRoot.getObjectByName('Root')!.position.y).toBeCloseTo(lastRootY,6);
      // The fraction samples are exactly the source frames 1 / 8.5 / 16 /
      // 23.5 / 31 (0/25/50/75/100% of the 30-interval clip).
      for(const frame of sampleFrames){
        candidateMotion.sample({time:0,deathElapsed:(frame-1)/30});
        const sample=contact(candidateRoot,candidateParts);
        expect(sample.body).toBeCloseTo(candidateRows.get(frame)!.body,5);
        expect(sample.foot).toBeCloseTo(candidateRows.get(frame)!.foot,5);
        const raw=rawAt(frame/30);
        expect(raw.body).toBeCloseTo(sample.body,5);
        expect(raw.foot).toBeCloseTo(sample.foot,5);
      }
      rawMixer.stopAllAction();rawMixer.uncacheRoot(rawRoot);
      candidateMotion.dispose();baselineMotion.dispose();
    });
  });

  it('keeps bones, NORMALs, skin weights and non-death clips identical to the shipped release',()=>{
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      expect(boneHierarchy(candidate)).toEqual(boneHierarchy(baseline));
      expect(boneHierarchy(candidate)).toHaveLength(15);
      // Candidate containers reorder nodes/joints; the hierarchy is compared
      // as a sorted name:parent set, never by traversal index.
      const candidateSignature=meshSignature(candidate),baselineSignature=meshSignature(baseline);
      expect([...candidateSignature.keys()].sort()).toEqual([...baselineSignature.keys()].sort());
      for(const [material,signature] of candidateSignature){
        const shipped=baselineSignature.get(material)!;
        expect(signature.vertices,material).toBe(shipped.vertices);
        expect(signature.triangles,material).toBe(shipped.triangles);
        expect(signature.records,material).toEqual(shipped.records);
      }
      for(const name of ['idle','walk','attack','hurt']){
        const candidateClip=clipOf(candidate,name),baselineClip=clipOf(baseline,name);
        expect(candidateClip.duration).toBeCloseTo(baselineClip.duration,6);
        const shippedTracks=new Map(baselineClip.tracks.map(track=>[track.name,track as any]));
        expect([...candidateClip.tracks.map(track=>track.name)].sort()).toEqual([...shippedTracks.keys()].sort());
        for(const track of candidateClip.tracks as any[]){
          const shipped=shippedTracks.get(track.name)!;
          expect(track.values.length).toBe(shipped.values.length);
          for(let value=0;value<track.values.length;value+=1)expect(Math.abs(track.values[value]-shipped.values[value])).toBeLessThan(1e-5);
        }
      }
      // The production consumer must show the same pose for all four non-death
      // clips, not merely identical decoded tracks.
      const cases:[('idle'|'walk'|'attack'|'hurt'),number][]=[['idle',0.37],['walk',0.42],['attack',0.1],['hurt',0.1]];
      for(const [clip,time] of cases){
        const candidateRoot=clone(candidate.scene),baselineRoot=clone(baseline.scene);
        const candidateMotion=createMotion(candidateRoot,candidate,motionOptions);
        const baselineMotion=createMotion(baselineRoot,baseline,motionOptions);
        driveNonDeath(candidateMotion,clip,time);driveNonDeath(baselineMotion,clip,time);
        expect(summary(candidateMotion)).toEqual(summary(baselineMotion));
        expect(candidateMotion.inspect().some((action:any)=>action.clip==='death.full')).toBe(false);
        expect(poseDelta(boneWorld(candidateRoot),boneWorld(baselineRoot))).toBeLessThan(1e-9);
        candidateMotion.dispose();baselineMotion.dispose();
      }
    });
  });

  it('keeps cloned bones and action state isolated when an instance dies, is destroyed and a new one is created',async()=>{
    const teal=candidates[0]!.asset,rust=candidates[1]!.asset;
    let sourceDisposals=0;
    for(const asset of [teal,rust])asset.scene.traverse((node:any)=>{
      if(!node.isSkinnedMesh)return;
      node.geometry.addEventListener('dispose',()=>{sourceDisposals+=1;});
      for(const material of Array.isArray(node.material)?node.material:[node.material])material.addEventListener('dispose',()=>{sourceDisposals+=1;});
    });
    const assets={blue:teal,amber:rust,byDefinition:{veyra:{blue:teal,amber:rust}}};
    const sim=await makeSim(10,61),base=sim.snapshot();
    const bAt=(x:number)=>({...structuredClone(base.heroes[1]!),position:{x,z:base.heroes[1]!.position.z}});
    const aAt=(alive:boolean)=>({...structuredClone(base.heroes[0]!),alive});
    const cAt=(alive:boolean)=>({...structuredClone(base.heroes[0]!),id:11,team:0,alive,position:{x:-80,z:0}});
    const snapshot=(tick:number,time:number,heroes:any[])=>({...structuredClone(base),tick,timeSeconds:time,events:[],heroes});
    const view=createPresentation({catalog:sim.catalog,assets,heroesOnly:true});
    const reference=createPresentation({catalog:sim.catalog,assets,heroesOnly:true});

    const step=(presentation:any,snapshot:any,tick:number)=>{
      presentation.sync(snapshot);
      presentation.advance(tick,1);
    };
    const materialNames=(root:any)=>{const names=new Set<string>();root.traverse((node:any)=>{if(node.isSkinnedMesh)names.add(materialName(node));});return [...names].sort();};

    // tick 0: both alive, candidate teams selected by definition.
    step(view,snapshot(0,0,[aAt(true),bAt(94)]),0);
    step(reference,snapshot(0,0,[bAt(94)]),0);
    const aRoot=view.root.getObjectByName('hero-9'),bRoot=view.root.getObjectByName('hero-10');
    expect(aRoot).toBeDefined();expect(bRoot).toBeDefined();
    expect(aRoot).not.toBe(bRoot);
    expect(aRoot!.getObjectByName('Root')).not.toBe(bRoot!.getObjectByName('Root'));
    expect(materialNames(aRoot)).toContain('battle-teal');
    expect(materialNames(aRoot)).not.toContain('battle-rust');
    expect(materialNames(bRoot)).toContain('battle-rust');
    expect(materialNames(bRoot)).not.toContain('battle-teal');

    // tick 1-2: A dies, B keeps moving.
    step(view,snapshot(1,1,[aAt(false),bAt(96)]),1);
    step(view,snapshot(2,2,[aAt(false),bAt(98)]),2);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===9)?.action).toBe('death');
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');
    expect(view.motionState().find((entry:any)=>entry.id===9)!.actions.map((action:any)=>action.clip)).toEqual(['death.full']);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>action.clip).sort()).toEqual(['walk.lower','walk.upper']);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.some((action:any)=>action.clip==='death.full')).toBe(false);
    expect(aRoot!.getObjectByName('Root')!.position.y).toBeCloseTo(0.733078,4);
    expect(bRoot!.getObjectByName('Root')!.position.y).not.toBeCloseTo(0.733078,4);

    // tick 3: A is destroyed; B still walks and no source resource is disposed.
    step(view,snapshot(3,3,[bAt(100)]),3);
    expect(view.root.getObjectByName('hero-9')).toBeUndefined();
    expect(view.root.getObjectByName('hero-10')).toBeDefined();
    expect(view.motionState().some((entry:any)=>entry.id===9)).toBe(false);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');

    // tick 4: a new instance C is created while B keeps moving.
    step(view,snapshot(4,4,[bAt(102),cAt(true)]),4);
    const cRoot=view.root.getObjectByName('hero-11');
    expect(cRoot).toBeDefined();
    expect(cRoot).not.toBe(bRoot);
    expect(cRoot!.getObjectByName('Root')).not.toBe(bRoot!.getObjectByName('Root'));
    expect(view.inspect().heroes.find((hero:any)=>hero.id===11)?.action).toBe('idle');
    expect(view.motionState().find((entry:any)=>entry.id===11)!.actions.map((action:any)=>action.clip).sort()).toEqual(['idle.lower','idle.upper']);
    const bSkeletons:any[]=[],cSkeletons:any[]=[];
    bRoot!.traverse((node:any)=>{if(node.isSkinnedMesh)bSkeletons.push(node.skeleton);});
    cRoot!.traverse((node:any)=>{if(node.isSkinnedMesh)cSkeletons.push(node.skeleton);});
    expect(bSkeletons[0]).not.toBe(cSkeletons[0]);
    expect(bSkeletons[0]!.bones[0]).not.toBe(cSkeletons[0]!.bones[0]);
    expect(new Set([...bSkeletons[0]!.bones,...cSkeletons[0]!.bones]).size).toBe(bSkeletons[0]!.bones.length+cSkeletons[0]!.bones.length);
    expect(aRoot!.getObjectByName('Root')).not.toBe(cRoot!.getObjectByName('Root'));

    // tick 5-6: C dies while B moves; C has no effect on B's pose or actions.
    step(view,snapshot(5,5,[bAt(104),cAt(false)]),5);
    step(view,snapshot(6,6,[bAt(106),cAt(false)]),6);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===11)?.action).toBe('death');
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');
    expect(view.motionState().find((entry:any)=>entry.id===11)!.actions.map((action:any)=>action.clip)).toEqual(['death.full']);
    expect(cRoot!.getObjectByName('Root')!.position.y).toBeCloseTo(0.733078,4);

    // Reference presentation: only B on the same timeline. Its final pose and
    // actions must be bit-identical, proving no bone/action state crossed from
    // A's death or C's creation/death.
    for(let tick=1;tick<=6;tick+=1)step(reference,snapshot(tick,tick,[bAt(94+2*tick)]),tick);
    expect(poseDelta(boneWorld(view.root.getObjectByName('hero-10')),boneWorld(reference.root.getObjectByName('hero-10')))).toBeLessThan(1e-9);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>`${action.clip}:${action.weight}:${action.time}`))
      .toEqual(reference.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>`${action.clip}:${action.weight}:${action.time}`));

    view.dispose();reference.dispose();
    expect(sourceDisposals).toBe(0);
  });
});
