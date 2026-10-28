import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadBattleAssets,siegeAssetManifest,type BattleAssets} from '../../src/render/battle-assets.js';
import {battleAssetId,createBattlefield} from '../../src/render/battlefield.js';
import {getContent} from '../../src/content/catalog.js';
import type {PresentationEvent,Snapshot} from '../../src/sim/types.js';
import {makeSim} from '../helpers.js';

let loaded:BattleAssets,base:Snapshot,siegeId:number,targetId:number;
beforeAll(async()=>{
  const {PNG}=createRequire(import.meta.url)('pngjs');
  const loader=new GLTFLoader().register(parser=>({name:'CPU_actual_PNG',async loadTexture(index:number){
    const texture=parser.json.textures[index],image=parser.json.images[texture.source];
    const bytes=await parser.getDependency('bufferView',image.bufferView),png=PNG.sync.read(Buffer.from(bytes));
    const value=new THREE.DataTexture(new Uint8Array(png.data),png.width,png.height);value.flipY=false;value.needsUpdate=true;return value;
  }}));
  loaded=await loadBattleAssets(async url=>{
    const path=url.split('?')[0]!,bytes=await readFile(new URL(`../../${path.startsWith('/')?path.slice(1):path}`,import.meta.url));
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  });
  const sim=await makeSim(11,61);
  while(!sim.snapshot().entities.some(e=>e.kind==='minion'&&e.minionKind==='siege')&&sim.state.tick<2000)sim.step([]);
  const snapshot=sim.snapshot();siegeId=snapshot.entities.find(e=>e.team===0&&e.minionKind==='siege')!.id;
  targetId=snapshot.entities.find(e=>e.team===1&&e.kind==='minion')!.id;
  base={...snapshot,events:[],entities:snapshot.entities.map(e=>e.id===siegeId?{...e,position:{x:0,z:0}}:e.id===targetId?{...e,position:{x:4,z:0}}:e)};
});
afterAll(()=>loaded?.dispose());
function frame(offset:number,events:PresentationEvent[]=[],x=0):Snapshot{
  return {...base,tick:base.tick+offset,timeSeconds:base.timeSeconds+offset/30,
    entities:base.entities.map(e=>e.id===siegeId?{...e,position:{x,z:0}}:e),events};
}
function phase(type:'castStarted'|'castResolved',offset:number,castId=201):PresentationEvent{
  return {type,action:'basicAttack',tick:base.tick+offset,ordinal:0,heroId:siegeId,castId,abilityId:'basicAttack',slot:null,targetId,windupTicks:9};
}
function expectedPose(clipName:string,time:number,boneName='Arm'){
  const model=loaded.models['siege-teal']!,scene=clone(model.scene),mixer=new THREE.AnimationMixer(scene);
  const action=mixer.clipAction(model.animations.find(c=>c.name===clipName)!);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(time);
  const pose=scene.getObjectByName(boneName)!.quaternion.clone().normalize();mixer.stopAllAction();mixer.uncacheRoot(scene);return pose;
}

function triangles(root:THREE.Object3D){
  root.updateMatrixWorld(true);const result:THREE.Triangle[]=[];
  root.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
    mesh.skeleton.update();const index=mesh.geometry.index!;
    const vertices=Array.from({length:mesh.geometry.attributes['position']!.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    for(let i=0;i<index.count;i+=3)result.push(new THREE.Triangle(vertices[index.getX(i)]!,vertices[index.getX(i+1)]!,vertices[index.getX(i+2)]!));
  });return result;
}
function triangleIntersections(a:THREE.Triangle[],b:THREE.Triangle[]){
  const boxes=b.map(t=>new THREE.Box3().setFromPoints([t.a,t.b,t.c]));let count=0;
  function segments(a:THREE.Triangle,b:THREE.Triangle){
    for(const [p,q] of [[a.a,a.b],[a.b,a.c],[a.c,a.a]] as const){
      const direction=q.clone().sub(p),length=direction.length();if(length<1e-6)continue;
      const hit=new THREE.Ray(p,direction.divideScalar(length)).intersectTriangle(b.a,b.b,b.c,false,new THREE.Vector3());
      if(hit&&hit.distanceTo(p)>1e-6&&hit.distanceTo(p)<length-1e-6)count++;
    }
  }
  for(const triangle of a){const box=new THREE.Box3().setFromPoints([triangle.a,triangle.b,triangle.c]);
    for(let i=0;i<b.length;i++)if(box.intersectsBox(boxes[i]!)){segments(triangle,b[i]!);segments(b[i]!,triangle);}
  }return count;
}

