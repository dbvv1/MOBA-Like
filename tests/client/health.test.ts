import {it,expect} from 'vitest';
import {Scene,Group,Object3D,PerspectiveCamera} from 'three';
import {Simulation} from '../../src/sim/simulation.js';
import {createHealthBars} from '../../src/render/health.js';
const navigation={closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})};
it('health geometry sits above the actual proxy top rather than adding height twice',()=>{const sim=new Simulation({seed:1,contentVersion:2,navigation});for(let i=0;i<245;i++)sim.step([]);const snapshot=sim.snapshot();const scene=new Scene(),root=new Group();scene.add(root);for(const entity of snapshot.entities){const anchor=new Object3D();anchor.name=`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`;anchor.position.set(entity.position.x,entity.kind==='hero'?0:entity.radius*(entity.kind==='minion'?.75:entity.structureKind==='barracks'?.5:1),entity.position.z);root.add(anchor);}root.updateMatrixWorld(true);const bars=createHealthBars(scene);bars.sync(snapshot,root);bars.draw(new PerspectiveCamera());for(const entity of snapshot.entities){if(!entity.alive)continue;const bar=scene.getObjectByName(`health-${entity.id}`)!;const expected=entity.kind==='hero'?2.5:entity.radius*(entity.kind==='minion'?1.5:entity.structureKind==='barracks'?1:2)+.5;expect(bar.position.y).toBeCloseTo(expected);}bars.dispose();expect(scene.children).toEqual([root]);});
it('keeps hero and player health readable above smaller troop bars without changing HP ratios',()=>{
  const sim=new Simulation({seed:1,contentVersion:8,navigation});
  for(let i=0;i<245;i++)sim.step([]);
  const snapshot=sim.snapshot(),scene=new Scene(),root=new Group();scene.add(root);
  for(const entity of snapshot.entities){const anchor=new Object3D();anchor.name=`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`;root.add(anchor);}
  const player=snapshot.heroes[0]!,enemy=snapshot.heroes[1]!,troop=snapshot.entities.find(e=>e.kind==='minion'&&e.alive)!;
  expect(troop).toBeDefined();const bars=createHealthBars(scene);bars.sync(snapshot,root,player.id);
  const marker=(id:number)=>scene.getObjectByName(`health-${id}`)!;
  const part=(id:number,name:string)=>marker(id).getObjectByName(name)!;
  expect(part(player.id,'health-background').scale.x).toBeGreaterThan(part(troop.id,'health-background').scale.x*2);
  expect(part(enemy.id,'health-fill').renderOrder).toBeGreaterThan(part(troop.id,'health-fill').renderOrder);
  expect(part(player.id,'health-background').renderOrder).toBeGreaterThan(part(enemy.id,'health-fill').renderOrder);
  const hurt={...snapshot,entities:snapshot.entities.map(e=>e.id===player.id?{...e,hp:e.maxHp/4}:e)};
  bars.sync(hurt,root,player.id);
  expect(part(player.id,'health-fill').scale.x).toBeCloseTo((2.1-.07)/4);
  expect(part(player.id,'health-fill').position.x-part(player.id,'health-fill').scale.x/2).toBeCloseTo(-(2.1-.07)/2);
  bars.sync({...snapshot,entities:snapshot.entities.map(e=>e.id===player.id?{...e,alive:false}:e)},root,player.id);
  expect(scene.getObjectByName(`health-${player.id}`)).toBeUndefined();bars.dispose();
});

it('shows the current enemy attack target and clears it when commands change',()=>{
 const sim=new Simulation({seed:61,contentVersion:10,navigation});
 const blue=sim.getHero(0)!,red=sim.getHero(1)!;blue.position={x:0,z:0};red.position={x:3,z:0};
 const scene=new Scene(),root=new Group();scene.add(root);for(const entity of sim.snapshot().entities){const anchor=new Object3D();anchor.name=`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`;root.add(anchor);}
 const bars=createHealthBars(scene),camera=new PerspectiveCamera();
 sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);const first=sim.snapshot();bars.sync(first,root,blue.id);
 const marker=scene.getObjectByName(`health-${red.id}`)!;
 expect(marker.getObjectByName('current-attack-target')!.visible).toBe(true);
 sim.step([{type:'stop',heroId:blue.id}]);bars.sync(sim.snapshot(),root,blue.id);expect(marker.getObjectByName('current-attack-target')!.visible).toBe(false);
 sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);bars.sync(sim.snapshot(),root,blue.id);expect(marker.getObjectByName('current-attack-target')!.visible).toBe(true);
 root.getObjectByName(`hero-${red.id}`)!.visible=false;bars.draw(camera);expect(marker.visible).toBe(false);
 root.getObjectByName(`hero-${red.id}`)!.visible=true;bars.draw(camera);expect(marker.visible).toBe(true);
 sim.step([{type:'move',heroId:blue.id,point:{x:-5,z:0}}]);bars.sync(sim.snapshot(),root,blue.id);expect(marker.getObjectByName('current-attack-target')!.visible).toBe(false);
 bars.dispose();expect(scene.children).toEqual([root]);
});
it('clears attack cues for dead players, invalid targets and terminal snapshots without changing state',()=>{
 const sim=new Simulation({seed:1,contentVersion:10,navigation}),snapshot=sim.snapshot(),scene=new Scene(),root=new Group();scene.add(root);
 for(const entity of snapshot.entities){const anchor=new Object3D();anchor.name=`${entity.kind==='hero'?'hero':'entity'}-${entity.id}`;root.add(anchor);}
 const player=snapshot.heroes[0]!,enemy=snapshot.heroes[1]!,bars=createHealthBars(scene),hash=sim.finalHash();
 const selected={...snapshot,heroes:snapshot.heroes.map(h=>h.id===player.id?{...h,targetId:enemy.id}:h)};
 bars.sync(selected,root,player.id);const marker=scene.getObjectByName(`health-${enemy.id}`)!;expect(marker.getObjectByName('current-attack-target')!.visible).toBe(true);
 bars.sync({...selected,status:'blueWin'},root,player.id);expect(marker.getObjectByName('current-attack-target')!.visible).toBe(false);
 bars.sync({...selected,heroes:selected.heroes.map(h=>h.id===player.id?{...h,alive:false}:h)},root,player.id);expect(marker.getObjectByName('current-attack-target')!.visible).toBe(false);
 bars.sync({...selected,heroes:selected.heroes.map(h=>h.id===player.id?{...h,targetId:player.id}:h)},root,player.id);expect(scene.getObjectByName(`health-${player.id}`)!.getObjectByName('current-attack-target')!.visible).toBe(false);
 bars.sync({...selected,entities:selected.entities.map(e=>e.id===enemy.id?{...e,alive:false}:e)},root,player.id);expect(scene.getObjectByName(`health-${enemy.id}`)).toBeUndefined();
 expect(sim.finalHash()).toBe(hash);bars.dispose();
});
