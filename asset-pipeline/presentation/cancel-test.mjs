import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial} from 'three';
import {loadCharacterAssets,disposeCharacterAssets} from './adapter.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function source(){const scene=new Group(),geometry=new BoxGeometry(),material=new MeshBasicMaterial();let freed=0;geometry.addEventListener('dispose',()=>freed++);material.addEventListener('dispose',()=>freed++);scene.add(new Mesh(geometry,material));return {asset:{scene,animations:[{name:'idle'},{name:'walk'}]},freed:()=>freed};}

test('pre-aborted request never calls the transport',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(loadCharacterAssets(()=>{calls++;},{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});

test('mid-load cancellation rejects promptly, frees partial assets, and later arrivals once',async()=>{
  const controller=new AbortController(),first=source(),second=source(),later=deferred();let calls=0;
  const pending=loadCharacterAssets(()=>++calls===1?first.asset:later.promise,{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await setImmediate();assert.equal(calls,2);assert.equal(first.freed(),0);
  controller.abort();await rejected;assert.equal(first.freed(),2);assert.equal(second.freed(),0);
  later.resolve(second.asset);await setImmediate();assert.equal(first.freed(),2);assert.equal(second.freed(),2);
});

test('cancel with a permanently pending transport still returns; a late rejection is handled',async()=>{
  const controller=new AbortController(),later=deferred();let calls=0;
  const pending=loadCharacterAssets(()=>++calls===1?new Promise(()=>{}):later.promise,{signal:controller.signal});
  const rejected=assert.rejects(pending,/leave scene/);await setImmediate();controller.abort(new Error('leave scene'));await rejected;
  later.reject(new Error('transport failed after cancel'));await setImmediate();
});

test('abort after success cannot revoke transferred ownership',async()=>{
  const controller=new AbortController(),first=source(),second=source();let calls=0;
  const assets=await loadCharacterAssets(()=>++calls===1?first.asset:second.asset,{signal:controller.signal});
  controller.abort();assert.equal(first.freed(),0);assert.equal(second.freed(),0);
  disposeCharacterAssets(assets);assert.equal(first.freed(),2);assert.equal(second.freed(),2);
});


test('resources shared by two results of the same cancelled request are not disposed twice',async()=>{
  const controller=new AbortController(),shared=source(),later=deferred();let calls=0;
  const pending=loadCharacterAssets(()=>++calls===1?shared.asset:later.promise,{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});await setImmediate();controller.abort();await rejected;
  assert.equal(shared.freed(),2);later.resolve(shared.asset);await setImmediate();assert.equal(shared.freed(),2);
});
