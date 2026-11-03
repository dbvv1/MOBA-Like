/** Reproduce the explicit-mask coverage manifest without browser, GPU, or Blender. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareQuietStone} from '../src/render/quiet-stone.js';
const records=[];
for(const kind of ['tower','barracks','base'])for(const team of ['teal','rust']){
 const assetId=`${kind}-${team}`,path=`asset-pipeline/battle/exported/${assetId}.glb`,bytes=await readFile(path);
 const loader=new GLTFLoader().register(()=>({name:'CPU_mask_only_no_texture_decode',loadTexture:async()=>new THREE.Texture()}));
 const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const prepared=prepareQuietStone(scene,assetId);
 records.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),coverage:prepared.coverage});prepared.dispose();
}
console.log(JSON.stringify({schema:1,method:'CPU real-GLB explicit stone UV region mask; no rendered image or Blender claim',records},null,2));
