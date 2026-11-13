import * as THREE from 'three';
import {renderRole} from './lighting-style.js';

export interface LightShaftOptions {sunOffset:THREE.Vector3}

const Y_AXIS=new THREE.Vector3(0,1,0);
const BEAMS=[
  {x:-114,z:-4.5,radius:3.7,height:11.5,opacity:.08},
  {x:-90,z:8.5,radius:3.8,height:10.5,opacity:.11},
  {x:-76,z:6.2,radius:3.6,height:11,opacity:.09},
  {x:-58,z:6,radius:3.8,height:11.5,opacity:.09},
  {x:-38,z:4,radius:4,height:11.5,opacity:.14},
  {x:-24,z:5.5,radius:3.9,height:11,opacity:.1},
  {x:-12,z:-5.8,radius:3.8,height:11.5,opacity:.1},
  {x:12,z:6,radius:3.6,height:11,opacity:.085},
  {x:36,z:-5.6,radius:3.8,height:11.5,opacity:.085},
  {x:60,z:6,radius:3.5,height:11,opacity:.08},
  {x:84,z:-5.4,radius:3.6,height:11.5,opacity:.075},
] as const;

/** Soft, depth-aware canopy shafts. The custom shader compares each fragment
 * against a world-only depth pass, so a tower, trunk or unit always cuts a soft
 * hole in a beam rather than being washed over by it. The additive cone is
 * excluded from SSAO and supports no scene-wide bright pass. */
export function createLightShafts(scene:THREE.Scene,camera:THREE.PerspectiveCamera,{sunOffset}:LightShaftOptions){
  const root=new THREE.Group();root.name='ForestLightShafts';root.userData['renderRole']='world';
  const target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});
  const depthTexture=new THREE.DepthTexture(1,1);
  depthTexture.type=THREE.UnsignedIntType;depthTexture.minFilter=THREE.NearestFilter;depthTexture.magFilter=THREE.NearestFilter;depthTexture.generateMipmaps=false;
  target.depthTexture=depthTexture;
  const depthMaterial=new THREE.MeshDepthMaterial();
  const axis=sunOffset.clone().normalize();
  const geometry=new THREE.CylinderGeometry(.72,1,1,18,1,true);
  geometry.translate(0,.5,0);
  const quaternion=new THREE.Quaternion().setFromUnitVectors(Y_AXIS,axis);
  const materials:THREE.ShaderMaterial[]=[];
  for(const beam of BEAMS){
    const material=new THREE.ShaderMaterial({
      uniforms:{
        tDepth:{value:depthTexture},uResolution:{value:new THREE.Vector2(1,1)},
        uCameraNear:{value:camera.near},uCameraFar:{value:camera.far},
        uColor:{value:new THREE.Color('#ffdca2')},uOpacity:{value:beam.opacity},uSoftDepth:{value:1.35},
      },
      vertexShader:`varying vec2 vUv;varying vec3 vNormalW;varying vec3 vViewDir;varying float vEyeDepth;
        void main(){vUv=uv;vec4 world=modelMatrix*vec4(position,1.0);vNormalW=normalize(mat3(modelMatrix)*normal);
          vec4 view=modelViewMatrix*vec4(position,1.0);vEyeDepth=-view.z;vViewDir=normalize(cameraPosition-world.xyz);
          gl_Position=projectionMatrix*view;}`,
      fragmentShader:`uniform sampler2D tDepth;uniform vec2 uResolution;uniform float uCameraNear;uniform float uCameraFar;uniform vec3 uColor;uniform float uOpacity;uniform float uSoftDepth;
        varying vec2 vUv;varying vec3 vNormalW;varying vec3 vViewDir;varying float vEyeDepth;
        float linearDepth(float depth){float ndc=depth*2.0-1.0;return 2.0*uCameraNear*uCameraFar/(uCameraFar+uCameraNear-ndc*(uCameraFar-uCameraNear));}
        void main(){
          float sceneDepth=linearDepth(texture2D(tDepth,gl_FragCoord.xy/uResolution).x);
          float clear=clamp((sceneDepth-vEyeDepth)/uSoftDepth,0.0,1.0);
          if(clear<=0.001)discard;
          float v=clamp(vUv.y,0.0,1.0);
          float vertical=smoothstep(0.0,0.13,v)*(0.34+0.66*pow(v,0.55))*(1.0-smoothstep(0.82,1.0,v));
          float facing=abs(dot(normalize(vNormalW),normalize(vViewDir)));
          float edge=smoothstep(0.03,0.82,facing);
          float grain=0.9+0.1*sin(vUv.x*15.0+vUv.y*4.0)*sin(vUv.x*31.0-vUv.y*7.0);
          float alpha=uOpacity*clear*vertical*edge*grain;
          gl_FragColor=vec4(uColor,alpha);
        }`,
      transparent:true,depthWrite:false,depthTest:false,side:THREE.FrontSide,blending:THREE.AdditiveBlending,toneMapped:false,
    });
    materials.push(material);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=`forest-light-shaft-${materials.length}`;
    mesh.position.copy(axis).multiplyScalar(beam.height*.5);mesh.position.y+=.08;
    mesh.position.x+=beam.x;mesh.position.z+=beam.z;
    mesh.scale.set(beam.radius,beam.height,beam.radius);
    mesh.quaternion.copy(quaternion);
    mesh.renderOrder=7;mesh.raycast=()=>{};
    root.add(mesh);
  }
  scene.add(root);
  let depthWidth=1,depthHeight=1;
  function renderDepth(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){
    if(!root.visible)return;
    const hidden:Array<[THREE.Object3D,boolean]>=[];
    root.visible=false;hidden.push([root,true]);
    scene.traverse(object=>{
      if(!object.visible||!(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.Points))return;
      if(renderRole(object)!=='world'){hidden.push([object,object.visible]);object.visible=false;return;}
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.some(material=>material.transparent||material.depthWrite===false)){hidden.push([object,object.visible]);object.visible=false;}
    });
    const previousTarget=renderer.getRenderTarget(),previousOverride=scene.overrideMaterial,previousBackground=scene.background,shadowUpdate=renderer.shadowMap.autoUpdate;
    try{
      renderer.shadowMap.autoUpdate=false;scene.overrideMaterial=depthMaterial;scene.background=null;
      renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    }finally{
      renderer.shadowMap.autoUpdate=shadowUpdate;scene.background=previousBackground;scene.overrideMaterial=previousOverride;renderer.setRenderTarget(previousTarget);
      for(const [object,visible] of hidden)object.visible=visible;
    }
  }
  let disposed=false;
  return {
    root,
    renderDepth,
    resize(width:number,height:number){
      if(width<1||height<1)return;
      depthWidth=Math.max(1,Math.floor(width*.5));depthHeight=Math.max(1,Math.floor(height*.5));
      target.setSize(depthWidth,depthHeight);
      for(const material of materials)material.uniforms['uResolution']!.value.set(width,height);
    },
    dispose(){if(disposed)return;disposed=true;for(const material of materials)material.dispose();geometry.dispose();depthMaterial.dispose();depthTexture.dispose();target.dispose();root.clear();scene.remove(root);}
  };
}
