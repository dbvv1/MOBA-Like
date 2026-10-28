import {it,expect} from 'vitest';
import {Simulation} from '../../../src/sim/simulation.js';
import {testNavigation} from '../../helpers.js';
import {assertActiveMoveAtStop,assertStoppedAtKeyPosition} from './movement-probe.mjs';
 it('checks real v11 stop execution and rejects its natural-arrival counterfactual',async()=>{
  const nav=await testNavigation();
  try{
   const sim=new Simulation({seed:1,contentVersion:11,navigation:nav,heroesPerTeam:1});
   const first=sim.snapshot().heroes.find(h=>h.team===0)!;
   const destination={x:first.position.x+12,z:first.position.z};
   sim.step([{type:'move',heroId:first.id,point:destination}]);
   for(let i=0;i<3;i++)sim.step([]);
   const atKey=sim.snapshot().heroes.find(h=>h.id===first.id)!;
   const p={beforeMove:{hero:first},click:{input:{trusted:true},pointer:{command:{type:'move'}}},beforeStop:{status:'running',input:{trusted:true},hero:atKey}};
   assertActiveMoveAtStop(p);
   sim.step([{type:'stop',heroId:first.id}]);const stopped=sim.snapshot().heroes.find(h=>h.id===first.id)!;
   for(let i=0;i<7;i++)sim.step([]);
   assertStoppedAtKeyPosition(p,stopped,sim.snapshot().heroes.find(h=>h.id===first.id)!);
   sim.step([{type:'move',heroId:first.id,point:destination}]);
   for(let i=0;i<200&&sim.snapshot().heroes.find(h=>h.id===first.id)!.moveGoal!==null;i++)sim.step([]);
   const arrived=sim.snapshot().heroes.find(h=>h.id===first.id)!;expect(arrived.moveGoal).toBeNull();
   expect(()=>assertStoppedAtKeyPosition(p,arrived,arrived)).toThrow('not pass by natural arrival');
  }finally{nav.destroy();}
 });
