import * as THREE from 'three';
import type {CombatTextures} from './combat-textures.js';
import type {Snapshot} from '../sim/types.js';
/** Contact effects follow authoritative hits, including lethal minion cleanup. */
export function createImpacts(scene:THREE.Scene,textures?:CombatTextures){
  const root=new THREE.Group();root.name='battle-feedback';scene.add(root);
  const geometry=new THREE.RingGeometry(.62,1,20),swingGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,1)]);
  // Legacy instant attacks keep their whole release streak. v11 uses only a
  // short source cue here; the authoritative travelling projectile is in effects.
  // Two narrow geometric layers stay legible where a one-pixel line disappears.
  function streakGeometry(color:number){
    const positions:number[]=[],colors:number[]=[];
    function layer(width:number,y:number,tint:number){
      const c=new THREE.Color(tint),points=[[-width/2,y,0],[width/2,y,0],[width*.16,y,.86],[-width*.16,y,.86],[0,y,1]];
      for(const index of [0,1,2,0,2,3,3,2,4]){positions.push(...points[index]!);colors.push(c.r,c.g,c.b);}
    }
    layer(.16,0,0x203b36);layer(.075,.004,color);
    const value=new THREE.BufferGeometry();value.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));value.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return value;
  }
  const texturedStreak=new THREE.PlaneGeometry(.75,1);texturedStreak.rotateX(Math.PI/2);texturedStreak.translate(0,0,.5);
  const heroStreaks=[streakGeometry(0xd8fff0),streakGeometry(0xffd0af)];
  type Burst={object:THREE.Object3D;material:THREE.Material;age:number;duration:number;drawn:boolean};const bursts:Burst[]=[];
  let tick=-1,ordinal=-1;
  function remove(burst:Burst){root.remove(burst.object);burst.material.dispose();}
  function sync(snapshot:Snapshot){
    const deaths=new Map(snapshot.events.filter(event=>event.type==='minionDied').map(event=>[event.entityId,event]));
    function endpoint(id:number){
      const live=snapshot.entities.find(entity=>entity.id===id);if(live)return live;
      const dead=deaths.get(id);return dead?{kind:'minion' as const,team:dead.team,position:dead.position}:undefined;
    }
    for(const event of snapshot.events){
      if(event.tick<tick||(event.tick===tick&&event.ordinal<=ordinal))continue;tick=event.tick;ordinal=event.ordinal;
      if(event.type==='heroDamaged'||event.type==='basicAttackHit'){
        if(event.type==='heroDamaged'&&event.abilityId===null&&snapshot.events.some(hit=>hit.type==='basicAttackHit'&&hit.sourceId===event.sourceId&&hit.targetId===event.targetId))continue;
        const target=event.type==='basicAttackHit'?{position:event.position,team:event.targetTeam}:snapshot.entities.find(entity=>entity.id===event.targetId);if(!target)continue;
        const shield=event.hpDamage<=0,color=shield?0x95e1ee:target.team===0?0xfff0bd:0xffb39a;
        const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false});
        const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.set(target.position.x,.15,target.position.z);root.add(mesh);
        if(bursts.length>=48){const old=bursts.shift();if(old)remove(old);}
        bursts.push({object:mesh,material,age:0,drawn:false,duration:shield?.3:.2});
      }else if(event.type==='basicAttack'){
        const source=endpoint(event.sourceId),target=endpoint(event.targetId);
        if(!source||!target)continue;
        const tower=source.kind==='structure'&&source.structureKind==='tower';
        const hero=source.kind==='hero';
        const material=hero?new THREE.MeshBasicMaterial({vertexColors:!textures,color:textures?(source.team===0?0xc5fff0:0xffc5a0):0xffffff,map:textures?.release??null,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}):new THREE.LineBasicMaterial({color:tower?0xffb36a:source.team===0?0xbce8ce:0xf4b29a,transparent:true,opacity:.65,depthWrite:false});
        const line=hero?new THREE.Mesh(textures?texturedStreak:heroStreaks[source.team]!,material):new THREE.Line(swingGeometry,material),dx=target.position.x-source.position.x,dz=target.position.z-source.position.z;
        line.name=hero?'hero-release-streak':'unit-release-trail';
        const startY=source.kind==='structure'?4.3:source.kind==='hero'?1.2:.7;
        const endY=target.kind==='hero'?1.2:target.kind==='structure'?2:.7;
        line.position.set(source.position.x,startY,source.position.z);line.lookAt(target.position.x,endY,target.position.z);line.scale.z=event.delivery==='projectile'?.8:Math.hypot(dx,dz,endY-startY);root.add(line);
        if(bursts.length>=48){const old=bursts.shift();if(old)remove(old);}
        bursts.push({object:line,material,age:0,drawn:false,duration:tower?.22:hero?.16:.10});
      }
    }
  }
  return {sync,draw(seconds:number){for(let i=bursts.length-1;i>=0;i--){const b=bursts[i]!;if(b.drawn)b.age+=Math.min(Math.max(seconds,0),.1);else b.drawn=true;if(b.age>=b.duration){remove(b);bursts.splice(i,1);continue;}const remaining=1-b.age/b.duration;(b.material as THREE.MeshBasicMaterial).opacity=remaining*.8;if((b.object as THREE.Mesh).isMesh&&b.object.name!=='hero-release-streak')b.object.scale.setScalar(.6+b.age*3);}},dispose(){for(const b of bursts)remove(b);bursts.length=0;scene.remove(root);geometry.dispose();swingGeometry.dispose();texturedStreak.dispose();for(const value of heroStreaks)value.dispose();}};
}
