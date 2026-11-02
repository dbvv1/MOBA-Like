import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]??'.');
const {LocalMatch}=await import(pathToFileURL(resolve(root,'src/save/match.ts')).href);
const {createDetourNavigation}=await import(pathToFileURL(resolve(root,'src/sim/navigation.ts')).href);
const nav=await createDetourNavigation(await readFile(resolve(root,'src/sim/nav/lane.navmesh')));
const results=[];
try{
 for(const contentVersion of [11,12]){
  const match=new LocalMatch({seed:1,contentVersion,heroIdsByTeam:[['veyra'],['veyra']],maxMatchSeconds:1200,botSeed:1002,botDifficulty:'normal'},nav,'side-release-proof');
  const heroId=match.playerId,curve=[],releases=[];
  for(let tick=1;tick<=600;tick++){
   const command=tick===1?{type:'move',heroId,point:{x:0,z:0}}:tick===10||tick===11?{type:'cast',heroId,slot:tick===10?'Q':'W',targetId:null,direction:{x:1,z:0},point:{x:3,z:0}}:tick===60?{type:'stop',heroId}:null;
   match.step(command?[command]:[]);
   for(const e of match.simulation.snapshot().events)if((e.type==='castResolved'||e.type==='castStarted')&&e.heroId===heroId)releases.push({type:e.type,slot:e.slot,tick:e.tick});
   if(tick%30===0)curve.push({tick,hash:match.simulation.finalHash()});
  }
  results.push({contentVersion,finalHash:match.simulation.finalHash(),curve,releases});
 }
 console.log(JSON.stringify({scope:'same player input script + normal bot; camera/audio switches absent; no render dependency',ticks:600,results},null,2));
}finally{nav.destroy();}
