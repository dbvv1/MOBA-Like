import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export const assetUrls = Object.freeze({
  blue: new URL('../placeholder/assets/blue.glb', import.meta.url).href,
  amber: new URL('../placeholder/assets/amber.glb', import.meta.url).href,
});

export function disposeCharacterAssets(assets) {
  const resources = new Set();
  for (const asset of Object.values(assets)) asset?.scene?.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.skeleton) resources.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}

export async function loadCharacterAssets(load = url => new GLTFLoader().loadAsync(url)) {
  const results = await Promise.allSettled([assetUrls.blue, assetUrls.amber].map(url => Promise.resolve().then(() => load(url))));
  const loaded = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  try {
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    for (const asset of loaded) {
      for (const name of ['idle', 'walk']) {
        if (!asset.animations.some(clip => clip.name === name)) throw new Error(`Missing clip: ${name}`);
      }
    }
    return {blue: loaded[0], amber: loaded[1]};
  } catch (error) {
    disposeCharacterAssets(loaded);
    throw error;
  }
}

function character(asset) {
  const root = clone(asset.scene);
  const materials = new Set();
  const skeletons = new Set();
  root.traverse(node => {
    if (node.isSkinnedMesh) skeletons.add(node.skeleton);
    if (node.isMesh) {
      node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  let action = null;
  function play(name) {
    if (action === name) return;
    mixer.stopAllAction();
    mixer.clipAction(asset.animations.find(clip => clip.name === name)).reset().play();
    action = name;
  }
  play('idle');
  return {root, mixer, materials, play, get action() { return action; },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); for (const material of materials) material.dispose(); for (const skeleton of skeletons) skeleton.dispose(); }};
}

/** Read-only Snapshot consumer. No renderer, input, simulation stepping or hit-event inference. */
export function createPresentation({catalog, assets}) {
  const root = new THREE.Group();
  root.name = 'SnapshotPresentation';
  const heroes = new Map();
  const entities = new Map();
  const owned = new Set();
  let lastTick = null;
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
    heroes.clear(); entities.clear(); lastTick = null;
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
        actor = character(hero.team === 0 ? assets.blue : assets.amber);
        actor.team = hero.team; actor.previous = null;
        actor.root.name = `hero-${hero.id}`; actor.root.userData.simEntityId = hero.id; heroes.set(hero.id, actor); root.add(actor.root);
      }
      const old = actor.previous;
      const dx = old ? hero.position.x-old.x : 0;
      const dz = old ? hero.position.z-old.z : 0;
      const moving = hero.alive && !hero.stunned && old?.alive && Math.hypot(dx,dz) > 1e-5;
      actor.root.position.set(hero.position.x, 0, hero.position.z);
      actor.root.visible = hero.alive;
      // GLB's forward is +Z after Blender -Y -> glTF conversion. No facing on snapshot.
      if (moving) actor.root.rotation.y = Math.atan2(dx,dz);
      actor.play(moving ? 'walk' : 'idle');
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
      proxy.position.set(entity.position.x, entity.radius * (kind === 'barracks' ? 0.5 : kind === 'minion' ? 0.75 : 1), entity.position.z);
      proxy.scale.setScalar(entity.radius); proxy.visible = entity.alive;
    }
    for (const [id, proxy] of entities) if (!seenEntities.has(id)) { root.remove(proxy); entities.delete(id); }
    lastTick = snapshot.tick; root.updateMatrixWorld(true);
  }
  function advance(seconds) {
    assertOpen();
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid render delta');
    for (const actor of heroes.values()) if (actor.root.visible) actor.mixer.update(seconds);
    root.updateMatrixWorld(true);
  }
  return {root, sync, advance, reset,
    inspect() { return {tick:lastTick, heroes:[...heroes].map(([id,a])=>({id,action:a.action,team:a.team,visible:a.root.visible})), entities:entities.size}; },
    dispose() { if (disposed) return; reset(); for (const resource of owned) resource.dispose(); root.clear(); disposed = true; },
  };
}
