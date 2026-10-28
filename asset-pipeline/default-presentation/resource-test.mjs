import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Group,Mesh,BufferGeometry,BufferAttribute,MeshBasicMaterial,AnimationMixer,Vector3,Skeleton} from 'three';
import {loadCharacterAssets,disposeCharacterAssets,createPresentation} from './adapter.js';
import {resourceInventory,assertResourceBudget} from './resources.js';
import {getContent} from '../../src/content/catalog.ts';
import {Simulation} from '../../src/sim/simulation.ts';

test('unique backing memory is not multiplied by overlapping views or repeated roots',()=>{
  const buffer=new ArrayBuffer(128),geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(buffer,0,12),3));
  geometry.setAttribute('normal',new BufferAttribute(new Float32Array(buffer,0,12),3));
  const root=new Group(),material=new MeshBasicMaterial();root.add(new Mesh(geometry,material),new Mesh(geometry,material));
  const inventory=resourceInventory({roots:[root,root.children[0]]});
  assert.equal(inventory.geometries,1);assert.equal(inventory.materials,1);assert.equal(inventory.typedArrayViewBytes,96);assert.equal(inventory.typedArrayBackingBytes,128);
  assert.equal(inventory.nodes,3);geometry.dispose();material.dispose();
});

test('explicit budgets reject overflow and invalid policy rather than silently pass',()=>{
  const inventory=resourceInventory();assert.equal(assertResourceBudget(inventory,{geometries:0}),inventory);
  for(const limits of [{},null,{geometries:-1},{geometries:NaN},{geometries:1.5},{gpuBytes:100}])assert.throws(()=>assertResourceBudget(inventory,limits));
  assert.throws(()=>assertResourceBudget({...inventory,geometries:2},{geometries:1}),/exceeded/);
});