describe('independent wheeled siege presentation',()=>{
  it('loads both real PNG/GLB variants, scales once and keeps gameplay snapshot unchanged',()=>{
    expect(Object.keys(loaded.models)).toHaveLength(19);
    const before=JSON.stringify(base),field=createBattlefield(getContent(11),loaded);field.sync(base);field.advance(0,1);
    for(const entity of base.entities.filter(e=>e.minionKind==='siege')){
      expect(battleAssetId(entity)).toBe(`siege-${entity.team===0?'teal':'rust'}`);
      const root=field.root.getObjectByName(`entity-${entity.id}`)!;
      expect(root.scale.toArray()).toEqual([1,1,1]);expect(root.userData['visualHeight']).toBe(1.85);
      const parts:THREE.SkinnedMesh[]=[];root.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)parts.push(o as THREE.SkinnedMesh);});
      expect(parts).toHaveLength(3);expect(new Set(parts.map(p=>p.skeleton)).size).toBe(1);
      expect(parts[0]!.skeleton.bones).toHaveLength(6);expect(entity.radius).toBe(.7);
    }
    expect(JSON.stringify(base)).toBe(before);field.dispose();
  });

  it('samples only the authoritative preparation, release and recovery phases',()=>{
    const field=createBattlefield(getContent(11),loaded);field.sync(base);
    field.sync(frame(1,[phase('castStarted',1)]));field.advance(1/30,1);
    field.sync(frame(5));field.advance(4/30,1);
    const arm=field.root.getObjectByName(`entity-${siegeId}`)!.getObjectByName('Arm')!;
    expect(arm.quaternion.clone().normalize().angleTo(expectedPose('attack_prepare',(13/30)*(4/9)))).toBeLessThan(1e-5);
    field.sync(frame(10,[phase('castResolved',10)]));field.advance(5/30,1);
    expect(arm.quaternion.clone().normalize().angleTo(expectedPose('attack_release',0))).toBeLessThan(1e-5);
    field.sync(frame(13));field.advance(3/30,1);
    expect(arm.quaternion.clone().normalize().angleTo(expectedPose('attack_release',.1))).toBeLessThan(1e-5);
    field.sync(frame(19));field.advance(6/30,1);
    expect(arm.quaternion.clone().normalize().angleTo(expectedPose('attack_recover',.3-5/30))).toBeLessThan(1e-5);
    field.sync(frame(35));field.advance(16/30,1);
    expect(arm.quaternion.clone().normalize().angleTo(expectedPose('idle',0))).toBeLessThan(1e-5);field.dispose();
  });

  it('cancelled and terminal preparations never advance to release',()=>{
    for(const terminal of [false,true]){
      const field=createBattlefield(getContent(11),loaded);field.sync(base);
      field.sync(frame(1,[phase('castStarted',1)]));field.advance(1/30,1);
      const next=frame(4,terminal?[]:[{type:'castCancelled',action:'basicAttack',tick:base.tick+4,ordinal:0,castId:201,heroId:siegeId,abilityId:'basicAttack',slot:null,targetId,reason:'move'}]);
      field.sync(terminal?{...next,status:'timeout'}:next);field.advance(.5,1);
      const arm=field.root.getObjectByName(`entity-${siegeId}`)!.getObjectByName('Arm')!;
      expect(arm.quaternion.clone().normalize().angleTo(expectedPose('idle',0))).toBeLessThan(1e-5);
      field.advance(1,1);expect(arm.quaternion.clone().normalize().angleTo(expectedPose('idle',0))).toBeLessThan(1e-5);field.dispose();
    }
  });

  it('calibrates only wheel walking speed; old-version attack stays release-first at normal time',()=>{
    const field=createBattlefield(getContent(10),loaded);field.sync(base);
    field.sync(frame(1,[],.12));field.advance(1/30,1);
    const root=field.root.getObjectByName(`entity-${siegeId}`)!;
    const expectedTime=(1/30)*3.6/siegeAssetManifest.assets[0]!.nominalWalkSpeed;
    expect(root.getObjectByName('Wheel_L')!.quaternion.clone().normalize().angleTo(expectedPose('walk',expectedTime,'Wheel_L'))).toBeLessThan(1e-5);
    field.sync(frame(2,[{type:'basicAttack',tick:base.tick+2,ordinal:0,sourceId:siegeId,targetId}],.12));field.advance(.1,1);
    expect(root.getObjectByName('Arm')!.quaternion.clone().normalize().angleTo(expectedPose('attack',.1))).toBeLessThan(1e-5);
    expect(root.getObjectByName('Wheel_L')!.quaternion.clone().normalize().angleTo(expectedPose('idle',0,'Wheel_L'))).toBeLessThan(1e-5);field.dispose();
  });

  it('keeps v11 wheel distance continuous through stationary, cancelled and terminal preparation',()=>{
    const field=createBattlefield(getContent(11),loaded);field.sync(base);field.advance(0,1);
    const wheel=field.root.getObjectByName(`entity-${siegeId}`)!.getObjectByName('Wheel_L')!;
    field.sync(frame(1,[],.12));field.advance(1/30,1);const moved=wheel.quaternion.clone().normalize();
    field.sync(frame(2,[phase('castStarted',2)],.12));field.advance(1/30,1);
    expect(wheel.quaternion.clone().normalize().angleTo(moved)).toBeLessThan(1e-6);
    const cancelled={type:'castCancelled',action:'basicAttack',tick:base.tick+3,ordinal:0,castId:201,heroId:siegeId,abilityId:'basicAttack',slot:null,targetId,reason:'move'} as PresentationEvent;
    field.sync(frame(3,[cancelled],.24));field.advance(1/30,.5);
    const half=wheel.quaternion.clone().normalize();field.advance(5,.5);
    expect(wheel.quaternion.clone().normalize().angleTo(half)).toBeLessThan(1e-6);
    field.advance(1/60,1);
    expect(wheel.quaternion.clone().normalize().angleTo(expectedPose('walk',.24/siegeAssetManifest.assets[0]!.nominalWalkSpeed,'Wheel_L'))).toBeLessThan(1e-5);
    field.sync({...frame(4,[phase('castStarted',4)],.24),status:'timeout'});field.advance(1,1);
    const terminal=wheel.quaternion.clone().normalize();field.advance(5,1);
    expect(wheel.quaternion.clone().normalize().angleTo(terminal)).toBeLessThan(1e-6);field.dispose();
  });

  it('real v11 seed61 rolls during recovery and its shortened chassis clears the separated melee',async()=>{
    const sim=await makeSim(11,61),field=createBattlefield(sim.catalog,loaded);
    const samples:Array<{position:THREE.Vector3;wheel:THREE.Quaternion;arm:THREE.Quaternion}>=[];
    let resolvedAt:number|undefined;
    for(let tick=1;tick<=3030;tick++){
      sim.step([]);const snapshot=sim.snapshot();field.sync(snapshot);field.advance(1/30,1);
      if(tick===2394){expect(snapshot.events.some(e=>e.type==='castResolved'&&e.heroId===36)).toBe(true);resolvedAt=snapshot.timeSeconds;}
      if(tick===2410||tick===2411){const root=field.root.getObjectByName('entity-36')!;
        samples.push({position:root.position.clone(),wheel:root.getObjectByName('Wheel_L')!.quaternion.clone().normalize(),arm:root.getObjectByName('Arm')!.quaternion.clone().normalize()});
        expect(samples.at(-1)!.arm.angleTo(expectedPose('attack_recover',snapshot.timeSeconds-resolvedAt!-5/30))).toBeLessThan(1e-5);
      }
    }
    const [a,b]=samples;expect(a!.position.distanceTo(b!.position)).toBeCloseTo(.12,6);
    expect(a!.wheel.angleTo(b!.wheel)).toBeCloseTo(.12/siegeAssetManifest.assets[0]!.wheelRadius,5);
    expect(a!.arm.angleTo(b!.arm)).toBeGreaterThan(.07);
    const snapshot=sim.snapshot(),siege=snapshot.entities.find(e=>e.id===36)!,melee=snapshot.entities.find(e=>e.id===43)!;
    expect(Math.hypot(siege.position.x-melee.position.x,siege.position.z-melee.position.z)-siege.radius-melee.radius).toBeGreaterThan(.004);
    expect(triangleIntersections(triangles(field.root.getObjectByName('entity-36')!),triangles(field.root.getObjectByName('entity-43')!))).toBe(0);
    field.dispose();
  });

  it('uses the actual death event, drops picking immediately and releases the bounded corpse once',()=>{
    const field=createBattlefield(getContent(11),loaded);field.sync(base);
    const root=field.root.getObjectByName(`entity-${siegeId}`)!,skeletons=new Set<THREE.Skeleton>();
    root.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});
    const releases=[...skeletons].map(s=>vi.spyOn(s,'dispose'));
    const dead={...frame(1,[{type:'minionDied',tick:base.tick+1,ordinal:0,entityId:siegeId,team:0,position:{x:0,z:0}}]),entities:base.entities.filter(e=>e.id!==siegeId)};
    const before=JSON.stringify(dead);field.sync(dead);field.sync(dead);field.advance(.5,1);
    expect(root.userData['simEntityId']).toBeUndefined();expect(root.parent).toBe(field.root);
    expect(root.getObjectByName('Arm')!.quaternion.clone().normalize().angleTo(expectedPose('death',.5))).toBeLessThan(1e-5);
    field.advance(.66,1);expect(root.parent).toBeNull();field.dispose();expect(releases.every(spy=>spy.mock.calls.length===1)).toBe(true);
    expect(JSON.stringify(dead)).toBe(before);
  });

  it('releases every successful download if either added GLB fails',async()=>{
    const disposals:Array<ReturnType<typeof vi.fn>>=[];
    await expect(loadBattleAssets(async url=>{
      if(url.includes('siege-rust'))throw new Error('source unavailable');
      const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),scene=new THREE.Group();
      disposals.push(vi.spyOn(geometry,'dispose'),vi.spyOn(material,'dispose'));scene.add(new THREE.Mesh(geometry,material));
      return {scene,scenes:[scene],animations:[],cameras:[],asset:{version:'2.0'},parser:null,userData:{}} as unknown as GLTF;
    })).rejects.toThrow('source unavailable');
    expect(disposals).toHaveLength(36);expect(disposals.every(spy=>spy.mock.calls.length===1)).toBe(true);
  });
});
