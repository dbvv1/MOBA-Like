import {describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {hero,makeSim,perform,place,stepMany} from '../helpers.js';
import {battleMessage} from '../../src/ui/battle-state.js';
import {createCommandNotice} from '../../src/ui/command-notice.js';
import {createControlMarkers} from '../../src/render/control-state.js';

describe('observed control and recovery feedback',()=>{
  it('follows a real delayed stun through rejection and restored movement without changing state',async()=>{
    const sim=await makeSim(10,16),blue=hero(sim,0),red=hero(sim,1);place(blue,{x:-4,z:0});place(red,{x:4,z:0});
    expect(perform(sim,{type:'cast',heroId:blue.id,slot:'R',targetId:null,direction:null,point:{x:4,z:0}}).accepted).toBe(true);
    const scene=new THREE.Scene(),actors=new THREE.Group(),anchor=new THREE.Group();anchor.name=`hero-${red.id}`;actors.add(anchor);const texture=new THREE.Texture(),markers=createControlMarkers(scene,texture),notice=createCommandNotice();
    const sync=()=>{const snapshot=sim.snapshot(),view=snapshot.heroes.find(h=>h.id===red.id)!;const hash=sim.finalHash();markers.sync(snapshot,actors);markers.draw();expect(sim.finalHash()).toBe(hash);return {snapshot,view};};
    stepMany(sim,20);sync();expect(scene.children).toHaveLength(0);
    stepMany(sim,10);let {snapshot,view}=sync();expect(view.stunned).toBe(true);expect(battleMessage(snapshot,view,sim.catalog).label).toBe('STUNNED');expect(scene.getObjectByName(`control-locked-${red.id}`)).toBeDefined();
    const rejected=perform(sim,{type:'move',heroId:red.id,point:{x:0,z:0}});expect(rejected.reason).toBe('stunned');notice.reject(rejected.reason!,snapshot.timeSeconds);expect(notice.read(view,snapshot.timeSeconds)).toContain('stunned');
    expect(perform(sim,{type:'stop',heroId:red.id}).accepted).toBe(true);
    stepMany(sim,50);({snapshot,view}=sync());expect(view.stunned).toBe(false);expect(scene.children).toHaveLength(0);expect(notice.read(view,snapshot.timeSeconds)).toBe('');expect(battleMessage(snapshot,view,sim.catalog).label).not.toBe('STUNNED');expect(perform(sim,{type:'move',heroId:red.id,point:{x:0,z:0}}).accepted).toBe(true);
    markers.dispose();texture.dispose();
  });
  it('clears a notice when its condition ends, without expiring active aim instructions',async()=>{
    const sim=await makeSim(10),view=sim.snapshot().heroes[0]!,notice=createCommandNotice();
    notice.reject('stunned',1);expect(notice.read({...view,stunned:true},1.5)).toContain('stunned');expect(notice.read(view,1.6)).toBe('');
    notice.reject('mana',2);expect(notice.read(view,3.9)).toContain('mana');expect(notice.read(view,4)).toBe('');
    notice.say('Aim at the ground; Esc cancels.');expect(notice.read(view,100)).toContain('Esc');
  });
  it('removes control markers on death, terminal state and disposal without owning the shared texture',async()=>{
    const sim=await makeSim(10),snapshot=sim.snapshot(),view=snapshot.heroes[0]!,actors=new THREE.Group(),anchor=new THREE.Group();anchor.name=`hero-${view.id}`;actors.add(anchor);const scene=new THREE.Scene(),texture=new THREE.Texture(),dispose=vi.spyOn(texture,'dispose'),markers=createControlMarkers(scene,texture);
    const stunned={...snapshot,heroes:[{...view,stunned:true}]};markers.sync(stunned,actors);markers.sync(stunned,actors);expect(scene.children).toHaveLength(1);
    anchor.position.set(3,0,4);markers.draw();expect(scene.children[0]!.position.toArray()).toEqual([3,3.25,4]);
    markers.sync({...stunned,heroes:[{...view,alive:false,stunned:true}]},actors);expect(scene.children).toHaveLength(0);
    markers.sync(stunned,actors);markers.sync({...stunned,status:'victory'},actors);expect(scene.children).toHaveLength(0);
    markers.sync(stunned,actors);markers.dispose();expect(scene.children).toHaveLength(0);expect(dispose).not.toHaveBeenCalled();texture.dispose();
  });
});
