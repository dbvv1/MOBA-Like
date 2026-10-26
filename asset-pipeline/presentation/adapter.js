import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {reuseReactionClips} from './reactions.js';
import {createMotion} from './motion.js';
import {createMotionState} from './motion-state.js';

export const assetUrls = Object.freeze({
  blue: new URL('../characters/beacon-guard/assets/blue-reactions.glb', import.meta.url).href,
  amber: new URL('../placeholder/assets/amber.glb', import.meta.url).href,
});

function assetResources(assets) {
  const resources = new Set();
  for (const asset of Object.values(assets)) asset?.scene?.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.skeleton) resources.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  return resources;
}

export function disposeCharacterAssets(assets) {
  for (const resource of assetResources(assets)) resource.dispose();
}

export async function loadCharacterAssets(load = url => new GLTFLoader().loadAsync(url), {signal} = {}) {
  const abortError = () => signal?.reason ?? new DOMException('Asset loading cancelled', 'AbortError');
  if (signal?.aborted) throw abortError();
  const loaded = new Set(), released = new WeakSet();
  const releaseAssets = assets => { for (const resource of assetResources(assets)) if (!released.has(resource)) { released.add(resource); resource.dispose(); } };
  let cancelled = false, rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const releaseLoaded = () => { const values = [...loaded]; loaded.clear(); releaseAssets(values); };
  const onAbort = () => {
    cancelled = true;
    try { releaseLoaded(); } finally { rejectAbort(abortError()); }
  };
  signal?.addEventListener('abort', onAbort, {once:true});
  const completion = Promise.allSettled([assetUrls.blue, assetUrls.amber].map(url => Promise.resolve().then(() => {
    if (cancelled) throw abortError();
    return load(url);
  }).then(asset => {
    if (cancelled) { releaseAssets([asset]); throw abortError(); }
    loaded.add(asset); return asset;
  }))).then(results => {
    if (cancelled) throw abortError();
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const assets = results.map(result => result.value);
    for (const asset of assets) for (const name of ['idle', 'walk']) {
      if (!asset.animations.some(clip => clip.name === name)) throw new Error(`Missing clip: ${name}`);
    }
    if(assets[0].animations.some(clip=>clip.name==='death'))reuseReactionClips(assets[0],assets[1]);
    return {blue:assets[0], amber:assets[1]};
  }).catch(error => { releaseLoaded(); throw error; }).finally(() => signal?.removeEventListener('abort', onAbort));
  // Cancellation returns promptly even if a transport never settles. Each late
  // successful asset is still disposed above; this does not claim to abort I/O.
  return signal ? Promise.race([completion, aborted]) : completion;
}

function character(asset, motionOptions) {
  const root = clone(asset.scene);
  const materials = new Set();
  const skeletons = new Set();
  const materialClones = new Map();
  function materialClone(source) {
    if (!materialClones.has(source)) materialClones.set(source, source.clone());
    return materialClones.get(source);
  }
  root.traverse(node => {
    if (node.isSkinnedMesh) {
      // Cached idle bounds are not safe for later poses. For this small hero
      // consumer, keep animated skins visible without a per-frame vertex scan.
      node.frustumCulled = false;
      const raycast = node.raycast;
      node.raycast = function (raycaster, hits) {
        // Picking is on demand: refresh a conservative sphere from the posed
        // box in one vertex pass, rather than trusting a prior animation pose.
        this.computeBoundingBox();
        this.boundingSphere ??= new THREE.Sphere();
        this.boundingBox.getBoundingSphere(this.boundingSphere);
        return raycast.call(this, raycaster, hits);
      };
      const candidate = node.skeleton;
      // SkeletonUtils clones per mesh. Reuse only exactly equivalent bindings
      // inside this actor, never across actors or with the source asset.
      const equivalent = [...skeletons].find(skeleton =>
        skeleton.bones.length === candidate.bones.length &&
        skeleton.boneInverses.length === candidate.boneInverses.length &&
        skeleton.bones.every((bone, index) => bone === candidate.bones[index]) &&
        skeleton.boneInverses.every((inverse, index) => inverse.equals(candidate.boneInverses[index])));
      if (equivalent && equivalent !== candidate) { node.skeleton = equivalent; candidate.dispose(); }
      else skeletons.add(candidate);
    }
    if (node.isMesh) {
      node.material = Array.isArray(node.material) ? node.material.map(materialClone) : materialClone(node.material);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    }
  });
  const motion=createMotion(root,asset,motionOptions);
  motion.sample({time:0});
  return {root,materials,motion,deathDuration:motion.deathDuration,
    get action(){return motion.action;},
    dispose(){motion.dispose();for(const material of materials)material.dispose();for(const skeleton of skeletons)skeleton.dispose();}};
}

