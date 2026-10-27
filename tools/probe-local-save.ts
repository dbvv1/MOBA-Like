import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createDetourNavigation} from '../src/sim/navigation.js';
import {LocalMatch,restoreMatch} from '../src/save/match.js';
// Real simulation/navmesh consumer. No renderer or fake state restoration.
const navigation=await createDetourNavigation(await readFile(new URL('../src/sim/nav/lane.navmesh',import.meta.url)));
try{
  const match=new LocalMatch({seed:1,contentVersion:10,heroIdsByTeam:[['veyra'],['veyra']],maxMatchSeconds:1200,botSeed:1002,botDifficulty:'normal'},navigation,'cpu-probe');
  for(let tick=1;tick<=15_000;tick++){
    match.step(tick%1800===1?[{type:'attackMove',heroId:match.playerId,point:{x:0,z:0}}]:[]);
    if(match.simulation.isComplete())throw new Error(`Fixture ended before checkpoint at tick ${tick}`);
  }
  const saved=match.checkpoint(),started=performance.now();
  const resumed=await restoreMatch(saved,navigation,'cpu-probe');
  const recoveryMs=performance.now()-started;
  if(resumed.simulation.finalHash()!==match.simulation.finalHash())throw new Error('Checkpoint mismatch');
  while(!match.simulation.isComplete()){
    const tick=match.simulation.state.tick+1;
    const commands=tick%900===0?[{type:'stop' as const,heroId:match.playerId}]:[];
    match.step(commands);resumed.step(commands);
  }
  if(resumed.simulation.finalHash()!==match.simulation.finalHash())throw new Error('Continuation mismatch');
  console.log(JSON.stringify({checkpointTick:saved.tick,checkpointHash:saved.stateHash,bytes:Buffer.byteLength(JSON.stringify(saved)),recoveryMs:Math.round(recoveryMs),finalTick:match.simulation.state.tick,finalStatus:match.simulation.status,finalHash:match.simulation.finalHash(),sameTerminalHash:true}));
}finally{navigation.destroy();}
