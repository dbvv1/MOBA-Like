import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {Vector3,Group} from 'three';
import {Simulation} from '../../src/sim/simulation.ts';
import {FixedClock} from '../../src/render/clock.ts';
import {createPresentation,loadCharacterAssets} from './adapter.js';
import {createMotionState,attackSample} from './motion-state.js';
import {createMotion} from './motion.js';
const navigation={closestPoint:p=>({...p}),findPath:(a,b)=>({success:true,points:[a,b],reason:null})};
const assets=await loadCharacterAssets(async url=>{const b=await readFile(new URL(url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');});
const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1}),first=sim.snapshot(),hero=first.heroes[0],catalog=sim.catalog;
const abilityId=catalog.heroes[hero.definitionId].abilities.Q;
const start={type:'castStarted',tick:1,ordinal:0,heroId:hero.id,abilityId,slot:'Q',castId:42};

test('current-step event cursor deduplicates and distinguishes resolve from hit, shield from hp damage',()=>{
  const state=createMotionState(hero.id,catalog);state.consume([start],0,true);
  state.consume([start],10,true);assert.equal(state.inspect().attack.startedAt,0);
  assert.equal(attackSample(2,state.inspect().attack).time,13/30,'unresolved casting holds anticipation, does not predict a release');
  state.consume([{...start,type:'castResolved',tick:2,ordinal:0}],.2,true);
  assert.equal(state.inspect().attack.resolvedAt,.2);assert.equal(state.inspect().hurtAt,null);
  state.consume([{type:'heroDamaged',tick:2,ordinal:1,targetId:hero.id,sourceId:999,hpDamage:0,shieldAbsorbed:50,abilityId:null}],.2,true);
  assert.equal(state.inspect().hurtAt,null);
  state.consume([{type:'heroDamaged',tick:3,ordinal:0,targetId:hero.id,sourceId:999,hpDamage:1,shieldAbsorbed:0,abilityId:null}],.3,true);
  assert.equal(state.inspect().hurtAt,.3);
  const copy=state.inspect();copy.attack.startedAt=999;assert.equal(state.inspect().attack.startedAt,0);
  state.consume([],1,false);assert.deepEqual(state.inspect(),{attack:null,hurtAt:null});state.reset();state.consume([start],2,true);assert.equal(state.inspect().attack.startedAt,2);
});

test('same-tick start/cancel never releases; committed basic attack has no invented windup or hit',()=>{
  const state=createMotionState(hero.id,catalog);
  state.consume([start,{...start,type:'castCancelled',ordinal:1,reason:'stunned'}],0,true);
  assert.equal(attackSample(1,state.inspect().attack).weight,0);assert.equal(state.inspect().attack.resolvedAt,null);
  state.consume([{type:'basicAttack',tick:2,ordinal:0,sourceId:hero.id,targetId:999}],.2,true);
  assert.equal(state.inspect().attack.resolvedAt,.2);assert.equal(state.inspect().attack.windup,0);assert.equal(state.inspect().hurtAt,null);
  state.consume([{...start,type:'castCancelled',tick:3,ordinal:0,reason:'stunned'}],.3,true);
  assert.equal(state.inspect().attack.cancelledAt,null,'old cast cancellation cannot cancel a newer basic swing');
});

test('real simulation cast and tower hp-damage events drive the actual presentation without state writes',()=>{
  const real=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1});const snapshot=real.snapshot(),id=snapshot.heroes[0].id;
  const view=createPresentation({catalog:real.catalog,assets});const holder=new Group();holder.add(view.root);view.sync(snapshot);
  real.step([{type:'cast',heroId:id,slot:'Q',targetId:null,direction:{x:1,z:0},point:null}]);
  const cast=real.snapshot();assert.ok(cast.events.some(e=>e.type==='castStarted'&&e.heroId===id));view.sync(cast);view.advance(.04);assert.equal(view.inspect().heroes.find(h=>h.id===id).action,'attack');const diagnostic=view.motionState();assert.ok(diagnostic[0].attached);assert.ok(diagnostic[0].actions.some(a=>a.clip==='attack.upper'&&a.weight>0&&a.tracks===24));diagnostic[0].actions[0].weight=999;assert.ok(view.motionState()[0].actions.every(a=>a.weight<=1));holder.remove(view.root);assert.equal(view.motionState()[0].attached,false);holder.add(view.root);
  const tower=snapshot.entities.find(e=>e.team!==snapshot.heroes[0].team&&e.structureKind==='tower');let damaged=false,basic=false;
  for(let i=0;i<4000;i++){
    real.step(i===5?[{type:'attack',heroId:id,targetId:tower.id}]:[]);
    const next=real.snapshot();view.sync(next);const before=JSON.stringify(next);view.advance(1/30);assert.equal(JSON.stringify(real.snapshot()),before);
    if(next.events.some(e=>e.type==='basicAttack'&&e.sourceId===id))basic=true;
    if(next.heroes[0].alive&&next.events.some(e=>e.type==='heroDamaged'&&e.targetId===id&&e.hpDamage>0)){damaged=true;assert.equal(view.inspect().heroes.find(h=>h.id===id).action,'hurt');}
    if(damaged&&basic)break;
  }
  assert.ok(damaged,'real hp loss event observed');assert.ok(basic,'real hero basic swing observed');view.dispose();
});

