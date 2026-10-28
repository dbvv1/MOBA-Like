import * as THREE from 'three';
import type {ContentCatalog} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';

/** Reach is not aggro: only committed basicAttack events cause the fire flash. */
export function towerReach(snapshot:Snapshot,playerId:number,catalog:ContentCatalog){
  const hero=snapshot.heroes.find(value=>value.id===playerId);
  if(!hero?.alive||snapshot.status!=='running')return [];
  const radius=snapshot.entities.find(value=>value.id===playerId)?.radius??0;
  return snapshot.entities.flatMap(entity=>{
    if(!entity.alive||entity.team===hero.team||entity.kind!=='structure'||entity.structureKind!=='tower')return [];
    const definition=catalog.map.structures.find(value=>value.team===entity.team&&value.kind==='tower'&&value.name===entity.name);
    if(!definition)return [];
    const reach=definition.attackRange+radius,distance=Math.hypot(hero.position.x-entity.position.x,hero.position.z-entity.position.z);
    if(distance>reach+5)return [];
    return [{id:entity.id,position:{...entity.position},radius:reach,inside:distance<=reach,firedAtPlayer:snapshot.events.some(event=>event.type==='basicAttack'&&event.sourceId===entity.id&&event.targetId===playerId)}];
  });
}
export function createTowerReach(scene:THREE.Scene,catalog:ContentCatalog){
  const root=new THREE.Group();root.name='tower-reach-boundaries';scene.add(root);
  const geometry=new THREE.BufferGeometry();const vertices:number[]=[];const backingVertices:number[]=[];
  for(let i=0;i<64;i++){
    const a=i/64*Math.PI*2,b=(i+.55)/64*Math.PI*2;
    const stroke=(angle:number,r:number)=>[Math.cos(angle)*r,0,Math.sin(angle)*r];
    vertices.push(...stroke(a,.997),...stroke(b,.997),...stroke(b,1.003),...stroke(a,.997),...stroke(b,1.003),...stroke(a,1.003));
    const point=(angle:number,r:number)=>[Math.cos(angle)*r,-.003,Math.sin(angle)*r];
    backingVertices.push(...point(a,.994),...point(b,.994),...point(b,1.006),...point(a,.994),...point(b,1.006),...point(a,1.006));
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  // Thin dark backing keeps the same unfilled reach dashes readable on light road and dark grass.
  const backingGeometry=new THREE.BufferGeometry();backingGeometry.setAttribute('position',new THREE.Float32BufferAttribute(backingVertices,3));
  const backingMaterial=new THREE.MeshBasicMaterial({color:0x18372d,side:THREE.DoubleSide,depthWrite:false});
  const rings=new Map<number,{line:THREE.Mesh;material:THREE.MeshBasicMaterial;flash:number;inside:boolean}>();let lastTick=-1;
  function sync(snapshot:Snapshot,playerId:number){
    if(snapshot.tick===lastTick)return;lastTick=snapshot.tick;const seen=new Set<number>();
    for(const reach of towerReach(snapshot,playerId,catalog)){
      seen.add(reach.id);let ring=rings.get(reach.id);
      if(!ring){const material=new THREE.MeshBasicMaterial({color:0xffe2a6,side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false});const line=new THREE.Mesh(geometry,material);line.name=`tower-reach-${reach.id}`;const backing=new THREE.Mesh(backingGeometry,backingMaterial);backing.name='reach-dash-contrast';backing.renderOrder=3;line.renderOrder=4;line.add(backing);root.add(line);ring={line,material,flash:0,inside:false};rings.set(reach.id,ring);}
      ring.line.position.set(reach.position.x,.075,reach.position.z);ring.line.scale.set(reach.radius,1,reach.radius);ring.inside=reach.inside;
      if(reach.firedAtPlayer)ring.flash=.35;
    }
    for(const[id,ring]of rings)if(!seen.has(id)){root.remove(ring.line);ring.material.dispose();rings.delete(id);}
  }
  return{root,sync,draw(seconds:number){for(const ring of rings.values()){ring.flash=Math.max(0,ring.flash-Math.max(0,Math.min(seconds,.1)));ring.material.color.setHex(ring.flash>0?0xff654f:0xffe2a6);ring.material.opacity=ring.flash>0?1:ring.inside?1:.85;}},dispose(){for(const ring of rings.values())ring.material.dispose();rings.clear();root.clear();scene.remove(root);geometry.dispose();backingGeometry.dispose();backingMaterial.dispose();}};
}
