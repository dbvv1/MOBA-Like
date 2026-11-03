import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
// @ts-expect-error Production JS motion implementation has no standalone declaration; exercised with real rig in CPU tests.
import {createMotion} from '../../asset-pipeline/presentation/motion.js';
import {roadCrossSection,type TerrainTextures} from '../render/terrain-composition.js';
import {bindQuietGround,type QuietTextures} from '../render/quiet-family.js';
import {surfaceMaterial,type LightingStyle} from '../render/lighting-style.js';
import type {BattleAssets} from '../render/battle-assets.js';
import layout from '../../asset-pipeline/quiet-family/standards/layout-manifest.json';

/** Capture-only consumer: reuse already verified production prototypes/materials.
 * It does not claim that a source lineup GLB contains runtime shader hooks. */
export function createContentStandards(assets:BattleAssets,lighting:LightingStyle,textures:TerrainTextures,quiet?:QuietTextures){
 const root=new THREE.Group();root.name='quiet-five-v1';root.userData['renderRole']='world';
 const owned:Array<{dispose():void}>=[],skeletons=new Set<THREE.Skeleton>();let disposed=false,time=0;
 let motion:ReturnType<typeof createMotion>|undefined;
 const dispose=()=>{if(disposed)return;disposed=true;motion?.dispose();for(const s of skeletons)s.dispose();for(const value of owned)value.dispose();root.removeFromParent();root.clear();};
 try{
 const entry=(id:string)=>{const value=layout.entries.find(e=>e.id===id);if(!value)throw Error(`Missing standard layout ${id}`);return value;};
 // Preflight before allocating anything; the selected 3 buildings are from the
 // same all-six production binding, not a parallel material implementation.
 for(const id of ['tower-teal','barracks-teal','base-teal','veyra-teal'])if(!assets.models[id])throw Error(`Missing standard source ${id}`);
 for(const id of ['shoulder-section','tower','barracks','base','hero'])entry(id);
 const shoulder=new THREE.Group();shoulder.name='standard-shoulder-section';shoulder.position.fromArray(entry('shoulder-section').position);root.add(shoulder);
 for(const side of ['forest','road'] as const){
  const vertices:number[]=[],uv:number[]=[];const period=side==='road'?10:12;
  for(let x=-2;x<2;x++){
   const n=x+1,a=roadCrossSection(x).south,b=roadCrossSection(n).south;
   const low=side==='forest'?-.4:0,high=side==='forest'?0:.4;
   const points=[[x,0,a+low],[x,0,a+high],[n,0,b+low],[n,0,b+low],[x,0,a+high],[n,0,b+high]];
   for(const p of points){vertices.push(...p);uv.push(p[0]!/period,p[2]!/period);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();owned.push(geometry);
  const material=surfaceMaterial(lighting,{color:0xffffff,map:textures[side]});owned.push(material);
  if(quiet){
   bindQuietGround(material,quiet);const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
   // Placement changes the comparison layout, not the source road coordinates.
   // Preserve the production edge/blend/tile formula, undo only this translation.
   const offset=new THREE.Vector2(shoulder.position.x,shoulder.position.z);
   material.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);shader.uniforms['quietStandardOffset']={value:offset};shader.vertexShader='uniform vec2 quietStandardOffset;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('vQuietWorld=(modelMatrix*vec4(transformed,1.0)).xz;','vQuietWorld=(modelMatrix*vec4(transformed,1.0)).xz-quietStandardOffset;');};
   material.customProgramCacheKey=()=>key.call(material)+'|source-standard-offset-v1';
  }
  const mesh=new THREE.Mesh(geometry,material);mesh.name=`standard-shoulder-${side}`;mesh.receiveShadow=true;shoulder.add(mesh);
 }
 for(const id of ['tower','barracks','base']){
  const wrapper=new THREE.Group();wrapper.name=`standard-${id}`;wrapper.position.fromArray(entry(id).position);wrapper.add(assets.models[`${id}-teal`]!.scene.clone(true));root.add(wrapper);
 }
 const heroAsset=assets.models['veyra-teal']!,hero=clone(heroAsset.scene),heroWrapper=new THREE.Group();heroWrapper.name='standard-hero';heroWrapper.position.fromArray(entry('hero').position);heroWrapper.add(hero);root.add(heroWrapper);
 hero.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});
 root.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=o.parent!==shoulder;o.receiveShadow=true;}});
 motion=createMotion(hero,heroAsset,{recoilLayer:'torso-additive',firstDrawRelease:.1});motion.sample({time:0});
 return {root,advance(seconds:number){if(disposed)return;const dt=Math.max(0,seconds);time+=dt;motion!.advance(dt);motion!.sample({time});},
  inspect(){return {name:'quiet-five-v1',slots:root.children.map(o=>o.name),slotCount:root.children.length,sourceHashes:layout.entries.map(e=>({id:e.id,sha256:e.sourceSha256})),heroClips:heroAsset.animations.map(c=>c.name),heroTime:time,materials:quiet?'quiet-family-v1':'baseline',sourceSamplingOffset:shoulder.position.toArray(),geometryChanged:false};},
  dispose
 };
 }catch(error){dispose();throw error;}
}
