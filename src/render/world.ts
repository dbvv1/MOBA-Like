import {createLifetime} from './lifetime.js';
import {createCameraFollow,type CameraFollowPolicy} from './camera-follow.js';
import {createContentStandards} from '../capture/content-standards.js';
import {applyQuietBuildings} from './quiet-buildings.js';
import {loadQuietFamily,type QuietTextures,type MaterialFamily} from './quiet-family.js';
import {createLightingPost} from './lighting-post.js';
import {loadTerrainTextures,type OwnedTerrainTextures} from './terrain-textures.js';
import {addEnvironmentLighting,lightingState,type LightingStyle} from './lighting-style.js';
import {loadCombatTextures,type CombatTextures} from './combat-textures.js';
import {disposeOwnedRenderer} from './owned-renderer.js';
import {createControlMarkers} from './control-state.js';
import {createTowerReach} from './tower-reach.js';
import {loadBattleAssets,type BattleAssets} from './battle-assets.js';
import {heroPresentationAssets,type HeroSource} from './hero-presentation.js';
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

export async function createWorld(host:HTMLElement,catalog:ContentCatalog,{lighting='baseline',materials='baseline',signal,cameraFollow='baseline',capture,heroSource='baseline'}:{lighting?:LightingStyle;materials?:MaterialFamily;signal?:AbortSignal;cameraFollow?:CameraFollowPolicy;capture?:CaptureView;heroSource?:HeroSource}={}){
  // Capture/quiet standards keep their pinned source, even if called directly.
  if(capture||materials==='quiet-family-v1')heroSource='baseline';
  if(signal?.aborted)throw new DOMException('World loading cancelled.','AbortError');
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:!!capture});}
  catch{throw new Error('WebGL 2 initialization is unavailable.');}
  const lifetime=createLifetime();
  lifetime.defer(()=>disposeOwnedRenderer(renderer));
  const own=<T extends {dispose():void}|undefined>(value:T):T=>{if(value)lifetime.defer(()=>value.dispose());return value;};
  const dispose=()=>{const errors=lifetime.dispose();if(errors.length)console.warn('World cleanup failed',errors);};
  try{
  renderer.setPixelRatio(capture?.pixelRatio??Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=lightingState(lighting).exposure;
  if(lighting==='forest-light-v1')renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();scene.userData['renderRole']='cue';scene.background=new THREE.Color('#304c49');scene.fog=new THREE.Fog('#304c49',75,160);
  const camera=new THREE.PerspectiveCamera(45,1,.1,200);
  const focus=new THREE.Vector3(0,0,0);
  addEnvironmentLighting(scene,lighting);
  const light=new THREE.DirectionalLight(lightingState(lighting).directSun.color,lightingState(lighting).directSun.intensity);light.position.set(10,24,12);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:70});light.shadow.bias=-.0004;light.shadow.normalBias=.035;scene.add(light,light.target);
  let combatTextures:CombatTextures|undefined,terrainTextures:OwnedTerrainTextures|undefined,quiet:QuietTextures|undefined,quietBuildings:ReturnType<typeof applyQuietBuildings>|undefined;
  let assets:BattleAssets|undefined,view:Presentation|undefined,statusTexture:THREE.Texture|undefined;
  assets=own(await loadBattleAssets(undefined,lighting,heroSource));combatTextures=own(await loadCombatTextures());quiet=await loadQuietFamily(materials,undefined,signal);if(signal?.aborted){quiet?.dispose();throw new DOMException('World loading cancelled.','AbortError');}if(quiet){try{quietBuildings=applyQuietBuildings(assets,quiet);own(quiet);own(quietBuildings);}catch{quiet.dispose();quiet=undefined;}}if(materials==='quiet-family-v1'&&!quiet)throw new Error('Quiet material family unavailable; restoring default rendering.');terrainTextures=quiet??own(await loadTerrainTextures());statusTexture=own(await new THREE.TextureLoader().loadAsync(new URL('../../asset-pipeline/icons/exported/bright/control.svg',import.meta.url).href));statusTexture.colorSpace=THREE.SRGBColorSpace;if(signal?.aborted)throw new DOMException('World loading cancelled.','AbortError');view=own(createPresentation({catalog,assets:heroPresentationAssets(assets,heroSource),heroesOnly:true}));
  const loadedAssets=assets, presentation=view;
  const battlefield=own(createBattlefield(catalog,loadedAssets,lighting,terrainTextures,quiet));const actors=new THREE.Group();actors.userData['renderRole']='world';actors.add(presentation.root,battlefield.root);
  presentation.root.traverse(object=>{if((object as THREE.Mesh).isMesh){object.castShadow=true;object.receiveShadow=true;}});
  scene.add(actors);const controls=own(createControlMarkers(scene,statusTexture!));const reach=own(createTowerReach(scene,catalog));const health=own(createHealthBars(scene));const effects=own(createEffects(scene));const impacts=own(createImpacts(scene,combatTextures));const targeting=own(createTargeting(scene));let targetingSlot:AbilitySlot|null=null;if(!capture)host.replaceChildren(renderer.domElement);renderer.domElement.tabIndex=0;
  const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
  const cursor=new THREE.Vector2(0,0);let pointerInside=false;const cameraMode=createCameraFollow(cameraFollow);let snapshot:Snapshot|null=null;let playerId:number|null=null;
  const marker=new THREE.Mesh(own(new THREE.RingGeometry(.65,.8,32)),own(new THREE.MeshBasicMaterial({color:'#d8fbff',side:THREE.DoubleSide,depthWrite:false})));
  marker.rotation.x=-Math.PI/2;marker.position.y=.04;scene.add(marker);
  let captureView:CaptureView|null=capture?copyCaptureView(capture):null,savedFocus:THREE.Vector3|null=null;
  cameraMode.setCapture(captureView!==null);
  const post=lighting==='forest-light-v1'?own(createLightingPost(renderer,scene,camera)):null;
  let standards:ReturnType<typeof createContentStandards>|null=null;
  const hiddenForStandards=new Map<THREE.Object3D,boolean>();
  lifetime.defer(()=>{standards?.dispose();hiddenForStandards.clear();});
  let frameSubmitted=false;
  function renderScene(){
    frameSubmitted=false;
    const before=renderer.info.render.frame;
    if(post)post.render();else renderer.render(scene,camera);
    // Three can return normally on context loss. A renderer frame advance is
    // submission evidence only, not shader/pixel validation.
    frameSubmitted=!renderer.getContext().isContextLost()&&renderer.info.render.frame>before;
  }
  const currentLightingState=()=>lightingState(lighting,frameSubmitted&&!renderer.getContext().isContextLost());
  function positionCamera(){if(captureView?.pose){applyCapturePose(camera,captureView.pose);return;}camera.position.set(focus.x,24,focus.z+18);camera.lookAt(focus);camera.updateMatrixWorld(true);}
  function fit(){const width=captureView?.width??Math.max(host.clientWidth,1),height=captureView?.height??Math.max(host.clientHeight,1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();post?.resize(width,height,renderer.getPixelRatio());}
  fit();positionCamera();
  const onResize=()=>fit();window.addEventListener('resize',onResize);lifetime.defer(()=>window.removeEventListener('resize',onResize));
  function setPointer(clientX:number,clientY:number){const box=renderer.domElement.getBoundingClientRect();cursor.set((clientX-box.left)/box.width*2-1,-(clientY-box.top)/box.height*2+1);pointerInside=true;}
  function aim():Aim{
    ray.setFromCamera(cursor,camera);const point=ray.ray.intersectPlane(plane,hit);
    const entityId=pickLivingEntity(ray.intersectObjects(actors.children,true),snapshot);
    return {point:point?{x:point.x,z:point.z}:null,entityId};
  }
  function sync(next:Snapshot,id:number){if(standards){snapshot=next;playerId=id;return;}snapshot=next;playerId=id;presentation.sync(next);battlefield.sync(next);effects.sync(next);impacts.sync(next);health.sync(next,actors,id);reach.sync(next,id);controls.sync(next,actors);const player=next.heroes.find(h=>h.id===id);if(player){marker.visible=player.alive;marker.position.set(player.position.x,.04,player.position.z);}}
  function draw(seconds:number,alpha:number,render=true){
    if(standards){standards.advance(seconds);positionCamera();if(captureView?.pose)focus.set(captureView.pose.target.x,captureView.pose.target.y,captureView.pose.target.z);light.position.set(focus.x-12,26,focus.z+12);light.target.position.copy(focus);light.target.updateMatrixWorld();if(render)renderScene();return;}
    const player=snapshot?.heroes.find(hero=>hero.id===playerId);
    // While playing, actions share the snapshot interpolation clock. After the
    // terminal snapshot, cosmetic tails may finish without advancing simulation.
    presentation.advance(seconds,snapshot?.status==='running'?alpha:undefined);battlefield.advance(seconds,alpha);effects.draw(alpha);impacts.draw(seconds);reach.draw(seconds);
    const playerRoot=player?presentation.root.getObjectByName(`hero-${player.id}`):null;
    if(captureView?.pose)focus.set(captureView.pose.target.x,captureView.pose.target.y,captureView.pose.target.z);
    else if(cameraMode.following && playerRoot)focus.set(playerRoot.position.x,0,playerRoot.position.z);
    else if(pointerInside){const speed=24*seconds;if(cursor.x>.88)focus.x+=speed;if(cursor.x<-.88)focus.x-=speed;if(cursor.y>.88)focus.z-=speed;if(cursor.y<-.88)focus.z+=speed;}
    focus.x=THREE.MathUtils.clamp(focus.x,catalog.map.world.minX,catalog.map.world.maxX);
    focus.z=THREE.MathUtils.clamp(focus.z,catalog.map.world.minZ,catalog.map.world.maxZ);
    positionCamera();if(playerRoot&&player?.alive)marker.position.set(playerRoot.position.x,.04,playerRoot.position.z);health.draw(camera);controls.draw();
    targeting.update(player&&snapshot&&pointerInside&&targetingSlot?targetingPlan(player,targetingSlot,aim(),snapshot,catalog):null);
    light.position.set(focus.x-12,26,focus.z+12);light.target.position.copy(focus);light.target.updateMatrixWorld();
    if(render)renderScene();
  }
  return {canvas:renderer.domElement,sync,draw,aim,setPointer,
    setContentStandards(enabled:boolean){
      if(enabled&&heroSource!=='baseline')throw new Error('Content standards require the pinned baseline hero source.');
      if(enabled&&!standards){
        if(!terrainTextures)throw Error('Standards require actual production terrain textures');
        if(materials==='quiet-family-v1'&&!quiet)throw Error('Quiet standards refused material fallback');
        const candidate=createContentStandards(loadedAssets,lighting,terrainTextures,quiet);
        for(const object of scene.children)if(!(object instanceof THREE.Light)&&object!==light.target){hiddenForStandards.set(object,object.visible);object.visible=false;}
        standards=candidate;scene.add(candidate.root);frameSubmitted=false;
      }else if(!enabled&&standards){standards.dispose();standards=null;for(const [object,visible] of hiddenForStandards)object.visible=visible;hiddenForStandards.clear();frameSubmitted=false;if(snapshot&&playerId!==null)sync({...snapshot,events:[]},playerId);}
    },
    // Explicit opt-in adapter. Ordinary clients never set it. Pre-roll still
    // advances every visual frame; renderer-only warmup never advances actors.
    setCaptureView(value:CaptureView|null){
      const next=value===null?null:copyCaptureView(value);
      if(next&&!captureView)savedFocus=focus.clone();
      captureView=next;cameraMode.setCapture(next!==null);
      if(!next){if(savedFocus)focus.copy(savedFocus);savedFocus=null;}
      if(!next?.pose)camera.fov=45;
      renderer.setPixelRatio(next?.pixelRatio??Math.min(window.devicePixelRatio,2));fit();positionCamera();
    },
    renderOnly(){renderScene();},
    captureContext(){return renderer.getContext();},
    lightingState(){return currentLightingState();},
    captureState(){return {standards:standards?{...standards.inspect(),active:frameSubmitted&&!renderer.getContext().isContextLost()}:null,materials:{requested:materials,configured:quiet?'quiet-family-v1':'baseline',active:quiet&&frameSubmitted?'quiet-family-v1':null,buildingCoverage:quietBuildings?.coverage??[]},lighting:currentLightingState(),camera:{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},target:{x:focus.x,y:focus.y,z:focus.z},fov:camera.fov,aspect:camera.aspect},viewport:{width:renderer.domElement.width/renderer.getPixelRatio(),height:renderer.domElement.height/renderer.getPixelRatio(),pixelRatio:renderer.getPixelRatio(),bufferWidth:renderer.domElement.width,bufferHeight:renderer.domElement.height},render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}};},
    effectState(){return effects.inspect();},
    motionState(){return presentation.motionState();},
    targetingState(){return targeting.inspect();},
    setTargeting(slot:AbilitySlot|null){targetingSlot=slot;if(slot===null)targeting.update(null);},
    cameraState(){return {locked:cameraMode.locked,temporaryFollow:cameraMode.held,position:{x:camera.position.x,y:camera.position.y,z:camera.position.z}};},
    leavePointer(){pointerInside=false;},setLocked(value:boolean){cameraMode.setLocked(value);},setFocusHeld(value:boolean){cameraMode.setHeld(value);},
    groundPoint():Vec2|null{return aim().point;},
    dispose
  };
  }catch(error){dispose();throw error;}
}
export type GameWorld=Awaited<ReturnType<typeof createWorld>>;
