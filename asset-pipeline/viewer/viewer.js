import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetLoader } from './asset-loader.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const variantSelect = document.querySelector('#variant');
const actionSelect = document.querySelector('#action');
const pauseButton = document.querySelector('#pause');
const variants = ['blue', 'amber', 'blue-long'];
const clips = ['idle', 'walk', 'attack'];
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101c2d');
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
camera.position.set(3.5, 3.1, 5.2);
camera.lookAt(0, 1, 0);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
} catch (error) {
  status.textContent = 'WebGL 2 unavailable: this preview needs a supported browser.';
  status.className = 'error';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight('#dff6ff', '#485268', 2.4));
const key = new THREE.DirectionalLight('#fff0d5', 3);
key.position.set(3, 5, 4);
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.65, 64), new THREE.MeshStandardMaterial({color: '#243348', roughness: 1}));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
scene.add(floor);
const loader = new GLTFLoader();
const chooseAsset = createAssetLoader(variant => loader.loadAsync(`../placeholder/assets/${variant}.glb`));
let active = null;
let mixer = null;
let paused = false;
let frames = 0;
let lastTime = performance.now();

function render() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (renderer.domElement.width !== Math.round(width * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  frames++;
}
function play(name, seconds = 0) {
  if (!clips.includes(name) || !mixer) throw new Error('Unknown action or asset not loaded');
  mixer.stopAllAction();
  const clip = active.animations.find(c => c.name === name);
  if (!clip) throw new Error(`Missing action: ${name}`);
  mixer.clipAction(clip).reset().play();
  mixer.setTime(seconds);
  actionSelect.value = name;
  active.scene.updateMatrixWorld(true);
  render();
}
async function load(variant) {
  if (!variants.includes(variant)) throw new Error('Unknown variant');
  status.textContent = 'Loading…';
  const gltf = await chooseAsset(variant);
  if (!gltf) return false;
  if (active) {
    mixer.stopAllAction();
    mixer.uncacheRoot(active.scene);
    scene.remove(active.scene);
  }
  active = gltf;
  // Move the whole gltf.scene, never only a skinned mesh.
  scene.add(gltf.scene);
  mixer = new THREE.AnimationMixer(gltf.scene);
  variantSelect.value = variant;
  play(actionSelect.value);
  status.className = '';
  status.textContent = 'Ready';
  return true;
}
function fail(error) {
  status.textContent = `Asset preview failed: ${error.message}`;
  status.className = 'error';
  console.error(error);
}
variantSelect.addEventListener('change', () => load(variantSelect.value).catch(fail));
actionSelect.addEventListener('change', () => { try { play(actionSelect.value); } catch (error) { fail(error); } });
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'Play' : 'Pause';
});
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (mixer && !paused) mixer.update(Math.min((now - lastTime) / 1000, 0.1));
  lastTime = now;
  render();
});
window.assetPreview = {
  async pose(variant, clip, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || !clips.includes(clip)) throw new Error('Invalid pose');
    paused = true;
    pauseButton.textContent = 'Play';
    if (!await load(variant)) throw new Error('Pose superseded');
    play(clip, seconds);
  },
  state() {
    let bones = 0, meshes = 0;
    active?.scene.traverse(node => { bones += Number(Boolean(node.isBone)); meshes += Number(Boolean(node.isSkinnedMesh)); });
    return { ready: status.textContent === 'Ready', variant: variantSelect.value, clip: actionSelect.value, frames, bones, meshes, paused, animationTime: mixer?.time ?? null };
  }
};
load('blue').catch(fail);
