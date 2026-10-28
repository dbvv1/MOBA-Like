import {HeroBot} from '../sim/ai.js';
import {deriveSeed} from '../sim/rng.js';
import type {Simulation} from '../sim/simulation.js';
import type {SimCommand} from '../sim/types.js';
import type {ContentCatalog} from '../content/types.js';

export function offlineMatchOptions(search:string,catalog:ContentCatalog,selected:readonly [readonly string[],readonly string[]]) {
  const query=new URLSearchParams(search);
  const modes=query.getAll('match');
  if(modes.length>1 || (modes.length===1&&modes[0]!=='offline-5v5'))throw new Error('Invalid match: expected one offline-5v5 value');
  const teams=modes.length===1;
  let seed=1;
  if(teams){
    const seeds=query.getAll('seed');
    if(seeds.length>1 || (seeds.length===1&&(!/^\d+$/.test(seeds[0]!)||!Number.isSafeInteger(Number(seeds[0]))||Number(seeds[0])>0xffffffff)))throw new Error('Invalid seed: expected one uint32 value');
    if(seeds.length===1)seed=Number(seeds[0]);
  }
  const player=selected[0][0]!;
  const choices=Object.keys(catalog.heroes);
  const heroesPerTeam=teams?5:1;
  const heroIdsByTeam:readonly [readonly string[],readonly string[]]=teams?
    [[player,...Array.from({length:4},(_,i)=>choices[(i+1)%choices.length]!)],Array.from({length:5},(_,i)=>choices[i%choices.length]!)]:selected;
  return {seed,heroesPerTeam,heroIdsByTeam,...(teams?{laneFormation:'spread-v1' as const}:{})};
}

/** Match-scoped bot owners; the player's team 0 / slot 0 is never automated. */
export function createOfflineBots(sim:Simulation) {
  const playerId=sim.getHero(0,0)!.id;
  let owners=sim.state.entities.filter(entity=>entity.kind==='hero'&&entity.id!==playerId).map(entity=>{
    if(entity.kind!=='hero')throw new Error('Expected hero');
    const seed=sim.config.heroesPerTeam===1?1002:deriveSeed(sim.seed,entity.team*100+entity.slotIndex+1);
    return {heroId:entity.id,team:entity.team,slotIndex:entity.slotIndex,seed,
      bot:new HeroBot({team:entity.team,slotIndex:entity.slotIndex,difficulty:'normal',seed})};
  });
  return {
    roster:()=>owners.map(({heroId,team,slotIndex,seed})=>({heroId,team,slotIndex,seed})),
    think:():SimCommand[]=>{
      if(sim.isComplete()){owners=[];return [];}
      return owners.flatMap(owner=>owner.bot.think(sim).filter(command=>command.heroId===owner.heroId));
    },
    dispose:()=>{owners=[];},
  };
}