/** Read-only Snapshot consumer. No renderer, input, simulation stepping or hit-event inference. */
export function createPresentation({catalog, assets, motionOptions}) {
  const root = new THREE.Group();
  root.name = 'SnapshotPresentation';
  const heroes = new Map();
  const entities = new Map();
  const entityPositions = new Map();
  const owned = new Set();
  let lastTick = null;
  let latestTime=0;
  let disposed = false;
  const own = value => (owned.add(value), value);
  const world = catalog.map.world;
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(world.maxX-world.minX, world.maxZ-world.minZ)), own(new THREE.MeshStandardMaterial({color: '#192c2d'})));
  ground.rotation.x = -Math.PI/2;
  ground.position.set((world.minX+world.maxX)/2, -0.03, (world.minZ+world.maxZ)/2);
  ground.name = 'map-bounds'; root.add(ground);
  const lane = new THREE.Mesh(own(new THREE.PlaneGeometry(world.maxX-world.minX, catalog.map.laneWidth)), own(new THREE.MeshStandardMaterial({color: '#35413a'})));
  lane.rotation.x = -Math.PI/2;
  lane.position.set(ground.position.x, -0.02, ground.position.z);
  lane.name = 'lane'; root.add(lane);
  const geometry = {
    tower: own(new THREE.CylinderGeometry(0.65, 1, 2, 8)),
    base: own(new THREE.BoxGeometry(2, 2, 2)),
    barracks: own(new THREE.BoxGeometry(2, 1, 1.5)),
    minion: own(new THREE.ConeGeometry(1, 1.5, 5)),
  };
  const materials = [0x38b9dc, 0xffb14d].map(color => own(new THREE.MeshStandardMaterial({color})));
  function assertOpen() { if (disposed) throw new Error('Presentation is disposed'); }
  function reset() {
    assertOpen();
    for (const actor of heroes.values()) { root.remove(actor.root); actor.dispose(); }
    for (const proxy of entities.values()) root.remove(proxy);
    heroes.clear(); entities.clear(); entityPositions.clear(); lastTick = null;latestTime=0;
  }
  function sync(snapshot) {
    assertOpen();
    if (snapshot.contentVersion !== catalog.version) throw new Error('Snapshot/catalog version mismatch');
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) throw new Error('Invalid snapshot tick');
    if (lastTick !== null && snapshot.tick < lastTick) throw new Error('Call reset before replay/restart');
    if (snapshot.tick === lastTick) return;
    const seen = new Set();
    for (const hero of snapshot.heroes) {
      if (![0,1].includes(hero.team) || !Number.isFinite(hero.position.x) || !Number.isFinite(hero.position.z)) throw new Error('Invalid hero transform');
      seen.add(hero.id);
      let actor = heroes.get(hero.id);
      if (actor && actor.team !== hero.team) { root.remove(actor.root); actor.dispose(); heroes.delete(hero.id); actor = null; }
      if (!actor) {
        actor = character(hero.team === 0 ? assets.blue : assets.amber,motionOptions);
        actor.events=createMotionState(hero.id,catalog);
        actor.team = hero.team; actor.previous = null;actor.visualTime=snapshot.timeSeconds;
        actor.root.name = `hero-${hero.id}`; actor.root.userData.simEntityId = hero.id; heroes.set(hero.id, actor); root.add(actor.root);
      }
      const old = actor.previous;
      const dx = old ? hero.position.x-old.x : 0;
      const dz = old ? hero.position.z-old.z : 0;
      const moving = hero.alive && !hero.stunned && old?.alive && Math.hypot(dx,dz) > 1e-5;
      actor.to = new THREE.Vector3(hero.position.x, 0, hero.position.z);
      actor.from = old?.alive && hero.alive ? new THREE.Vector3(old.x, 0, old.z) : actor.to.clone();
      actor.root.position.copy(actor.to);
      // Trigger only on an observed alive -> dead transition. Initial dead
      // snapshots do not fabricate a death event; corpse visuals never affect sim/HUD.
      if(old?.alive && !hero.alive)actor.deathStarted=snapshot.timeSeconds;
      if(hero.alive)actor.deathStarted=null;
      if(hero.alive&&old?.alive===false){actor.events.reset();actor.motion.reset();}
      actor.events.consume(snapshot.events??[],snapshot.timeSeconds,hero.alive);
      if(snapshot.status!=='running')actor.events.finish(snapshot.timeSeconds);
      const deadElapsed=actor.deathStarted==null?Infinity:Math.max(0,actor.visualTime-actor.deathStarted);
      actor.root.visible = hero.alive || (actor.deathDuration>0 && deadElapsed<actor.deathDuration+1);
      actor.deadElapsed=deadElapsed;
      // GLB forward is +Z. Read authoritative facing, never derive attack aim
      // from an input pointer, target guess, or an unrelated movement delta.
      if(hero.facing&&Number.isFinite(hero.facing.x)&&Number.isFinite(hero.facing.z)&&Math.hypot(hero.facing.x,hero.facing.z)>1e-8)actor.root.rotation.y=Math.atan2(hero.facing.x,hero.facing.z);
      else if(moving)actor.root.rotation.y=Math.atan2(dx,dz); // legacy snapshots without facing
      actor.motion.play(moving&&snapshot.status==='running'?'walk':'idle');
      actor.motion.sample({time:actor.visualTime,...actor.events.inspect(),deathElapsed:actor.deathStarted==null?null:deadElapsed});
      actor.previous = {x: hero.position.x, z: hero.position.z, alive: hero.alive};
    }
    for (const [id, actor] of heroes) if (!seen.has(id)) { root.remove(actor.root); actor.dispose(); heroes.delete(id); }
    const seenEntities = new Set();
    for (const entity of snapshot.entities) {
      if (entity.kind === 'hero') continue;
      seenEntities.add(entity.id);
      const kind = entity.kind === 'minion' ? 'minion' : entity.structureKind;
      if (!geometry[kind] || !materials[entity.team]) throw new Error('Unsupported entity kind/team');
      let proxy = entities.get(entity.id);
      if (!proxy) { proxy = new THREE.Mesh(geometry[kind], materials[entity.team]); proxy.name = `entity-${entity.id}`; proxy.userData.simEntityId = entity.id; entities.set(entity.id, proxy); root.add(proxy); }
      proxy.geometry = geometry[kind]; proxy.material = materials[entity.team];
      const to = new THREE.Vector3(entity.position.x, entity.radius * (kind === 'barracks' ? 0.5 : kind === 'minion' ? 0.75 : 1), entity.position.z);
      const previous = entityPositions.get(entity.id);
      entityPositions.set(entity.id, {to, from: previous?.alive && entity.alive ? previous.to.clone() : to.clone(), alive: entity.alive});
      proxy.position.copy(to);
      proxy.scale.setScalar(entity.radius); proxy.visible = entity.alive;
    }
    for (const [id, proxy] of entities) if (!seenEntities.has(id)) { root.remove(proxy); entities.delete(id); entityPositions.delete(id); }
    lastTick = snapshot.tick;latestTime=snapshot.timeSeconds; root.updateMatrixWorld(true);
  }
  function advance(seconds, alpha) {
    const synchronized=alpha!==undefined;alpha??=1;
    assertOpen();
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid render delta');
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('Interpolation alpha must be between 0 and 1');
    for (const actor of heroes.values()) {
      actor.root.position.lerpVectors(actor.from, actor.to, alpha);
      if(actor.root.visible){
        const time=synchronized?Math.max(actor.visualTime,Math.max(0,latestTime-(1-alpha)/catalog.rules.tickRate)):actor.visualTime+seconds;
        actor.motion.advance(time-actor.visualTime);actor.visualTime=time;
        if(actor.deathStarted!=null){actor.deadElapsed=Math.max(0,time-actor.deathStarted);if(actor.deadElapsed>=actor.deathDuration+1)actor.root.visible=false;}
        actor.motion.sample({time:actor.visualTime,...actor.events.inspect(),deathElapsed:actor.deathStarted==null?null:actor.deadElapsed});
      }
    }
    for (const [id, proxy] of entities) {
      const position = entityPositions.get(id);
      proxy.position.lerpVectors(position.from, position.to, alpha);
    }
    root.updateMatrixWorld(true);
  }
  return {root, sync, advance, reset,
    motionState(){return [...heroes].map(([id,actor])=>({id,attached:actor.root.parent===root&&root.parent!==null,visible:root.visible&&actor.root.visible,actions:actor.motion.inspect()}));},
    inspect() { return {tick:lastTick, heroes:[...heroes].map(([id,a])=>({id,action:a.action,team:a.team,visible:a.root.visible})), entities:entities.size}; },
    dispose() { if (disposed) return; reset(); for (const resource of owned) resource.dispose(); root.clear(); disposed = true; },
  };
}