test('second requirement: upper hurt preserves walking legs; full-body option and phase edit reuse the same source',()=>{
  const roots=[clone(assets.blue.scene),clone(assets.blue.scene),clone(assets.blue.scene)];
  const motions=[createMotion(roots[0],assets.blue),createMotion(roots[1],assets.blue,{hurtRegion:'full'}),createMotion(roots[2],assets.blue)];
  for(const motion of motions){motion.play('walk');motion.advance(.42);}
  const attack={startedAt:0,windup:.2,resolvedAt:.2,cancelledAt:null};
  motions[0].sample({time:.3,hurtAt:.2,attack});motions[1].sample({time:.3,hurtAt:.2,attack});motions[2].sample({time:.3});
  for(const name of ['Thigh_L','Shin_L','Foot_L','Thigh_R','Shin_R','Foot_R'])assert.deepEqual(roots[0].getObjectByName(name).quaternion.toArray(),roots[2].getObjectByName(name).quaternion.toArray());
  assert.notDeepEqual(roots[1].getObjectByName('Thigh_L').quaternion.toArray(),roots[2].getObjectByName('Thigh_L').quaternion.toArray());
  assert.ok(attackSample(.3,attack,{strike:.3,recovery:.567}).time<attackSample(.3,attack).time,'longer strike changes visual phase only');
  for(const motion of motions){motion.sample({time:.4,hurtAt:.2,attack,deathElapsed:.1});assert.equal(motion.action,'death');}
  for(const root of roots)assert.deepEqual(root.position.toArray(),[0,0,0]);
  for(const motion of motions)motion.dispose();
});

test('reaction blends across locomotion phases retain flat-floor contact without moving the actor root',()=>{
  const root=clone(assets.blue.scene),motion=createMotion(root,assets.blue),skins=[];root.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
  for(const phase of [.11,.37,.73])for(const elapsed of [.02,.1,.31,.58]){
    motion.reset();motion.play('walk');motion.advance(phase);motion.sample({time:elapsed,hurtAt:0});
    let low=Infinity;for(const mesh of skins)for(let i=0;i<mesh.geometry.attributes.position.count;i++){const point=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);low=Math.min(low,point.y);}
    assert.ok(low>=-1e-6,`phase ${phase} hurt ${elapsed} below floor ${low}`);assert.deepEqual(root.position.toArray(),[0,0,0]);
  }
  for(const phase of [.11,.37,.73])for(const time of [.1,.25,.5,.8]){motion.reset();motion.play('walk');motion.advance(phase);motion.sample({time,attack:{startedAt:0,windup:.2,resolvedAt:.2,cancelledAt:null}});let low=Infinity;for(const mesh of skins)for(let i=0;i<mesh.geometry.attributes.position.count;i++)low=Math.min(low,mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld).y);assert.ok(low>=-1e-6,`attack phase ${phase}/${time} below floor ${low}`);}
  motion.dispose();assert.throws(()=>createMotion(root,assets.blue,{hurtRegion:'unknown'}),/region/);
});


