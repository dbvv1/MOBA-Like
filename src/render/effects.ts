import * as THREE from 'three';
import type {Snapshot} from '../sim/types.js';

type Visual={root:THREE.Object3D;from:THREE.Vector3;to:THREE.Vector3;trail?:THREE.Mesh;travelled?:number};

/** Original, deterministic VFX masks; no image fetch or renderer-wide shader change.
 * Body support is the complete unit-radius collision disc. Its flank crescents
 * carry width, while the small core and rear-only trail carry travel direction.
 */
function lancetMask(kind:'body'|'trail'){
  const size=96,data=new Uint8Array(size*size*4);
  const smooth=(a:number,b:number,v:number)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/(size-1)*2-1,v=y/(size-1)*2-1,index=(y*size+x)*4;
    let alpha=0,value=1;
    if(kind==='body'){
      const radius=Math.hypot(u,v),inside=1-smooth(.97,1,radius);
      const flank=Math.pow(Math.abs(u)/Math.max(.001,radius),4);
      const rim=Math.exp(-Math.pow((radius-.86)/.06,2))*(.58*flank);
      const flow=Math.exp(-Math.pow(u/(.18+.11*(1-v)),2))*Math.exp(-Math.pow((v-.28)/.7,2));
      const energy=inside*(.035*Math.max(0,1-radius)+rim+.22*flow);
      // A narrow, team-tinted dark edge separates the true flanks from the
      // pale road; the adjacent bright inner edge is its dark-ground counterpart.
      // Both stay inside the collision disc; the central flow is unchanged.
      const edge=inside*Math.exp(-Math.pow((radius-.945)/.045,2))*(.74*flank);
      const backing=edge*(1-energy);alpha=energy+backing;
      // Precompose these two values into the one existing straight-alpha
      // map: no extra draw/layer, opaque plate, or renderer-wide blending.
      value=alpha>0?(energy+.025*backing)/alpha:1;
    }else{
      // v=+1 is the leading end, v=-1 the trailing end. Zero at every
      // texture edge avoids a visible rectangular card on the bright road.
      const length=(v+1)/2,spread=.10+.54*(1-length);
      alpha=Math.exp(-Math.pow(u/spread,2)*2.5)*Math.pow(length,1.5)*(1-smooth(.88,1,length))*.65;
    }
    data[index]=data[index+1]=data[index+2]=Math.round(value*255);data[index+3]=Math.round(THREE.MathUtils.clamp(alpha,0,1)*255);
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.name=`lancet-${kind}-soft-mask`;
  texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}

