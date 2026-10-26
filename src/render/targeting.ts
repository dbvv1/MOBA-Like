import * as THREE from 'three';
import type {AbilitySlot,ContentCatalog,Vec2} from '../content/types.js';
import type {HeroSnapshot,Snapshot} from '../sim/types.js';
import type {Aim} from '../input/commands.js';
import {commandForCast,validPoint} from '../input/commands.js';

// Requested aim only, never a promise of navigation snapping, hit, or cast acceptance.
export function targetingPlan(hero:HeroSnapshot,slot:AbilitySlot,aim:Aim,snapshot:Snapshot,catalog:ContentCatalog){
  const definition=catalog.heroes[hero.definitionId];
  const ability=definition&&catalog.abilities[definition.abilities[slot]];
  if(!ability||ability.targetType==='self'||!hero.alive||snapshot.status!=='running')return null;
  const origin={...hero.position},command=commandForCast(hero,slot,aim,snapshot,catalog);
  let point:Vec2|null=null,width=0,length=0,outside=false;
  if(ability.targetType==='enemyUnit'){
    const target=snapshot.entities.find(entity=>entity.id===aim.entityId&&entity.alive&&entity.team!==hero.team);
    if(target){point={...target.position};width=target.radius;outside=Math.hypot(point.x-origin.x,point.z-origin.z)>ability.range+target.radius;}
  }else if(ability.targetType==='point'&&validPoint(aim.point)){
    point={...aim.point};width=ability.radius;outside=Math.hypot(point.x-origin.x,point.z-origin.z)>ability.range;
  }else if(command?.type==='cast'&&command.direction){
    length=ability.maxDistance||ability.range;width=ability.width;
    point={x:origin.x+command.direction.x*length,z:origin.z+command.direction.z*length};
  }
  return {kind:ability.targetType,origin,range:ability.range,point,width,length,outside};
}

export function createTargeting(scene:THREE.Scene){
  const root=new THREE.Group();root.name='skill-targeting-preview';root.visible=false;scene.add(root);
  const material=new THREE.LineDashedMaterial({color:0xf5f0ae,dashSize:.28,gapSize:.18,depthTest:false,transparent:true,opacity:.85});
  const danger=new THREE.LineDashedMaterial({color:0xffa36f,dashSize:.28,gapSize:.18,depthTest:false,transparent:true,opacity:.85});
  const make=(name:string)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(300),3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('lineDistance',new THREE.BufferAttribute(new Float32Array(100),1).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);const line=new THREE.LineSegments(geometry,material);line.frustumCulled=false;line.name=name;line.renderOrder=5;root.add(line);return line;};
  const range=make('cast-range'),target=make('requested-target');
  function segments(line:THREE.LineSegments,values:number[]){
    const positions=line.geometry.getAttribute('position') as THREE.BufferAttribute,distances=line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute;
    (positions.array as Float32Array).fill(0);(positions.array as Float32Array).set(values);
    let distance=0;
    for(let i=0;i<values.length;i+=6){distances.setX(i/3,distance);distance+=Math.hypot(values[i+3]!-values[i]!,values[i+4]!-values[i+1]!,values[i+5]!-values[i+2]!);distances.setX(i/3+1,distance);}
    positions.needsUpdate=true;distances.needsUpdate=true;line.geometry.setDrawRange(0,values.length/3);
  }
  function ring(x:number,z:number,r:number){const values:number[]=[];for(let i=0;i<48;i++){const a=i/48*Math.PI*2,b=(i+1)/48*Math.PI*2;values.push(x+Math.cos(a)*r,.09,z+Math.sin(a)*r,x+Math.cos(b)*r,.09,z+Math.sin(b)*r);}return values;}
  let key='',disposed=false;
  return {root,update(plan:ReturnType<typeof targetingPlan>){
    if(disposed)throw new Error('Targeting disposed');
    root.visible=plan!==null;if(!plan){key='';return;}
    const next=JSON.stringify(plan);if(next===key)return;key=next;
    segments(range,ring(plan.origin.x,plan.origin.z,plan.range));target.visible=plan.point!==null;
    if(!plan.point)return;
    const p=plan.point,o=plan.origin;let values:number[];
    if(plan.kind==='direction'){
      const dx=(p.x-o.x)/plan.length,dz=(p.z-o.z)/plan.length,w=plan.width;
      const a={x:o.x-dz*w,z:o.z+dx*w},b={x:o.x+dz*w,z:o.z-dx*w},c={x:p.x-dz*w,z:p.z+dx*w},d={x:p.x+dz*w,z:p.z-dx*w};
      values=[a.x,.1,a.z,c.x,.1,c.z,b.x,.1,b.z,d.x,.1,d.z,c.x,.1,c.z,d.x,.1,d.z,o.x,.1,o.z,p.x,.1,p.z];
      const size=Math.min(.8,plan.length*.2);values.push(p.x-dx*size-dz*size,.1,p.z-dz*size+dx*size,p.x,.1,p.z,p.x-dx*size+dz*size,.1,p.z-dz*size-dx*size,p.x,.1,p.z);
    }else{
      values=ring(p.x,p.z,Math.max(plan.width,.15));
      // Cross distinguishes outside-range aim without relying on color alone.
      if(plan.outside)values.push(p.x-.35,.1,p.z-.35,p.x+.35,.1,p.z+.35,p.x-.35,.1,p.z+.35,p.x+.35,.1,p.z-.35);
    }
    target.material=plan.outside?danger:material;segments(target,values);
  },inspect(){return {visible:root.parent===scene&&root.visible,lines:root.children.map(object=>{const line=object as THREE.LineSegments;return {name:line.name,visible:line.visible,vertices:line.geometry.drawRange.count};})};},dispose(){if(disposed)return;disposed=true;scene.remove(root);range.geometry.dispose();target.geometry.dispose();material.dispose();danger.dispose();}};
}