test('real FixedClock catch-up frames sample a monotonic interpolated animation clock',()=>{
  const real=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1}),view=createPresentation({catalog:real.catalog,assets});
  const clock=new FixedClock(1/real.tickRateHz),id=real.snapshot().heroes[0].id;view.sync(real.snapshot());let sent=false;const times=[];
  for(const delta of [.25,1/60,1/60]){
    const alpha=clock.advance(delta,()=>{real.step(sent?[]:[{type:'cast',heroId:id,slot:'W',targetId:null,direction:{x:0,z:1},point:null}]);sent=true;view.sync(real.snapshot());});
    view.advance(delta,alpha);times.push(view.motionState().find(a=>a.id===id).actions.find(a=>a.clip==='attack.upper').time);
  }
  assert.ok(times.every((time,i)=>i===0||time>=times[i-1]-1e-9),JSON.stringify(times));
  assert.ok(times[1]-times[0]<.02,'render delta is not counted again after all catch-up simulation steps');
  clock.reset();view.advance(0,0);assert.equal(view.motionState().find(a=>a.id===id).actions.find(a=>a.clip==='attack.upper').time,times[2],'visibility accumulator reset cannot rewind a pose');
  view.dispose();
});

test('a resolved cast uses authoritative copied facing even when the actor never moved',()=>{
  const real=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1}),view=createPresentation({catalog:real.catalog,assets});
  const first=real.snapshot(),id=first.heroes[0].id;view.sync(first);const actor=view.root.getObjectByName(`hero-${id}`),initialYaw=actor.rotation.y;
  let resolved=null;
  for(let tick=0;tick<30;tick++){real.step(tick===0?[{type:'cast',heroId:id,slot:'Q',targetId:null,direction:{x:0,z:1},point:null}]:[]);const next=real.snapshot();view.sync(next);view.advance(1/30,.5);if(next.events.some(e=>e.type==='castResolved'&&e.heroId===id)){resolved=next;break;}}
  assert.ok(resolved);const hero=resolved.heroes.find(h=>h.id===id);assert.deepEqual(hero.position,first.heroes[0].position);assert.equal(actor.rotation.y,Math.atan2(hero.facing.x,hero.facing.z));assert.notEqual(actor.rotation.y,initialYaw);view.dispose();
});


test('terminal Q anticipation, resolved W and last-step movement all finish visually without synthetic events',()=>{
  for(const mode of ['Q','W','move']){
    const real=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:1,maxMatchSeconds:.01});
    const view=createPresentation({catalog:real.catalog,assets}),initial=real.snapshot(),hero=initial.heroes[0];view.sync(initial);
    const command=mode==='move'?{type:'move',heroId:hero.id,point:{x:hero.position.x+5,z:hero.position.z}}:{type:'cast',heroId:hero.id,slot:mode,targetId:null,point:null,direction:{x:1,z:0}};
    real.step([command]);const end=real.snapshot();assert.equal(end.status,'timeout');const unchanged=JSON.stringify(end);
    if(mode==='Q'){assert.ok(end.events.some(e=>e.type==='castStarted'));assert.ok(!end.events.some(e=>e.type==='castResolved'));}
    if(mode==='W')assert.ok(end.events.some(e=>e.type==='castResolved'));
    if(mode==='move'||mode==='W')assert.notDeepEqual(end.heroes[0].position,hero.position);
    view.sync(end);view.advance(5);const actor=view.motionState().find(a=>a.id===hero.id);
    assert.ok(actor.actions.every(action=>action.clip.startsWith('idle.')),mode+JSON.stringify(actor.actions));assert.equal(view.inspect().heroes.find(h=>h.id===hero.id).action,'idle');
    assert.equal(JSON.stringify(real.snapshot()),unchanged,'visual finish must not invent gameplay resolve/cancel');view.dispose();
  }
});