// Live snapshot entities only: removal is not interpreted as a hit or explosion.
export function createEffects(scene:THREE.Scene){
  const root=new THREE.Group();root.name='snapshot-effects';scene.add(root);
  const projectileGeometry=new THREE.OctahedronGeometry(1);
  const headingGeometry=new THREE.ConeGeometry(.3,.8,3);
  const lancetBodyGeometry=new THREE.PlaneGeometry(2,2);lancetBodyGeometry.rotateX(Math.PI/2);
  // Authored one-unit tail: local z in [-1,0], never in front of the head.
  const lancetTrailGeometry=new THREE.PlaneGeometry(2,1);lancetTrailGeometry.rotateX(Math.PI/2);lancetTrailGeometry.translate(0,-.025,-.5);
  const lancetBodyMask=lancetMask('body'),lancetTrailMask=lancetMask('trail');
  const lancetMaterials=[0x74e3dc,0xf37e88].map(color=>({
    body:new THREE.MeshBasicMaterial({color,map:lancetBodyMask,transparent:true,opacity:1,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false}),
    trail:new THREE.MeshBasicMaterial({color,map:lancetTrailMask,transparent:true,opacity:.7,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false}),
    core:new THREE.MeshBasicMaterial({color:color===0x74e3dc?0xd9fff0:0xffe0c9,transparent:true,opacity:.92,depthWrite:false,toneMapped:false}),
  }));
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
  const materials=[0x70d9ff,0xf45b67].map(color=>({
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
      const to=new THREE.Vector3(entity.position.x,entity.basicAttack?(entity.basicAttack.sourceKind==='structure'?4.3:entity.basicAttack.sourceKind==='hero'?1.2:.7):entity.width+.1,entity.position.z);
      if(entity.basicAttack&&visual){
        // Cosmetic vertical pursuit follows the same 2D flight, connecting the
        // launch socket to the selected target rather than vanishing overhead.
        const target=snapshot.entities.find(value=>value.id===entity.basicAttack!.targetId);
        if(target){
          const targetY=target.kind==='hero'?1.2:target.kind==='structure'?2:.7;
          const gap=Math.hypot(target.position.x-visual.to.x,target.position.z-visual.to.z);
          const travel=Math.hypot(to.x-visual.to.x,to.z-visual.to.z);
          to.y=visual.to.y+(targetY-visual.to.y)*Math.min(1,travel/Math.max(.001,gap));
        }else to.y=visual.to.y;
      }
      if(!visual){
        const group=new THREE.Group();group.name=`projectile-${entity.id}`;
        if(entity.abilityId==='veyra.q'&&!entity.basicAttack){
          const palette=lancetMaterials[entity.team]!;
          const body=new THREE.Mesh(lancetBodyGeometry,palette.body);body.name='lancet-energy-body';
          const core=new THREE.Mesh(projectileGeometry,palette.core);core.name='lancet-head';core.scale.set(.16,.12,.46);core.position.z=.26;
          const trail=new THREE.Mesh(lancetTrailGeometry,palette.trail);trail.name='lancet-direction-trail';trail.visible=false;trail.scale.set(.38,1,0);
          group.add(body,core,trail);group.userData['delivery']='lancet';group.userData['collisionRadius']=entity.width;
          visual={root:group,from:to.clone(),to:to.clone(),trail,travelled:0};
        }else{
          const heading=new THREE.Mesh(headingGeometry,materials[entity.team]!.projectile);heading.rotation.x=Math.PI/2;heading.position.z=1.4;
          const body=new THREE.Mesh(projectileGeometry,materials[entity.team]!.projectile);
          if(entity.basicAttack){body.scale.set(1,.65,2.7);heading.visible=false;group.userData['delivery']='basicAttack';}
          group.add(body,heading);visual={root:group,from:to.clone(),to:to.clone()};
        }
        projectiles.set(entity.id,visual);root.add(group);
      }else {
        if(visual.trail)visual.travelled=(visual.travelled??0)+Math.hypot(to.x-visual.to.x,to.z-visual.to.z);
        visual.from.copy(visual.to);
      }
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
  function draw(alpha=1){
    assertOpen();if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('Effects alpha must be in [0,1]');
    for(const visual of projectiles.values()){
      visual.root.position.lerpVectors(visual.from,visual.to,alpha);
      if(visual.trail){
        const lastStep=Math.hypot(visual.to.x-visual.from.x,visual.to.z-visual.from.z);
        const distance=Math.max(0,(visual.travelled??0)-lastStep*(1-alpha));
        // Length follows only positions actually observed, never a predicted
        // hit or a persistent smoke ribbon. Root scale remains the real radius.
        visual.trail.scale.z=Math.min(2.1,distance/visual.root.scale.z);visual.trail.visible=distance>.02;
      }
    }
  }
  return {root,sync,draw,reset,inspect(){return root.children.map(object=>{
    let meshes=0;object.traverse(node=>{if((node as THREE.Mesh).isMesh)meshes++;});
    return {name:object.name,visible:root.parent===scene&&root.visible&&object.visible,meshes,position:{x:object.position.x,y:object.position.y,z:object.position.z}};
  });},dispose(){
    if(disposed)return;reset();scene.remove(root);
    projectileGeometry.dispose();headingGeometry.dispose();warningGeometry.dispose();zoneGeometry.dispose();outlineGeometry.dispose();
    lancetBodyGeometry.dispose();lancetTrailGeometry.dispose();lancetBodyMask.dispose();lancetTrailMask.dispose();
    for(const team of lancetMaterials)for(const material of Object.values(team))material.dispose();
    for(const team of materials)for(const material of Object.values(team))material.dispose();disposed=true;
  }};
}