test('real GLB multi-view sharing retains buffers once and releases only instance resources until final owner',async()=>{
  const assets=await loadCharacterAssets(async url=>{const bytes=await readFile(new URL(url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
  const clips=Object.values(assets).flatMap(asset=>asset.animations),roots=Object.values(assets).map(asset=>asset.scene);
  const source=resourceInventory({roots,clips});
  const navigation={closestPoint:p=>({...p}),findPath:(a,b)=>({success:true,points:[{...a},{...b}],reason:null})};
  const sim=new Simulation({seed:7,contentVersion:2,navigation,heroesPerTeam:3});
  const first=createPresentation({catalog:getContent(2),assets}),second=createPresentation({catalog:getContent(2),assets});
  let sourceGeometryDisposed=0,instanceMaterialDisposed=0;const sourceGeometries=new Set();
  for(const root of roots)root.traverse(node=>{if(node.geometry)sourceGeometries.add(node.geometry);});
  for(const geometry of sourceGeometries)geometry.addEventListener('dispose',()=>sourceGeometryDisposed++);
  try{
    first.sync(sim.snapshot());second.sync(sim.snapshot());
    const heroRoots=()=>[...first.root.children,...second.root.children].filter(node=>node.name.startsWith('hero-'));
    const one=resourceInventory({roots:[...roots,...heroRoots().slice(0,6)],clips});
    const both=resourceInventory({roots:[...roots,...heroRoots()],clips});
    assert.equal(heroRoots().length,12);assert.equal(both.geometries,source.geometries);assert.equal(both.clips,source.clips);
    assert.equal(both.skeletons-source.skeletons,12);assert.equal(both.bones-source.bones,12*15);
    // Each clone owns 15 bone matrices of 16 Float32 elements; geometry/clip buffers do not grow.
    assert.equal(one.typedArrayBackingBytes-source.typedArrayBackingBytes,6*15*16*4);
    assert.equal(both.typedArrayBackingBytes-one.typedArrayBackingBytes,6*15*16*4);
    assertResourceBudget(both,{geometries:source.geometries,typedArrayBackingBytes:source.typedArrayBackingBytes+12*15*16*4});
    assert.throws(()=>assertResourceBudget(both,{typedArrayBackingBytes:source.typedArrayBackingBytes}),/exceeded/);
    // Match every skinned vertex against unoptimized SkeletonUtils clones,
    // across all source clips. Per-mesh bind matrices stay untouched.
    for(const [team,key] of [[0,'blue'],[1,'amber']]){
      const hero=sim.snapshot().heroes.find(hero=>hero.team===team);
      const optimized=first.root.getObjectByName(`hero-${hero.id}`),baseline=clone(assets[key].scene);
      baseline.position.copy(optimized.position);baseline.quaternion.copy(optimized.quaternion);baseline.scale.copy(optimized.scale);
      const left=[],right=[];optimized.traverse(node=>{if(node.isSkinnedMesh)left.push(node);});baseline.traverse(node=>{if(node.isSkinnedMesh)right.push(node);});
      const a=new AnimationMixer(optimized),b=new AnimationMixer(baseline);
      for(const clip of assets[key].animations){
        a.stopAllAction();b.stopAllAction();a.clipAction(clip).reset().play();b.clipAction(clip).reset().play();
        for(const time of [0,.37,.73]){
          a.setTime(time);b.setTime(time);optimized.updateMatrixWorld(true);baseline.updateMatrixWorld(true);
          for(let m=0;m<left.length;m++){
            assert.ok(left[m].bindMatrix.equals(right[m].bindMatrix));assert.ok(left[m].bindMatrixInverse.equals(right[m].bindMatrixInverse));
            const position=left[m].geometry.attributes.position;
            for(let i=0;i<position.count;i++){
              const p=left[m].applyBoneTransform(i,new Vector3().fromBufferAttribute(position,i)).applyMatrix4(left[m].matrixWorld);
              const q=right[m].applyBoneTransform(i,new Vector3().fromBufferAttribute(position,i)).applyMatrix4(right[m].matrixWorld);
              assert.ok(p.distanceTo(q)<1e-7,`${key}/${clip.name}/${m}/${i} changed`);
            }
          }
        }
      }
      a.stopAllAction();a.uncacheRoot(optimized);b.stopAllAction();b.uncacheRoot(baseline);
      for(const skeleton of new Set(right.map(mesh=>mesh.skeleton)))skeleton.dispose();
    }
    const instanceMaterials=new Set();first.root.traverse(node=>{for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])instanceMaterials.add(material);});
    for(const material of instanceMaterials)material.addEventListener('dispose',()=>instanceMaterialDisposed++);
    first.dispose();assert.equal(instanceMaterialDisposed,instanceMaterials.size);assert.equal(sourceGeometryDisposed,0);
    second.advance(.1);assert.equal(second.inspect().heroes.length,6);second.dispose();assert.equal(sourceGeometryDisposed,0);
    console.log(JSON.stringify({source,oneView:one,twoViews:both,scope:'CPU referenced typed arrays; not JS heap or GPU memory'}));
  }finally{first.dispose();second.dispose();disposeCharacterAssets(assets);}
  assert.equal(sourceGeometryDisposed,sourceGeometries.size);
});


test('same bone count is insufficient: different inverse binds and material parameters remain separate',async()=>{
  const assets=await loadCharacterAssets(async url=>{const bytes=await readFile(new URL(url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
  let view;
  try{
    const meshes=[];assets.blue.scene.traverse(node=>{if(node.isSkinnedMesh)meshes.push(node);});
    const original=meshes[0].skeleton,inverses=original.boneInverses.map(matrix=>matrix.clone());inverses[0].elements[12]+=.125;
    meshes[0].skeleton=new Skeleton(original.bones,inverses);
    meshes[0].material=meshes[0].material.clone();meshes[0].material.color.set('#a100e3');
    const navigation={closestPoint:p=>({...p}),findPath:(a,b)=>({success:true,points:[{...a},{...b}],reason:null})};
    const sim=new Simulation({seed:9,contentVersion:2,navigation,heroesPerTeam:1});
    view=createPresentation({catalog:getContent(2),assets});view.sync(sim.snapshot());
    const actor=view.root.getObjectByName(`hero-${sim.snapshot().heroes.find(h=>h.team===0).id}`),clones=[];
    actor.traverse(node=>{if(node.isSkinnedMesh)clones.push(node);});
    assert.notEqual(clones[0].skeleton,clones[1].skeleton);
    assert.deepEqual(clones[0].skeleton.bones,clones[1].skeleton.bones);
    assert.equal(new Set(clones.map(mesh=>mesh.skeleton)).size,2);
    assert.ok(clones[0].material.color.equals(meshes[0].material.color));assert.notEqual(clones[0].material,clones[1].material);
    assert.ok(clones[0].bindMatrix.equals(meshes[0].bindMatrix));
  }finally{view?.dispose();disposeCharacterAssets(assets);}
});
