import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {Simulation} from '../../src/sim/simulation.js';
import {targetingPlan,createTargeting} from '../../src/render/targeting.js';
import {commandForCast} from '../../src/input/commands.js';
const navigation={closestPoint:(point:{x:number;z:number})=>({...point}),findPath:(start:{x:number;z:number},end:{x:number;z:number})=>({success:true,points:[start,end],reason:null})};
function fixture(version:1|8){const sim=new Simulation({seed:1,contentVersion:version,navigation});const snapshot=sim.snapshot();return {snapshot,hero:snapshot.heroes[0]!,catalog:sim.catalog};}
describe('requested skill aim from real catalog, not predicted acceptance',()=>{
  it('second requirement: the same Q changes from enemy ring to direction lane without slot-specific art',()=>{
    for(const version of [1,8] as const){
      const {snapshot,hero,catalog}=fixture(version),enemy=snapshot.entities.find(e=>e.team!==hero.team)!;
      const aim={point:{x:hero.position.x+3,z:hero.position.z+4},entityId:enemy.id};
      const plan=targetingPlan(hero,'Q',aim,snapshot,catalog)!;
      const command=commandForCast(hero,'Q',aim,snapshot,catalog);
      if(version===1){expect(plan.kind).toBe('enemyUnit');expect(plan.point).toEqual(enemy.position);expect(command).toMatchObject({targetId:enemy.id});}
      else{expect(plan.kind).toBe('direction');expect(command).toMatchObject({direction:{x:.6,z:.8}});expect(plan.point!.x-hero.position.x).toBeCloseTo(plan.length*.6);expect(plan.point!.z-hero.position.z).toBeCloseTo(plan.length*.8);}
    }
  });
  it('point preview retains the requested out-of-range position and exact ability radius',()=>{
    const {snapshot,hero,catalog}=fixture(8),point={x:100,z:100};const before=JSON.stringify(snapshot);
    const plan=targetingPlan(hero,'E',{point,entityId:null},snapshot,catalog)!;
    expect(plan).toMatchObject({kind:'point',point,outside:true,width:catalog.abilities[catalog.heroes[hero.definitionId]!.abilities.E]!.radius});
    expect(plan.point).not.toBe(point);expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('no false target for friendly unit, zero direction, nonfinite aim, death, or completed match',()=>{
    const a=fixture(1),b=fixture(8);
    expect(targetingPlan(a.hero,'Q',{point:null,entityId:a.hero.id},a.snapshot,a.catalog)!.point).toBeNull();
    expect(targetingPlan(b.hero,'Q',{point:b.hero.position,entityId:null},b.snapshot,b.catalog)!.point).toBeNull();
    expect(targetingPlan(b.hero,'E',{point:{x:NaN,z:0},entityId:null},b.snapshot,b.catalog)!.point).toBeNull();
    expect(targetingPlan({...b.hero,alive:false},'E',{point:null,entityId:null},b.snapshot,b.catalog)).toBeNull();
    expect(targetingPlan(b.hero,'E',{point:null,entityId:null},{...b.snapshot,status:'blueWin'},b.catalog)).toBeNull();
  });
  it('actual Three geometry has catalog lane width/length, no stale geometry across mode changes, and disposes once',()=>{
    const {snapshot,hero,catalog}=fixture(8),scene=new THREE.Scene(),view=createTargeting(scene);
    const plan=targetingPlan(hero,'Q',{point:{x:hero.position.x,z:hero.position.z+5},entityId:null},snapshot,catalog)!;
    view.update(plan);const line=view.root.getObjectByName('requested-target') as THREE.LineSegments;
    const positions=line.geometry.getAttribute('position');const box=new THREE.Box3();for(let i=0;i<line.geometry.drawRange.count;i++)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions,i));
    expect(box.max.z).toBeCloseTo(plan.point!.z);expect(box.min.z).toBeCloseTo(hero.position.z);
    expect(box.max.x-box.min.x).toBeCloseTo(Math.max(plan.width*2,Math.min(.8,plan.length*.2)*2));
    const geometry=line.geometry;view.update(plan);expect(line.geometry).toBe(geometry);
    view.update(targetingPlan(hero,'E',{point:{x:100,z:100},entityId:null},snapshot,catalog));
    expect(line.geometry.drawRange.count).toBe(48*2+4);
    const distances=line.geometry.getAttribute('lineDistance');expect(distances.getX(2)).toBeCloseTo(distances.getX(1));expect(distances.getX(95)).toBeGreaterThan(1); // outside-range cross, not color alone
    view.update(null);expect(view.root.visible).toBe(false);
    const dispose=vi.spyOn(line.geometry,'dispose');view.dispose();view.dispose();expect(dispose).toHaveBeenCalledTimes(1);expect(scene.children).not.toContain(view.root);
  });
});
