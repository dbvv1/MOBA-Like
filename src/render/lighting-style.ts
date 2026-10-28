import * as THREE from 'three';

export const LIGHTING_STYLES=['baseline','stylized-diffuse'] as const;
export type LightingStyle=typeof LIGHTING_STYLES[number];
export type RenderRole='world'|'cue';

/** Independent of capture/gameplay parameters. Invalid requests never silently fall back. */
export function parseLightingStyle(search:string):LightingStyle {
  const query=new URLSearchParams(search),values=query.getAll('lighting');
  if(values.length>1)throw new Error('Duplicate lighting parameter');
  const value=values[0]??'baseline';
  if(!LIGHTING_STYLES.includes(value as LightingStyle))throw new Error(`Unknown lighting '${value}'; choose ${LIGHTING_STYLES.join(', ')}`);
  return value as LightingStyle;
}

/** Role is inherited from an explicit owner, never inferred from shader/material type. */
export function renderRole(object:THREE.Object3D):RenderRole|undefined {
  for(let current:THREE.Object3D|null=object;current;current=current.parent){
    const role=current.userData['renderRole'];
    if(role==='world'||role==='cue')return role;
  }
  return undefined;
}

export function lightingState(style:LightingStyle,frameSubmitted=false){
  return {requested:style,configured:style,active:frameSubmitted?style:null,stage:frameSubmitted?'frame-submitted':'configured',diffuse:style==='baseline'?'source-materials':'three-native-toon',
    environment:{kind:'ambient-and-hemisphere',sky:'#d7e9e3',ground:'#3c4333',hemisphereIntensity:style==='baseline'?1.65:1,ambientIntensity:style==='baseline'?0:.9},
    directSun:{color:'#fff0cf',intensity:2.5,shadow:'original-pcf-soft'},toneMapping:'ACESFilmic',exposure:1.12};
}

export function addEnvironmentLighting(scene:THREE.Scene,style:LightingStyle){
  const state=lightingState(style).environment;
  scene.add(new THREE.HemisphereLight(state.sky,state.ground,state.hemisphereIntensity));
  if(state.ambientIntensity>0)scene.add(new THREE.AmbientLight(state.sky,state.ambientIntensity));
}

/** Only the world owner's supported lit surfaces change response. Authored unlit
 * world surfaces stay world, not cues; cue materials always retain their shader. */
export function diffuseMaterial(source:THREE.Material,role:RenderRole,style:LightingStyle):THREE.Material {
  if(style==='baseline'||role==='cue'||source instanceof THREE.MeshBasicMaterial||source instanceof THREE.MeshToonMaterial)return source;
  if(!(source instanceof THREE.MeshStandardMaterial||source instanceof THREE.MeshLambertMaterial||source instanceof THREE.MeshPhongMaterial))throw new Error(`Unsupported world diffuse material: ${source.type}`);
  // No silent loss of authored physical extensions. This slice uses ordinary glTF PBR.
  if(source instanceof THREE.MeshPhysicalMaterial)throw new Error('Physical extensions require a separate lighting contract');
  const target=new THREE.MeshToonMaterial();
  THREE.Material.prototype.copy.call(target,source); // alpha, depth, side, blend, vertex colors, tone mapping
  target.color.copy(source.color);target.emissive.copy(source.emissive);target.normalScale.copy(source.normalScale);
  for(const key of ['map','alphaMap','normalMap','normalMapType','bumpMap','bumpScale','displacementMap','displacementScale','displacementBias','lightMap','lightMapIntensity','aoMap','aoMapIntensity','emissiveMap','emissiveIntensity','wireframe','wireframeLinewidth','fog'] as const) {
    // These are common diffuse inputs in the installed Three 0.186.1 materials.
    Object.assign(target,{[key]:source[key]});
  }
  // Metalness/roughness/specular/environment maps are deliberately not sampled by
  // this diffuse-only response. Their source owner still retains/disposes them.
  return target;
}

/** Once per loaded prototype, before SkeletonUtils/hero clones. Callers own all
 * source and replacement resources; the cache does not own textures or disposal. */
export function applyWorldDiffuse(root:THREE.Object3D,style:LightingStyle,cache=new Map<THREE.Material,THREE.Material>()){
  root.userData['renderRole']='world';
  if(style==='baseline')return;
  root.traverse(node=>{
    if(!(node as THREE.Mesh).isMesh||renderRole(node)!=='world')return;
    const mesh=node as THREE.Mesh;
    const convert=(source:THREE.Material)=>{
      let target=cache.get(source);
      if(!target){target=diffuseMaterial(source,'world',style);cache.set(source,target);}
      return target;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);
  });
}

/** Procedural surfaces are allocated once by their existing owner, not per frame. */
export function surfaceMaterial(style:LightingStyle,parameters:Pick<THREE.MeshToonMaterialParameters,'color'|'vertexColors'|'map'>){
  return style==='baseline'?new THREE.MeshStandardMaterial({...parameters,roughness:1}):new THREE.MeshToonMaterial(parameters);
}
