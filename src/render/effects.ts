import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';

type Visual={root:THREE.Object3D;from:THREE.Vector3;to:THREE.Vector3};

// Live snapshot entities only: removal is not interpreted as a hit or explosion.
export function createEffects(scene:THREE.Scene){
  const root=new THREE.Group();root.name='snapshot-effects';scene.add(root);
  const projectileGeometry=new THREE.OctahedronGeometry(1);
  const headingGeometry=new THREE.ConeGeometry(.3,.8,3);
  const warningGeometry=new THREE.BufferGeometry();
  const vertices:number[]=[];
  for(let i=0;i<32;i++){
    const a=i/32*Math.PI*2,b=(i+.65)/32*Math.PI*2;
    const point=(angle:number,r:number)=>[Math.cos(angle)*r,Math.sin(angle)*r,0];
    vertices.push(...point(a,.95),...point(a,1),...point(b,1),...point(a,.95),...point(b,1),...point(b,.95));
  }
  warningGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const zoneGeometry=new THREE.CircleGeometry(1,48);
  const outlineGeometry=new THREE.RingGeometry(.97,1,48);
  const materials=[0x70d9ff,0xffbd60].map(color=>({
    projectile:new THREE.MeshBasicMaterial({color}),
    fill:new THREE.MeshBasicMaterial({color,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}),
    outline:new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthWrite:false})
  }));
  const projectiles=new Map<number,Visual>(),zones=new Map<number,Visual>(),warnings=new Map<number,Visual>();
  let tick:number|null=null,disposed=false;
  function assertOpen(){if(disposed)throw new Error('Effects disposed');}
  function reset(){assertOpen();projectiles.clear();zones.clear();warnings.clear();root.clear();tick=null;}
  function sync(snapshot:Snapshot){
    assertOpen();
    if(!Number.isInteger(snapshot.tick)||snapshot.tick<0)throw new Error('Invalid effects tick');
    if(tick!==null&&snapshot.tick<tick)throw new Error('Reset effects before rewinding');
    if(snapshot.tick===tick)return;
    const seenProjectiles=new Set<number>(),seenZones=new Set<number>(),seenWarnings=new Set<number>();
    for(const entity of snapshot.projectiles){
      seenProjectiles.add(entity.id);let visual=projectiles.get(entity.id);
      const to=new THREE.Vector3(entity.position.x,entity.width+.1,entity.position.z);
      if(!visual){
        const group=new THREE.Group();group.name=`projectile-${entity.id}`;
        const heading=new THREE.Mesh(headingGeometry,materials[entity.team]!.projectile);heading.rotation.x=Math.PI/2;heading.position.z=1.4;
        group.add(new THREE.Mesh(projectileGeometry,materials[entity.team]!.projectile),heading);
        visual={root:group,from:to.clone(),to:to.clone()};projectiles.set(entity.id,visual);root.add(group);
      }else visual.from.copy(visual.to);
      visual.to.copy(to);visual.root.position.copy(to);visual.root.userData['abilityId']=entity.abilityId;
      // Simulation width is its swept collision radius; the extra arrow is a heading marker only.
      visual.root.scale.setScalar(entity.width);visual.root.rotation.y=Math.atan2(entity.direction.x,entity.direction.z);
    }
    for(const entity of snapshot.zones){
      seenZones.add(entity.id);let visual=zones.get(entity.id);
      const to=new THREE.Vector3(entity.position.x,.055,entity.position.z);
      if(!visual){
        const group=new THREE.Group();group.name=`zone-${entity.id}`;group.rotation.x=-Math.PI/2;
        group.add(new THREE.Mesh(zoneGeometry,materials[entity.team]!.fill),new THREE.Mesh(outlineGeometry,materials[entity.team]!.outline));
        visual={root:group,from:to.clone(),to:to.clone()};zones.set(entity.id,visual);root.add(group);
      }
      visual.from.copy(to);visual.to.copy(to);visual.root.position.copy(to);visual.root.scale.setScalar(entity.radius);
      visual.root.userData['abilityId']=entity.abilityId;visual.root.userData['expiresTick']=entity.expiresTick;
    }
    for(const entity of snapshot.delayedAreas){
      seenWarnings.add(entity.id);let visual=warnings.get(entity.id);
      const to=new THREE.Vector3(entity.position.x,.065,entity.position.z);
      if(!visual){
        const mesh=new THREE.Mesh(warningGeometry,materials[entity.team]!.outline);mesh.name=`warning-${entity.id}`;mesh.rotation.x=-Math.PI/2;
        visual={root:mesh,from:to.clone(),to:to.clone()};warnings.set(entity.id,visual);root.add(mesh);
      }
      visual.root.position.copy(to);visual.root.scale.setScalar(entity.radius);
      visual.root.userData['abilityId']=entity.abilityId;visual.root.userData['triggerTick']=entity.triggerTick;
    }
    for(const [id,visual] of warnings)if(!seenWarnings.has(id)){root.remove(visual.root);warnings.delete(id);}
    for(const [id,visual] of projectiles)if(!seenProjectiles.has(id)){root.remove(visual.root);projectiles.delete(id);}
    for(const [id,visual] of zones)if(!seenZones.has(id)){root.remove(visual.root);zones.delete(id);}
    tick=snapshot.tick;
  }
  function draw(alpha=1){assertOpen();if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('Effects alpha must be in [0,1]');for(const visual of projectiles.values())visual.root.position.lerpVectors(visual.from,visual.to,alpha);}
  return {root,sync,draw,reset,dispose(){
    if(disposed)return;reset();scene.remove(root);
    projectileGeometry.dispose();headingGeometry.dispose();warningGeometry.dispose();zoneGeometry.dispose();outlineGeometry.dispose();
    for(const team of materials)for(const material of Object.values(team))material.dispose();disposed=true;
  }};
}
