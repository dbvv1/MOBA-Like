import * as THREE from 'three';
import {createPresentation,loadCharacterAssets,disposeCharacterAssets,type Presentation,type CharacterAssets} from '../../asset-pipeline/presentation/adapter.js';
import type {ContentCatalog,Vec2} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';
import type {Aim} from '../input/commands.js';
import {createHealthBars} from './health.js';

export async function createWorld(host:HTMLElement,catalog:ContentCatalog){
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}
  catch{throw new Error('WebGL 2 is unavailable. This client needs a working Three.js/WebGL renderer; no 2D substitute is used.');}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#10222b');
  const camera=new THREE.PerspectiveCamera(45,1,.1,200);
  const focus=new THREE.Vector3(0,0,0);
  scene.add(new THREE.HemisphereLight('#e6f5ff','#5e5a3d',2.4));
  const light=new THREE.DirectionalLight('#ffefd1',3);light.position.set(5,12,6);scene.add(light);
  let assets:CharacterAssets|undefined,view:Presentation|undefined;
  try{assets=await loadCharacterAssets();view=createPresentation({catalog,assets});}
  catch(error){if(assets)disposeCharacterAssets(assets);renderer.dispose();throw error;}
  const loadedAssets=assets, presentation=view;
  scene.add(presentation.root);const health=createHealthBars(scene);host.replaceChildren(renderer.domElement);renderer.domElement.tabIndex=0;
  const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
  const cursor=new THREE.Vector2(0,0);let pointerInside=false;let locked=true;let snapshot:Snapshot|null=null;let playerId:number|null=null;
  const marker=new THREE.Mesh(new THREE.RingGeometry(.65,.8,32),new THREE.MeshBasicMaterial({color:'#f5f0ae',side:THREE.DoubleSide,depthWrite:false}));
  marker.rotation.x=-Math.PI/2;marker.position.y=.04;scene.add(marker);
  function positionCamera(){camera.position.set(focus.x,24,focus.z+18);camera.lookAt(focus);camera.updateMatrixWorld(true);}
  function fit(){const width=Math.max(host.clientWidth,1),height=Math.max(host.clientHeight,1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
  fit();positionCamera();
  const onResize=()=>fit();window.addEventListener('resize',onResize);
  function setPointer(clientX:number,clientY:number){const box=renderer.domElement.getBoundingClientRect();cursor.set((clientX-box.left)/box.width*2-1,-(clientY-box.top)/box.height*2+1);pointerInside=true;}
  function aim():Aim{
    ray.setFromCamera(cursor,camera);const point=ray.ray.intersectPlane(plane,hit);
    let entityId:number|null=null;
    for(const intersection of ray.intersectObjects(presentation.root.children,true)){
      let node:THREE.Object3D|null=intersection.object;
      // Raycaster may intersect invisible ancestors: ignore hidden actors.
      let visible=true;for(let parent:THREE.Object3D|null=node;parent;parent=parent.parent)if(!parent.visible)visible=false;
      if(!visible)continue;
      while(node){const id:unknown=node.userData['simEntityId'];if(typeof id==='number'){entityId=id;break;}node=node.parent;}
      if(entityId!==null)break;
    }
    return {point:point?{x:point.x,z:point.z}:null,entityId};
  }
  function sync(next:Snapshot,id:number){snapshot=next;playerId=id;presentation.sync(next);health.sync(next,presentation.root);const player=next.heroes.find(h=>h.id===id);if(player){marker.visible=player.alive;marker.position.set(player.position.x,.04,player.position.z);}}
  function draw(seconds:number,alpha:number){
    const player=snapshot?.heroes.find(hero=>hero.id===playerId);
    presentation.advance(seconds,alpha);
    const playerRoot=player?presentation.root.getObjectByName(`hero-${player.id}`):null;
    if(locked && playerRoot)focus.set(playerRoot.position.x,0,playerRoot.position.z);
    else if(pointerInside){const speed=24*seconds;if(cursor.x>.88)focus.x+=speed;if(cursor.x<-.88)focus.x-=speed;if(cursor.y>.88)focus.z-=speed;if(cursor.y<-.88)focus.z+=speed;}
    focus.x=THREE.MathUtils.clamp(focus.x,catalog.map.world.minX,catalog.map.world.maxX);
    focus.z=THREE.MathUtils.clamp(focus.z,catalog.map.world.minZ,catalog.map.world.maxZ);
    positionCamera();if(playerRoot&&player?.alive)marker.position.set(playerRoot.position.x,.04,playerRoot.position.z);health.draw(camera);renderer.render(scene,camera);
  }
  return {canvas:renderer.domElement,sync,draw,aim,setPointer,
    cameraState(){return {locked,position:{x:camera.position.x,y:camera.position.y,z:camera.position.z}};},
    leavePointer(){pointerInside=false;},setLocked(value:boolean){locked=value;},
    groundPoint():Vec2|null{return aim().point;},
    dispose(){window.removeEventListener('resize',onResize);health.dispose();presentation.dispose();disposeCharacterAssets(loadedAssets);marker.geometry.dispose();marker.material.dispose();renderer.dispose();renderer.domElement.remove();}
  };
}
export type GameWorld=Awaited<ReturnType<typeof createWorld>>;
