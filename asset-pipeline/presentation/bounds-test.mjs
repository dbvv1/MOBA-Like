import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadCharacterAssets,disposeCharacterAssets,createPresentation} from './adapter.js';
import {Simulation} from '../../src/sim/simulation.ts';
import {getContent} from '../../src/content/catalog.ts';

test('real idle-to-walk stale bounds fail an actual camera frustum, while clone policy and posed picking remain valid',async()=>{
 const assets=await loadCharacterAssets(async url=>{const bytes=await readFile(new URL(url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');});
 const navigation={closestPoint:p=>({...p}),findPath:(a,b)=>({success:true,points:[{...a},{...b}],reason:null})};
 const sim=new Simulation({seed:7,contentVersion:2,navigation,heroesPerTeam:1}),view=createPresentation({catalog:getContent(2),assets});
 try{
  view.sync(sim.snapshot());view.advance(.03);
  const cached=new Map();view.root.traverse(node=>{if(node.isSkinnedMesh){node.computeBoundingSphere();node.computeBoundingBox();cached.set(node,node.boundingSphere.clone());assert.equal(node.frustumCulled,false);}});
  const commands=sim.snapshot().heroes.map(hero=>({type:'move',heroId:hero.id,point:{x:hero.position.x,z:hero.position.z+3}}));
  sim.step(commands);view.sync(sim.snapshot());view.advance(.2933333396911621);
  for(const hero of sim.snapshot().heroes){
   const actor=view.root.getObjectByName(`hero-${hero.id}`);let worst;
   actor.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const position=mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++){const point=mesh.getVertexPosition(i,new THREE.Vector3()),gap=point.distanceTo(cached.get(mesh).center)-cached.get(mesh).radius;if(gap>(worst?.gap??0))worst={mesh,point,gap};}
   });
   assert.ok(worst.gap>.1,'fixture must genuinely escape cached idle bounds');
   const {mesh}=worst,point=worst.point.clone().applyMatrix4(mesh.matrixWorld),sphere=cached.get(mesh).clone().applyMatrix4(mesh.matrixWorld),normal=point.clone().sub(sphere.center).normalize();
   const camera=new THREE.OrthographicCamera(-.01,.01,.01,-.01,5-worst.gap*.2,5+worst.gap*.2);
   camera.position.copy(point).addScaledVector(normal,5);if(Math.abs(normal.y)>.95)camera.up.set(1,0,0);camera.lookAt(point);camera.updateMatrixWorld(true);
   const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
   assert.ok(frustum.containsPoint(point));assert.equal(frustum.intersectsObject(mesh),false,'stale sphere would wrongly cull the visible posed point');
   assert.ok(!mesh.frustumCulled||frustum.intersectsObject(mesh),'renderer eligibility bypasses only this unsafe cull');
   const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);const hits=ray.intersectObject(mesh,false);assert.ok(hits.length>0,'real Raycaster must hit the posed mesh');
   for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    const vertex=mesh.getVertexPosition(i,new THREE.Vector3());assert.ok(mesh.boundingBox.containsPoint(vertex));assert.ok(vertex.distanceTo(mesh.boundingSphere.center)<=mesh.boundingSphere.radius+1e-8);
   }
   // Compare all actual ray intersections with stock Three using the same freshly posed bounds.
   const expected=[];THREE.SkinnedMesh.prototype.raycast.call(mesh,ray,expected);assert.deepEqual(hits.map(hit=>hit.distance),expected.map(hit=>hit.distance).sort((a,b)=>a-b));
  }
  for(const asset of Object.values(assets))asset.scene.traverse(node=>{if(node.isSkinnedMesh)assert.equal(node.frustumCulled,true,'source policy must not be mutated');});
  assert.equal(view.root.getObjectByName('map-bounds').frustumCulled,true);
 }finally{view.dispose();disposeCharacterAssets(assets);}
});
