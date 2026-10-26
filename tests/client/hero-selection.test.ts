import {describe,it,expect} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {heroChoices,matchHeroes} from '../../src/ui/hero-selection.js';
import {Simulation} from '../../src/sim/simulation.js';
import {commandForCast,isInputElement} from '../../src/input/commands.js';
import {hero,testNavigation} from '../helpers.js';

const catalog=getContent(8);
describe('next-match hero selection using existing definitions',()=>{
  it('lists current definition IDs and referenced skill names, not duplicate hero data',()=>{
    const choices=heroChoices(catalog);expect(choices.map(x=>x.id)).toEqual(Object.keys(catalog.heroes));
    expect(choices.find(x=>x.id==='morrow')).toMatchObject({name:'Morrow',skills:expect.stringContaining('W: Barkguard')});
  });
  it('rejects invalid IDs rather than silently selecting a different hero',()=>{
    for(const id of ['', 'missing','__proto__','constructor'])expect(()=>matchHeroes(catalog,id)).toThrow('Unknown player hero');
    expect(isInputElement({tagName:'SELECT'} as unknown as EventTarget)).toBe(true);
  });
  it('captures fresh match options, preserving the existing opponent and prior instance',async()=>{
    const navigation=await testNavigation(),first=matchHeroes(catalog,'veyra');
    const old=new Simulation({seed:1,contentVersion:8,navigation,heroIdsByTeam:first});old.step([]);
    const next=matchHeroes(catalog,'morrow');expect(next).toEqual([['morrow'],['veyra']]);
    next[0][0]='veyra';expect(matchHeroes(catalog,'morrow')).toEqual([['morrow'],['veyra']]);
    expect(old.snapshot().heroes[0].definitionId).toBe('veyra');expect(old.state.tick).toBe(1);
  });
  it('uses unchanged controls to execute all four Morrow skills and restart a clean selected hero',async()=>{
    const navigation=await testNavigation();const start=()=>new Simulation({seed:1,contentVersion:8,navigation,heroIdsByTeam:matchHeroes(catalog,'morrow')});
    const sim=start(),player=hero(sim,0),mana=player.mana;
    for(const slot of ['W','Q','E','R'] as const){
      const snapshot=sim.snapshot(),view=snapshot.heroes.find(h=>h.id===player.id)!;
      const command=commandForCast(view,slot,{point:{x:player.position.x+2,z:player.position.z},entityId:null},snapshot,catalog);
      expect(command).not.toBeNull();expect(sim.step([command!])[0].accepted).toBe(true);
      for(let i=0;i<10;i++)sim.step([]);
      expect(player.cooldowns[slot]).toBeGreaterThan(0);
      expect(sim.state.stats.abilities[`morrow.${slot.toLowerCase()}`].casts).toBe(1);
    }
    expect(player.shield).toBeGreaterThan(0);expect(player.mana).toBeLessThan(mana);
    expect(sim.snapshot().zones.some(z=>z.abilityId==='morrow.e')).toBe(true);
    const again=start();expect(hero(again,0).definitionId).toBe('morrow');expect(hero(again,0).mana).toBe(mana);
    expect(again.state.tick).toBe(0);expect(again.snapshot().events).toEqual([]);expect(hero(again,0).cooldowns).toEqual({Q:0,W:0,E:0,R:0});
  });
});
