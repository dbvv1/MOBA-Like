import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {makeSim,hero,place,perform} from '../helpers.js';
import {createEffects} from '../../src/render/effects.js';

async function flight(){
  const sim=await makeSim(11),source=hero(sim,0),target=hero(sim,1);place(source,{x:-8,z:0});place(target,{x:8,z:6});
  perform(sim,{type:'cast',heroId:source.id,slot:'Q',targetId:null,direction:{x:1,z:0},point:null});
  while(sim.snapshot().projectiles.length===0)sim.step([]);
  return sim;
}
function textureOf(mesh:THREE.Mesh){return (mesh.material as THREE.MeshBasicMaterial).map as THREE.DataTexture;}

describe('Veyra Q directional energy rendering (not visual quality acceptance)',()=>{
  it('preserves authoritative full width, position and heading without the opaque card or separate triangle marker',async()=>{
    const sim=await flight(),snapshot=sim.snapshot(),effects=createEffects(new THREE.Scene()),hash=sim.finalHash();effects.sync(snapshot);effects.draw(1);
    const projectile=snapshot.projectiles[0]!,group=effects.root.getObjectByName(`projectile-${projectile.id}`)!;
    expect(group.scale.toArray()).toEqual([projectile.width,projectile.width,projectile.width]);expect(group.position.x).toBe(projectile.position.x);expect(group.position.z).toBe(projectile.position.z);
    expect(group.rotation.y).toBeCloseTo(Math.atan2(projectile.direction.x,projectile.direction.z));expect(group.userData['collisionRadius']).toBe(projectile.width);
    expect(group.children.map(child=>child.name)).toEqual(['lancet-energy-body','lancet-head','lancet-direction-trail']);
    const body=group.children[0] as THREE.Mesh;body.geometry.computeBoundingBox();const bounds=body.geometry.boundingBox!;
    expect(bounds.min.x).toBe(-1);expect(bounds.max.x).toBe(1);expect(bounds.min.z).toBe(-1);expect(bounds.max.z).toBe(1);
    const material=body.material as THREE.MeshBasicMaterial;expect(material.transparent).toBe(true);expect(material.depthWrite).toBe(false);expect(material.depthTest).toBe(true);expect(material.side).toBe(THREE.DoubleSide);expect(material.forceSinglePass).toBe(true);
    const mask=textureOf(body),{width,height,data}=mask.image as {width:number;height:number;data:Uint8Array};
    const alpha=(x:number,y:number)=>data[(y*width+x)*4+3]!;let max=0,sum=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=alpha(x,y);max=Math.max(max,a);sum+=a;if(x===0||y===0||x===width-1||y===height-1)expect(a).toBe(0);}
    // Only the narrow flank edge may exceed the previous soft-shell alpha;
    // the full body must remain translucent, not return to a filled card.
    expect(max).toBeLessThan(200);expect(sum/(width*height*255)).toBeLessThan(.12);
    // Width is carried near both true flanks, not silently shrunk to the bright core.
    expect(alpha(Math.round(width*.05),Math.floor(height/2))).toBeGreaterThan(50);expect(alpha(Math.round(width*.94),Math.floor(height/2))).toBeGreaterThan(50);
    expect(sim.finalHash()).toBe(hash);expect(JSON.stringify(sim.snapshot())).toBe(JSON.stringify(snapshot));effects.dispose();
  });
  it('pairs a dark outer flank with a bright inner flank without filling or enlarging the shell',async()=>{
    const sim=await flight(),effects=createEffects(new THREE.Scene());effects.sync(sim.snapshot());
    const body=effects.root.getObjectByName('lancet-energy-body') as THREE.Mesh;
    const {width,height,data}=textureOf(body).image as {width:number;height:number;data:Uint8Array};
    const sample=(u:number,v:number)=>{const x=Math.round((u+1)/2*(width-1)),y=Math.round((v+1)/2*(height-1)),index=(y*width+x)*4;return {value:data[index]!/255,alpha:data[index+3]!/255};};
    for(const side of [-1,1]){
      const outer=sample(side*.945,0),inner=sample(side*.86,0),gap=sample(side*.6,0);
      expect(outer.alpha).toBeGreaterThan(.6);expect(outer.value).toBeLessThan(.2);
      expect(inner.alpha).toBeGreaterThan(.5);expect(inner.value).toBeGreaterThan(.9);
      expect(gap.alpha).toBeLessThan(.025);
    }
    // The new value split is neutral: the original material supplies team hue.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const index=(y*width+x)*4,radius=Math.hypot(x/(width-1)*2-1,y/(height-1)*2-1);
      expect(data[index]).toBe(data[index+1]);expect(data[index]).toBe(data[index+2]);
      if(radius>=1)expect(data[index+3]).toBe(0);
      if(radius<.7)expect(data[index+3]).toBeLessThan(66);
      if(data[index+3]!>=160)expect(radius).toBeGreaterThan(.8);
    }
    expect((body.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x74e3dc);effects.dispose();
  });
  it('keeps the short tail behind the true interpolated head and within actually observed travel',async()=>{
    const sim=await flight(),effects=createEffects(new THREE.Scene());effects.sync(sim.snapshot());effects.draw(1);
    const group=effects.root.children[0]!,trail=group.getObjectByName('lancet-direction-trail')!;expect(trail.visible).toBe(false);
    const first=sim.snapshot().projectiles[0]!;sim.step([]);const next=sim.snapshot().projectiles[0]!;effects.sync(sim.snapshot());
    const step=Math.hypot(next.position.x-first.position.x,next.position.z-first.position.z);
    for(const alpha of [0,.25,.5,1]){effects.draw(alpha);expect(trail.scale.z*group.scale.z).toBeCloseTo(step*alpha);expect(group.position.x).toBeCloseTo(first.position.x+(next.position.x-first.position.x)*alpha);}
    (trail as THREE.Mesh).geometry.computeBoundingBox();expect((trail as THREE.Mesh).geometry.boundingBox!.max.z).toBeLessThanOrEqual(0);
    for(let i=0;i<4;i++){sim.step([]);effects.sync(sim.snapshot());effects.draw(1);}
    expect(trail.scale.z).toBeLessThanOrEqual(2.1);expect(trail.scale.x).toBe(.38);
    effects.dispose();
  });
  it('does not invent launch/history or impact when starting mid-flight, expiring, resetting or becoming terminal',async()=>{
    const sim=await flight();for(let i=0;i<3;i++)sim.step([]);const snapshot=sim.snapshot(),effects=createEffects(new THREE.Scene());
    effects.sync(snapshot);effects.draw(1);expect(effects.root.getObjectByName('lancet-direction-trail')!.visible).toBe(false);
    const position=effects.root.children[0]!.position.clone();effects.sync({...snapshot,tick:snapshot.tick+1,status:'timeout'});effects.draw(1);expect(effects.root.children[0]!.position.equals(position)).toBe(true);
    effects.sync({...snapshot,tick:snapshot.tick+2,projectiles:[]});expect(effects.root.children).toHaveLength(0);
    effects.reset();effects.sync(snapshot);effects.draw(1);expect(effects.root.getObjectByName('lancet-direction-trail')!.visible).toBe(false);effects.dispose();
  });
  it('shares source masks across multiple projectiles and releases all owned resources once',async()=>{
    const sim=await flight(),snapshot=sim.snapshot(),projectile=snapshot.projectiles[0]!,scene=new THREE.Scene(),effects=createEffects(scene);
    effects.sync({...snapshot,projectiles:[projectile,{...projectile,id:projectile.id+1,team:1}]});
    const a=effects.root.children[0]!.getObjectByName('lancet-energy-body') as THREE.Mesh,b=effects.root.children[1]!.getObjectByName('lancet-energy-body') as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);expect(textureOf(a)).toBe(textureOf(b));expect((a.material as THREE.MeshBasicMaterial).color.equals((b.material as THREE.MeshBasicMaterial).color)).toBe(false);
    expect((a.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x74e3dc);expect((b.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xf37e88);
    const resources=new Set<{dispose():void}>();for(const root of effects.root.children)root.traverse(child=>{if(child instanceof THREE.Mesh){resources.add(child.geometry);const material=child.material as THREE.MeshBasicMaterial;resources.add(material);if(material.map)resources.add(material.map);}});
    const spies=[...resources].map(resource=>vi.spyOn(resource,'dispose'));effects.reset();expect(spies.every(spy=>spy.mock.calls.length===0)).toBe(true);effects.dispose();effects.dispose();expect(spies.every(spy=>spy.mock.calls.length===1)).toBe(true);expect(scene.children).toHaveLength(0);
  });
  it('leaves basic attacks and Morrow projectile representation on their existing path',async()=>{
    const sim=await flight(),snapshot=sim.snapshot(),projectile=snapshot.projectiles[0]!,effects=createEffects(new THREE.Scene());
    effects.sync({...snapshot,projectiles:[{...projectile,abilityId:'morrow.q'},{...projectile,id:projectile.id+1,abilityId:'basicAttack',basicAttack:{sourceId:9,targetId:10,sourceKind:'hero'}}]});
    expect(effects.root.children.every(group=>group.getObjectByName('lancet-energy-body')===undefined)).toBe(true);
    expect(effects.root.children[0]!.children).toHaveLength(2);expect(effects.root.children[1]!.userData['delivery']).toBe('basicAttack');effects.dispose();
  });
});
