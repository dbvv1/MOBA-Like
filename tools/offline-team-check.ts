import {readFile} from 'node:fs/promises';
import {createDetourNavigation} from '../src/sim/navigation.js';
import {Simulation} from '../src/sim/simulation.js';
import {createOfflineBots,offlineMatchOptions} from '../src/session/offline-match.js';
import {HeroBot} from '../src/sim/ai.js';
import {deriveSeed} from '../src/sim/rng.js';
import {getContent} from '../src/content/catalog.js';
import {replayMatch} from '../src/sim/runner.js';
import type {TimedCommand} from '../src/sim/types.js';
const nav=await createDetourNavigation(new Uint8Array(await readFile(new URL('../src/sim/nav/lane.navmesh',import.meta.url))));
try{
for(const {seed,playerInput} of [{seed:1,playerInput:'bot-driver'},{seed:2,playerInput:'bot-driver'},{seed:3,playerInput:'bot-driver'},{seed:4,playerInput:'idle'}]){
  const sim=new Simulation({...offlineMatchOptions(`?match=offline-5v5&seed=${seed}`,getContent(10),[['veyra'],['veyra']]),contentVersion:10,navigation:nav});
  const bots=createOfflineBots(sim),driver=new HeroBot({team:0,slotIndex:0,difficulty:'normal',seed:deriveSeed(seed,1)});
  const replay:TimedCommand[]=[];const actors=new Map<number,{commands:number,casts:number}>();
  while(!sim.isComplete()){
    const commands=[...(playerInput==='bot-driver'?driver.think(sim):[]),...bots.think()];
    for(const command of commands){const record=actors.get(command.heroId)??{commands:0,casts:0};record.commands++;if(command.type==='cast')record.casts++;actors.set(command.heroId,record);replay.push({tick:sim.state.tick+1,command});}
    sim.step(commands);
  }
  if(sim.status==='timeout'||sim.state.diagnostics.pathFailures||sim.state.diagnostics.commandRejections||sim.state.diagnostics.stuckEvents.length)throw new Error(`Offline team regression at seed ${seed}`);
  console.log(JSON.stringify({seed,playerInput,status:sim.status,winner:sim.state.winner,duration:sim.timeSeconds,hash:sim.finalHash(),replayMatches:seed===1?replayMatch(sim.createReplay(replay),nav).hashMatches:null,actors:[...actors],diagnostics:sim.state.diagnostics,stats:sim.state.stats}));
}
}finally{nav.destroy();}
