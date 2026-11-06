// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../src/sim/simulation.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
import {createGoldReceipt} from '../../src/ui/gold-receipt.js';
import {createHud} from '../../src/ui/hud.js';
import {hero,place,structure,killGuardStructures} from '../helpers.js';
import type {PresentationEvent} from '../../src/sim/types.js';
describe('gold HUD terminal and event boundaries',()=>{
  it('keeps a real base-destruction team award beside the terminal HUD announcement',async()=>{
    const navigation=await createDetourNavigation(await readFile('src/sim/nav/lane.navmesh'));
    const sim=new Simulation({seed:1,contentVersion:8,navigation,heroesPerTeam:2});
    const killer=hero(sim,0,0),player=hero(sim,0,1),base=structure(sim,'red-base');
    killGuardStructures(sim,1);sim.step([]);place(killer,{x:99,z:0});base.hp=1;
    const receipt=createGoldReceipt(player.id),root=document.createElement('div');
    const hud=createHud(root,sim.catalog,()=>{},()=>{},()=>{},undefined,receipt);
    try{
      sim.step([{type:'attack',heroId:killer.id,targetId:base.id}]);
      expect(sim.isComplete()).toBe(true);
      const snap=sim.snapshot();receipt.consume(snap.events,snap.timeSeconds);hud.update(snap,player.id);
      expect(root.querySelector('[data-gold-receipt]')!.textContent).toBe('+60 gold · 团队目标');
      const announcement=root.querySelector('[data-message]')!.textContent;expect(announcement).toMatch(/victory/i);
      for(let i=0;i<70;i++){sim.step([]);receipt.consume(sim.snapshot().events,sim.timeSeconds);hud.update(sim.snapshot(),player.id);}
      expect(root.querySelector('[data-gold-receipt]')!.textContent).toBe('+60 gold · 团队目标');
      expect(root.querySelector('[data-message]')!.textContent).toBe(announcement);
    }finally{hud.dispose();navigation.destroy();}
  });
  it('ignores other-recipient awards and duplicates do not extend expiry',()=>{
    const award:PresentationEvent={type:'goldAwarded',tick:5,ordinal:0,recipientId:7,targetId:1,amount:300,reason:'heroKill',position:{x:0,z:0}};
    const enemy=createGoldReceipt(8);enemy.consume([award],10);expect(enemy.read(10)).toBe('');
    const own=createGoldReceipt(7);own.consume([award],10);own.consume([award],11.99);
    expect(own.read(11.999)).toBe('+300 gold · 击杀');expect(own.read(12)).toBe('');
  });
  it('merges incremental same-tick event slices without recounting a repeated prefix',()=>{
    const event:PresentationEvent={type:'goldAwarded',tick:9,ordinal:0,recipientId:7,targetId:1,amount:24,reason:'minionLastHit',position:{x:0,z:0}};
    const next:PresentationEvent={...event,ordinal:1,amount:60,reason:'structureTeamReward'};
    const receipt=createGoldReceipt(7);receipt.consume([event],1);receipt.consume([event,next],1);
    expect(receipt.read(1)).toBe('+84 gold · 多项奖励');
  });
});
