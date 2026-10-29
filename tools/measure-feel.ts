/** Offline CPU fixture only. No browser, production parameter edits, or rendered-frame claims. */
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {makeSim, hero, place} from '../tests/helpers.js';
import type {SimCommand, PresentationEvent} from '../src/sim/types.js';
const version=process.argv[3]==='12'?12:11;
const traces:any[]=[];
async function arena(name:string){
  const sim=await makeSim(version,1,{blueHero:name,redHero:name});
  const blue=hero(sim,0),red=hero(sim,1);
  // Isolate timing from travel/AI. Same production stats, navigation and simulation.
  place(blue,{x:0,z:0});place(red,{x:5,z:0});
  const rows:any[]=[];
  function step(commands:SimCommand[]=[]){
    const before={...blue.position};
    const result=sim.step(sim.commandFrame(commands));
    const row={tick:sim.state.tick,input:commands,result,position:{...blue.position},facing:{...blue.facing},distance:Math.hypot(blue.position.x-before.x,blue.position.z-before.z),cooldown:blue.attackCooldown,basicAttack:blue.basicAttack?{...blue.basicAttack}:null,cast:blue.cast?{...blue.cast}:null,events:sim.snapshot().events};
    rows.push(row);return row;
  }
  return {sim,blue,red,rows,step};
}
const summary:any[]=[];
for(const name of ['veyra','morrow']){
  const a=await arena(name);
  a.step([{type:'move',heroId:a.blue.id,point:{x:10,z:0}}]);
  for(let i=0;i<5;i++)a.step();
  const turn=a.step([{type:'move',heroId:a.blue.id,point:{x:0,z:5}}]);
  const stop=a.step([{type:'stop',heroId:a.blue.id}]);a.step();
  const movement={firstMovementTick:a.rows.find(r=>r.distance>1e-9)?.tick,speedUnitsPerSecond:a.rows[0].distance*30,turnTick:turn.tick,turnFacing:turn.facing,stopTick:stop.tick,stopDistance:stop.distance};
  traces.push({hero:name,scenario:'move-6-ticks-turn-stop',rows:a.rows});
  const b=await arena(name);b.step([{type:'attack',heroId:b.blue.id,targetId:b.red.id}]);
  for(let i=0;i<65;i++)b.step();
  const starts=b.rows.flatMap(r=>r.events).filter(e=>e.type==='castStarted'&&e.action==='basicAttack'&&e.heroId===b.blue.id).map(e=>e.tick);
  const launches=b.rows.flatMap(r=>r.events).filter(e=>e.type==='basicAttack'&&e.sourceId===b.blue.id).map(e=>e.tick);
  const hits=b.rows.flatMap(r=>r.events).filter(e=>e.type==='basicAttackHit'&&e.sourceId===b.blue.id).map(e=>e.tick);
  traces.push({hero:name,scenario:'continuous-attack',rows:b.rows});
  const boundaries=[];
  for(const commandTick of [launches[0]-1,launches[0],launches[0]+1]){
    const c=await arena(name);c.step([{type:'attack',heroId:c.blue.id,targetId:c.red.id}]);
    while(c.sim.state.tick<commandTick-1)c.step();
    const r=c.step([{type:'move',heroId:c.blue.id,point:{x:-5,z:0}}]);
    boundaries.push({commandTick,accepted:r.result[0]?.accepted,moved:r.distance,cancelled:r.events.some(e=>e.type==='castCancelled'),released:c.rows.some(row=>row.events.some((e:PresentationEvent)=>e.type==='basicAttack'&&e.sourceId===c.blue.id))});
    traces.push({hero:name,scenario:`move-at-${commandTick}`,rows:c.rows});
  }
  const d=await arena(name);
  const q:SimCommand={type:'cast',heroId:d.blue.id,slot:'Q',targetId:null,point:null,direction:{x:1,z:0}};
  const w:SimCommand={...q,slot:'W',direction:name==='morrow'?null:{x:1,z:0}};
  d.step([q]);d.step([w,{type:'move',heroId:d.blue.id,point:{x:-5,z:0}}]);
  for(let i=0;i<20;i++)d.step();
  traces.push({hero:name,scenario:'Q-then-W-and-move',rows:d.rows});
  const e=await arena(name);
  e.step([{...q,heroId:e.blue.id}]);e.step([{...w,heroId:e.blue.id}]);for(let i=0;i<20;i++)e.step();
  traces.push({hero:name,scenario:'Q-then-ready-W-only',rows:e.rows});
  const bufferedSkill=e.rows.flatMap(r=>r.events).filter(event=>event.type==='castStarted'&&event.slot==='W').map(event=>event.tick);
  const castEvents=d.rows.flatMap(r=>r.events).filter(e=>e.type==='castStarted'||e.type==='castResolved');
  summary.push({hero:name,movement,attack:{starts,launches,hits,windupTicks:launches[0]-starts[0],cycleTicks:starts[1]-starts[0],boundaries},cast:{readyWStartTicks:bufferedSkill,events:castEvents,secondInputResults:d.rows[1].result,firstMovementTick:d.rows.find(r=>r.distance>1e-9)?.tick}});
}
const report={schema:1,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),productionSourceDirty:!!execFileSync('git',['diff','--name-only','HEAD','--','src','tests/helpers.ts'],{encoding:'utf8'}).trim(),contentVersion:version,seed:1,tickRate:30,scope:'CPU deterministic isolated arena; initialized at (0,0)/(5,0), production stats unchanged; no bot inputs; not screen latency, animation, sound or human feel',summary,traces};
writeFileSync(process.argv[2]??'docs/quality/feel-baseline.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
