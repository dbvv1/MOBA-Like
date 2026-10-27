import {addEnvironmentLighting,lightingState,type LightingStyle} from './lighting-style.js';
import {loadCombatTextures,type CombatTextures} from './combat-textures.js';
import {disposeOwnedRenderer} from './owned-renderer.js';
import {createControlMarkers} from './control-state.js';
import {createTowerReach} from './tower-reach.js';
import {loadBattleAssets,type BattleAssets} from './battle-assets.js';
import {createBattlefield} from './battlefield.js';
import {createImpacts} from './impact.js';
import * as THREE from 'three';
import {createPresentation,type Presentation} from '../../asset-pipeline/presentation/adapter.js';
import type {AbilitySlot,ContentCatalog,Vec2} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';
import type {Aim} from '../input/commands.js';
import {createHealthBars} from './health.js';
import {createEffects} from './effects.js';
import {pickLivingEntity} from './picking.js';
import {createTargeting,targetingPlan} from './targeting.js';
import {applyCapturePose,copyCaptureView,type CaptureView} from './capture-view.js';

export async function createWorld(host:HTMLElement,catalog:ContentCatalog,{lighting='baseline'}:{lighting?:LightingStyle}={}){
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}
  catch{throw new Error('WebGL 2 is unavailable. This client needs a working Three.js/WebGL renderer; no 2D substitute is used.');}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  const scene=new THREE.Scene();scene.userData['renderRole']='cue';scene.background=new THREE.Color('#304c49');scene.fog=new THREE.Fog('#304c49',75,160);
  const camera=new THREE.PerspectiveCamera(45,1,.1,200);
  const focus=new THREE.Vector3(0,0,0);
  addEnvironmentLighting(scene,lighting);
  const light=new THREE.DirectionalLight('#fff0cf',2.5);light.position.set(10,24,12);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:70});light.shadow.bias=-.0004;light.shadow.normalBias=.035;scene.add(light,light.target);
  let combatTextures:CombatTextures|undefined;
  let assets:BattleAssets|undefined,view:Presentation|undefined,statusTexture:THREE.Texture|undefined;
  try{assets=await loadBattleAssets(undefined,lighting);combatTextures=await loadCombatTextures();statusTexture=await new THREE.TextureLoader().loadAsync(new URL('../../asset-pipeline/icons/exported/bright/control.svg',import.meta.url).href);statusTexture.colorSpace=THREE.SRGBColorSpace;view=createPresentation({catalog,assets:{blue:assets.models['hero-teal']!,amber:assets.models['hero-rust']!,byDefinition:{veyra:{blue:assets.models['veyra-teal']!,amber:assets.models['veyra-rust']!,motionOptions:{recoilLayer:'torso-additive',firstDrawRelease:.1}}}},heroesOnly:true});}
  catch(error){disposeOwnedRenderer(renderer,()=>{statusTexture?.dispose();combatTextures?.dispose();assets?.dispose();});throw error;}
  const loadedAssets=assets, presentation=view;
  const battlefield=createBattlefield(catalog,loadedAssets,lighting);const actors=new THREE.Group();actors.userData['renderRole']='world';actors.add(presentation.root,battlefield.root);
  presentation.root.traverse(object=>{if((object as THREE.Mesh).isMesh){object.castShadow=true;object.receiveShadow=true;}});
  scene.add(actors);const controls=createControlMarkers(scene,statusTexture!);const reach=createTowerReach(scene,catalog);const health=createHealthBars(scene);const effects=createEffects(scene);const impacts=createImpacts(scene,combatTextures);const targeting=createTargeting(scene);let targetingSlot:AbilitySlot|null=null;host.replaceChildren(renderer.domElement);renderer.domElement.tabIndex=0;
  const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
  const cursor=new THREE.Vector2(0,0);let pointerInside=false;let locked=true;let snapshot:Snapshot|null=null;let playerId:number|null=null;
  const marker=new THREE.Mesh(new THREE.RingGeometry(.65,.8,32),new THREE.MeshBasicMaterial({color:'#d8fbff',side:THREE.DoubleSide,depthWrite:false}));
  marker.rotation.x=-Math.PI/2;marker.position.y=.04;scene.add(marker);
  let captureView:CaptureView|null=null,savedFocus:THREE.Vector3|null=null;
  let frameSubmitted=false;
  function renderScene(){
    frameSubmitted=false;
    const before=renderer.info.render.frame;
    renderer.render(scene,camera);
    // Three can return normally on context loss. A renderer frame advance is
    // submission evidence only, not shader/pixel validation.
    frameSubmitted=!renderer.getContext().isContextLost()&&renderer.info.render.frame>before;
  }
  const currentLightingState=()=>lightingState(lighting,frameSubmitted&&!renderer.getContext().isContextLost());
  function positionCamera(){if(captureView?.pose){applyCapturePose(camera,captureView.pose);return;}camera.position.set(focus.x,24,focus.z+18);camera.lookAt(focus);camera.updateMatrixWorld(true);}
  function fit(){const width=captureView?.width??Math.max(host.clientWidth,1),height=captureView?.height??Math.max(host.clientHeight,1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
  fit();positionCamera();
  const onResize=()=>fit();window.addEventListener('resize',onResize);
  function setPointer(clientX:number,clientY:number){const box=renderer.domElement.getBoundingClientRect();cursor.set((clientX-box.left)/box.width*2-1,-(clientY-box.top)/box.height*2+1);pointerInside=true;}
  function aim():Aim{
    ray.setFromCamera(cursor,camera);const point=ray.ray.intersectPlane(plane,hit);
    const entityId=pickLivingEntity(ray.intersectObjects(actors.children,true),snapshot);
    return {point:point?{x:point.x,z:point.z}:null,entityId};
  }
  function sync(next:Snapshot,id:number){snapshot=next;playerId=id;presentation.sync(next);battlefield.sync(next);effects.sync(next);impacts.sync(next);health.sync(next,actors,id);reach.sync(next,id);controls.sync(next,actors);const player=next.heroes.find(h=>h.id===id);if(player){marker.visible=player.alive;marker.position.set(player.position.x,.04,player.position.z);}}
  function draw(seconds:number,alpha:number,render=true){
    const player=snapshot?.heroes.find(hero=>hero.id===playerId);
    // While playing, actions share the snapshot interpolation clock. After the
    // terminal snapshot, cosmetic tails may finish without advancing simulation.
    presentation.advance(seconds,snapshot?.status==='running'?alpha:undefined);battlefield.advance(seconds,alpha);effects.draw(alpha);impacts.draw(seconds);reach.draw(seconds);
    const playerRoot=player?presentation.root.getObjectByName(`hero-${player.id}`):null;
    if(captureView?.pose)focus.set(captureView.pose.target.x,captureView.pose.target.y,captureView.pose.target.z);
    else if(locked && playerRoot)focus.set(playerRoot.position.x,0,playerRoot.position.z);
    else if(pointerInside){const speed=24*seconds;if(cursor.x>.88)focus.x+=speed;if(cursor.x<-.88)focus.x-=speed;if(cursor.y>.88)focus.z-=speed;if(cursor.y<-.88)focus.z+=speed;}
    focus.x=THREE.MathUtils.clamp(focus.x,catalog.map.world.minX,catalog.map.world.maxX);
    focus.z=THREE.MathUtils.clamp(focus.z,catalog.map.world.minZ,catalog.map.world.maxZ);
    positionCamera();if(playerRoot&&player?.alive)marker.position.set(playerRoot.position.x,.04,playerRoot.position.z);health.draw(camera);controls.draw();
    targeting.update(player&&snapshot&&pointerInside&&targetingSlot?targetingPlan(player,targetingSlot,aim(),snapshot,catalog):null);
    light.position.set(focus.x-12,26,focus.z+12);light.target.position.copy(focus);light.target.updateMatrixWorld();
    if(render)renderScene();
  }
  return {canvas:renderer.domElement,sync,draw,aim,setPointer,
    // Explicit opt-in adapter. Ordinary clients never set it. Pre-roll still
    // advances every visual frame; renderer-only warmup never advances actors.
    setCaptureView(value:CaptureView|null){
      const next=value===null?null:copyCaptureView(value);
      if(next&&!captureView)savedFocus=focus.clone();
      captureView=next;
      if(!next){if(savedFocus)focus.copy(savedFocus);savedFocus=null;}
      if(!next?.pose)camera.fov=45;
      renderer.setPixelRatio(next?.pixelRatio??Math.min(window.devicePixelRatio,2));fit();positionCamera();
    },
    renderOnly(){renderScene();},
    captureContext(){return renderer.getContext();},
    lightingState(){return currentLightingState();},
    captureState(){return {lighting:currentLightingState(),camera:{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},target:{x:focus.x,y:focus.y,z:focus.z},fov:camera.fov,aspect:camera.aspect},viewport:{width:renderer.domElement.width/renderer.getPixelRatio(),height:renderer.domElement.height/renderer.getPixelRatio(),pixelRatio:renderer.getPixelRatio(),bufferWidth:renderer.domElement.width,bufferHeight:renderer.domElement.height},render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}};},
    effectState(){return effects.inspect();},
    motionState(){return presentation.motionState();},
    targetingState(){return targeting.inspect();},
    setTargeting(slot:AbilitySlot|null){targetingSlot=slot;if(slot===null)targeting.update(null);},
    cameraState(){return {locked,position:{x:camera.position.x,y:camera.position.y,z:camera.position.z}};},
    leavePointer(){pointerInside=false;},setLocked(value:boolean){locked=value;},
    groundPoint():Vec2|null{return aim().point;},
    dispose(){disposeOwnedRenderer(renderer,()=>{window.removeEventListener('resize',onResize);controls.dispose();statusTexture!.dispose();reach.dispose();health.dispose();effects.dispose();impacts.dispose();combatTextures?.dispose();targeting.dispose();presentation.dispose();battlefield.dispose();loadedAssets.dispose();marker.geometry.dispose();marker.material.dispose();});}
  };
}
export type GameWorld=Awaited<ReturnType<typeof createWorld>>;
