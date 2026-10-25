import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnimationMixer, Vector3, REVISION } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { variants } from './validate.mjs';

const packageConfig = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const meshOnly = process.argv.slice(2).includes('--mesh-only');
assert.ok(process.argv.slice(2).every(arg => arg === '--mesh-only'), 'Unknown argument');
const translation = [3, 2, -4];
const scale = 1.7;
const tolerance = 1e-5; // metres
const samples = [['idle', 0.5], ['walk', 0.26666666666666666], ['attack', 0.6]];

function points(meshes) {
  return meshes.flatMap(mesh => {
    const positions = mesh.geometry.attributes.position;
    return Array.from({ length: positions.count }, (_, i) => {
      const point = new Vector3().fromBufferAttribute(positions, i);
      return mesh.applyBoneTransform(i, point).applyMatrix4(mesh.matrixWorld).toArray();
    });
  });
}
function maxError(before, after) {
  assert.equal(before.length, after.length);
  assert.ok(before.length > 0);
  return Math.max(...before.map((p, i) => Math.hypot(...p.map((v, k) =>
    after[i][k] - (v * scale + translation[k])))));
}

const results = [];
for (const name of variants) {
  const bytes = await readFile(new URL(`../placeholder/assets/${name}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = gltf.scene;
  const meshes = [];
  const bones = [];
  root.traverse(node => {
    if (node.isSkinnedMesh) meshes.push(node);
    if (node.isBone) bones.push(node);
  });
  assert.ok(meshes.length > 0);
  assert.equal(bones.length, 15);
  assert.deepEqual(gltf.animations.map(clip => clip.name).sort(), ['attack', 'idle', 'walk']);
  const weightedBones = new Set();
  for (const mesh of meshes) {
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < skinWeight.count; i++) {
      for (let component = 0; component < 4; component++) {
        if (skinWeight.getComponent(i, component) > 0) {
          weightedBones.add(mesh.skeleton.bones[skinIndex.getComponent(i, component)].name);
        }
      }
    }
  }
  assert.equal(weightedBones.size, 15);
  const mixer = new AnimationMixer(root);
  for (const [clipName, seconds] of samples) {
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    mixer.stopAllAction();
    const action = mixer.clipAction(gltf.animations.find(clip => clip.name === clipName));
    action.reset().play();
    mixer.setTime(seconds);
    root.updateMatrixWorld(true);
    const before = points(meshes);
    const boneBefore = bones.map(b => b.getWorldPosition(new Vector3()).toArray());
    if (meshOnly) {
      // Negative control: move/scale only meshes, leaving the bones behind.
      // This is deliberately NOT the supported whole-character operation.
      for (const mesh of meshes) {
        mesh.position.fromArray(translation);
        mesh.scale.setScalar(scale);
      }
    } else {
      root.position.fromArray(translation);
      root.scale.setScalar(scale);
    }
    root.updateMatrixWorld(true);
    const error = maxError(before, points(meshes));
    const boneError = maxError(boneBefore, bones.map(b => b.getWorldPosition(new Vector3()).toArray()));
    const pass = Number.isFinite(error) && Number.isFinite(boneError)
      && error < tolerance && boneError < tolerance;
    results.push({ input: name, clip: clipName, seconds, vertices: before.length,
      bones: bones.length, weightedBones: [...weightedBones].sort(), maxVertexError: error, maxBoneError: boneError, pass });
    // The negative path stops at its first demonstrated failure, avoiding state reuse.
    if (!pass) break;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
}
const pass = results.length === variants.length * samples.length && results.every(r => r.pass);
console.log(JSON.stringify({ threePackage: packageConfig.dependencies.three, threeRevision: REVISION, mode: meshOnly ? 'mesh-only-negative' : 'whole-scene-root',
  translation, scale, tolerance, results, exit: pass ? 0 : 1 }, null, 2));
process.exitCode = pass ? 0 : 1;
