import {expect,it} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {Simulation} from '../../src/sim/simulation.js';
import {createOfflineBots,offlineMatchOptions} from '../../src/session/offline-match.js';
import {testNavigation} from '../helpers.js';
const selected=[['veyra'],['veyra']] as const;
it('keeps the default duel and only opts into an explicit offline team match',()=>{
  expect(offlineMatchOptions('',getContent(10),selected)).toEqual({seed:1,heroesPerTeam:1,heroIdsByTeam:selected});
  expect(offlineMatchOptions('?seed=bad&seed=',getContent(10),selected)).toEqual({seed:1,heroesPerTeam:1,heroIdsByTeam:selected});
  for(const seed of ['0','4294967295'])expect(offlineMatchOptions(`?match=offline-5v5&seed=${seed}`,getContent(10),selected).seed).toBe(Number(seed));
  expect(offlineMatchOptions('?match=offline-5v5&seed=72',getContent(10),selected)).toMatchObject({seed:72,heroesPerTeam:5});
});
it('owns exactly nine stable bot identities, never issues for the player, and releases all owners',async()=>{
  const options=offlineMatchOptions('?match=offline-5v5&seed=72',getContent(10),selected);
  const sim=new Simulation({...options,contentVersion:10,navigation:await testNavigation()});
  const bots=createOfflineBots(sim),roster=bots.roster();
  expect(roster).toHaveLength(9);expect(new Set(roster.map(bot=>bot.seed)).size).toBe(9);
  expect(roster.filter(bot=>bot.team===0)).toHaveLength(4);expect(roster.some(bot=>bot.heroId===sim.getHero(0)!.id)).toBe(false);
  const issued=new Set<number>();
  for(let tick=0;tick<150;tick++){const commands=bots.think();for(const command of commands)issued.add(command.heroId);sim.step(commands);}
  expect([...issued].sort()).toEqual(roster.map(bot=>bot.heroId).sort());
  const fresh=new Simulation({...options,contentVersion:10,navigation:await testNavigation()});
  expect(createOfflineBots(fresh).roster()).toEqual(roster);
  bots.dispose();expect(bots.roster()).toEqual([]);expect(bots.think()).toEqual([]);
});
it('stops owning bots at termination',async()=>{
  const sim=new Simulation({...offlineMatchOptions('?match=offline-5v5',getContent(10),selected),contentVersion:10,navigation:await testNavigation(),maxMatchSeconds:1});
  const bots=createOfflineBots(sim);while(!sim.isComplete())sim.step(bots.think());
  expect(bots.think()).toEqual([]);expect(bots.roster()).toEqual([]);
});

it.each(['?match=','?match=5v5','?match=offline-5v5&match=offline-5v5','?match=wrong&match=offline-5v5','?match=offline-5v5&seed=','?match=offline-5v5&seed=-1','?match=offline-5v5&seed=1.2','?match=offline-5v5&seed=4294967296','?match=offline-5v5&seed=1&seed=1'])('rejects ambiguous or invalid explicit requests %s',query=>{
  expect(()=>offlineMatchOptions(query,getContent(10),selected)).toThrow(/Invalid (match|seed)/);
});
