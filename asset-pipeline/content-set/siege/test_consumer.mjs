import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

const here = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', here), 'utf8'));
const records = [];
async function load(entry) {
  const bytes = await readFile(new URL(entry.file, here));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const loader = new GLTFLoader();
  // CPU geometry/animation test: no DOM, WebGL, network or image decoder.
  // Real GLB image bytes are retained; texture appearance is NOT verified here.
  loader.register(() => ({name: 'CPU_TEST_SKIP_IMAGE_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture())}));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
function meshes(scene) {
  const result = [];
  scene.traverse(object => { if (object.isSkinnedMesh) result.push(object); });
  return result;
}
function sample(scene, clip, time) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  mixer.setTime(time); scene.updateMatrixWorld(true);
  const box = new THREE.Box3(); const vertices = [];
  for (const mesh of meshes(scene)) {
    mesh.skeleton.update();
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
      const p = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite)); box.expandByPoint(p); vertices.push(p.toArray());
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(scene);
  return {box, vertices};
}
function maxVertexDifference(a, b) {
  assert.equal(a.length, b.length);
  return Math.max(...a.flatMap((p, i) => p.map((n, k) => Math.abs(n - b[i][k]))));
}

for (const entry of manifest.assets) {
  test(`${entry.id}: fixed bytes, real Three loader, six-bone/three-material source`, async () => {
    const gltf = await load(entry);
    const parts = meshes(gltf.scene);
    assert.equal(parts.length, 3); // Three splits one mesh's three material primitives.
    assert.ok(parts.every(p => p.skeleton.bones.length === 6));
    assert.deepEqual(new Set(parts[0].skeleton.bones.map(b => b.name)), new Set(entry.bones));
    assert.equal(parts.reduce((n, mesh) => n + mesh.geometry.index.count / 3, 0), 1884);
    assert.deepEqual(new Set(gltf.animations.map(x => x.name)), new Set(Object.keys(entry.clipFrames)));
    for (const clip of gltf.animations) assert.ok(Math.abs(clip.duration - entry.clipFrames[clip.name] / 30) < 1e-6);
  });

  test(`${entry.id}: all nine clips, every half-frame, finite and grounded`, async () => {
    const gltf = await load(entry); const clips = {};
    for (const clip of gltf.animations) {
      const all = new THREE.Box3();
      const steps = Math.ceil(clip.duration * 60);
      for (let i = 0; i <= steps; i++) all.union(sample(gltf.scene, clip, clip.duration * i / steps).box);
      assert.ok(all.min.y >= -.005, `${clip.name} penetrated floor: ${all.min.y}`);
      assert.ok(all.max.y < 1.85 && all.max.x - all.min.x < 1.5 && all.max.z - all.min.z < 2.1, `${clip.name} exceeds visual envelope`);
      clips[clip.name] = {duration: clip.duration, min: all.min.toArray(), max: all.max.toArray(), samples: steps + 1};
    }
    records.push({id: entry.id, clips});
  });

  test(`${entry.id}: phase endpoints agree; default attack is release-first`, async () => {
    const gltf = await load(entry); const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    for (const [a, b] of [['attack_prepare', 'attack_release'], ['attack_release', 'attack_recover']]) {
      assert.ok(maxVertexDifference(sample(gltf.scene, clips[a], clips[a].duration).vertices,
        sample(gltf.scene, clips[b], 0).vertices) < 1e-5, `${a} → ${b} jumps`);
    }
    for (const time of [0, clips.attack.duration]) assert.ok(maxVertexDifference(sample(gltf.scene, clips.idle, 0).vertices,
      sample(gltf.scene, clips.attack, time).vertices) < 1e-5);
    const rootTracks = gltf.animations.flatMap(c => c.tracks).filter(t => t.name === 'Root.position');
    assert.ok(rootTracks.length > 0); assert.ok(rootTracks.every(t => [...t.values].every(n => Math.abs(n) < 1e-7)));
  });

  test(`${entry.id}: two cloned units have independent bones and mixers`, async () => {
    const gltf = await load(entry); const a = clone(gltf.scene), b = clone(gltf.scene);
    const aParts = meshes(a), bParts = meshes(b);
    assert.ok(aParts[0].skeleton.bones.every((bone, i) => bone !== bParts[0].skeleton.bones[i]));
    const idle = gltf.animations.find(c => c.name === 'idle');
    const reference = sample(b, idle, 0).vertices;
    sample(a, gltf.animations.find(c => c.name === 'death'), 1);
    assert.equal(maxVertexDifference(reference, sample(b, idle, 0).vertices), 0);
  });
}

test.after(async () => {
  await writeFile(new URL('reports/three-cpu-animation.json', here), JSON.stringify({
    scope: 'Actual Three GLTFLoader/SkeletonUtils/AnimationMixer/skinned-vertex CPU path; image decoding stubbed',
    webgl: 'not run', normalGameplayView: 'not run', gameplayIntegration: 'separately covered by tests/client/siege-assets.test.ts', records
  }, null, 2) + '\n');
});
