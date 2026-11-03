import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const DEFAULT_COMMIT='0811894da59740bdc10e0a2318174f3dbb0530d1';
const CONTENT_VERSIONS=[1,2,7,8,9,10,11,12] as const;
const GOLD_REASONS=['heroKill','heroTeamReward','minionLastHit','structureLastHit','structureTeamReward'] as const;

type EventLike=Record<string,unknown>;
type CommandLike=Record<string,unknown>;

interface SimulationLike {
  state: Record<string,unknown> & {tick:number};
  snapshot(): {events:readonly EventLike[]};
  finalHash(): string;
  isComplete(): boolean;
  commandFrame(commands:readonly CommandLike[]): unknown;
  step(frame:unknown): unknown;
}

interface BotLike {think(sim:SimulationLike): readonly CommandLike[];}
interface NavigationLike {destroy(): void;}

interface Runtime {
  Simulation:new (options:Record<string,unknown>)=>SimulationLike;
  HeroBot:new (options:Record<string,unknown>)=>BotLike;
  createDetourNavigation:(data:Uint8Array)=>Promise<NavigationLike>;
  deriveSeed:(seed:number,salt:number)=>number;
  stableStringify:(value:unknown)=>string;
}

interface Options {
  commit: string;
  seed: number;
  ticks: number;
}

interface VersionResult {
  contentVersion:number;
  ticks:number;
  completedEarly:boolean;
  botInputsMatch:boolean;
  stateHashesMatch:boolean;
  serializedStatesMatch:boolean;
  legacyEventsMatch:boolean;
  ordinalsUnique:boolean;
  goldEventErrors:string[];
  baselineEventCount:number;
  baselineGoldEventCount:number;
  goldEventCount:number;
  goldReasons:Record<string,number>;
  finalHash:string;
  firstDifference:string|null;
}

function parseArgs(argv:readonly string[]):Options {
  const options:Options={commit:DEFAULT_COMMIT,seed:1,ticks:600};
  for(let index=0;index<argv.length;index+=1){
    const arg=argv[index];
    const next=():string=>{
      const value=argv[index+1];
      if(value===undefined)throw new Error(`missing value for ${arg}`);
      index+=1;
      return value;
    };
    switch(arg){
      case '--commit':options.commit=next();break;
      case '--seed':options.seed=nonNegativeInt(next(),'--seed');break;
      case '--ticks':options.ticks=positiveInt(next(),'--ticks');break;
      case '--help':
      case '-h':printHelp();process.exit(0);break;
      default:throw new Error(`unknown argument: ${arg}`);
    }
  }
  if(options.ticks<600)throw new Error('--ticks must be at least 600');
  return options;
}

function positiveInt(value:string,name:string):number {
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<=0)throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInt(value:string,name:string):number {
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<0)throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function printHelp():void {
  console.log(`Usage: node --import tsx tools/check-gold-event-compatibility.ts [options]

  --commit <sha>    baseline git commit (default ${DEFAULT_COMMIT})
  --seed <S>        simulation seed for every content version (default 1)
  --ticks <N>       normal-bot ticks per version, at least 600 (default 600;
                    use 3600 to also exercise real goldAwarded events)

The tool extracts the commit's src/ tree from git objects into
node_modules/.cache and removes it afterwards. It creates real baseline and current
Simulations, feeds both the same normal bot inputs, and compares per-tick state
hashes, serialized state, and legacy presentation events after removing ordinals
and the new goldAwarded events.`);
}

function git(repoRoot:string,args:readonly string[]):Buffer {
  return execFileSync('git',[...args],{cwd:repoRoot,maxBuffer:64*1024*1024});
}

async function extractBaseline(repoRoot:string,commit:string):Promise<string> {
  const cacheRoot=join(repoRoot,'node_modules','.cache');
  await mkdir(cacheRoot,{recursive:true});
  const target=await mkdtemp(join(cacheRoot,'gold-event-baseline-'));
  const listing=git(repoRoot,['ls-tree','-r','--name-only',commit,'--','src']).toString('utf8');
  const files=listing.split('\n').map(line=>line.trim()).filter(Boolean);
  if(files.length===0)throw new Error(`baseline commit ${commit} has no src/ tree`);
  for(const file of files){
    const data=git(repoRoot,['show',`${commit}:${file}`]);
    const destination=join(target,file);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,data);
  }
  return target;
}

async function loadRuntime(root:string):Promise<Runtime> {
  const simulation:any=await import(pathToFileURL(resolve(root,'src/sim/simulation.ts')).href);
  const ai:any=await import(pathToFileURL(resolve(root,'src/sim/ai.ts')).href);
  const navigation:any=await import(pathToFileURL(resolve(root,'src/sim/navigation.ts')).href);
  const rng:any=await import(pathToFileURL(resolve(root,'src/sim/rng.ts')).href);
  const hash:any=await import(pathToFileURL(resolve(root,'src/sim/hash.ts')).href);
  return {
    Simulation:simulation.Simulation,
    HeroBot:ai.HeroBot,
    createDetourNavigation:navigation.createDetourNavigation,
    deriveSeed:rng.deriveSeed,
    stableStringify:hash.stableStringify,
  };
}

interface Side {
  root:string;
  navigation:NavigationLike;
  sim:SimulationLike;
  bots:BotLike[];
}

async function createSide(runtime:Runtime,root:string,seed:number,contentVersion:number):Promise<Side> {
  const navData=await readFile(resolve(root,'src/sim/nav/lane.navmesh'));
  const navigation=await runtime.createDetourNavigation(navData);
  const sim=new runtime.Simulation({
    seed,
    contentVersion,
    navigation,
    heroIdsByTeam:[['veyra'],['veyra']],
    maxMatchSeconds:3600,
  });
  const bots=[
    new runtime.HeroBot({team:0,slotIndex:0,difficulty:'normal',seed:runtime.deriveSeed(seed,1)}),
    new runtime.HeroBot({team:1,slotIndex:0,difficulty:'normal',seed:runtime.deriveSeed(seed,101)}),
  ];
  return {root,navigation,sim,bots};
}

function withoutOrdinal(event:EventLike):Record<string,unknown> {
  const copy={...event};
  delete copy.ordinal;
  return copy;
}

function comparableEvents(events:readonly EventLike[],includeGold:boolean):Record<string,unknown>[] {
  return events.filter(event=>includeGold||event.type!=='goldAwarded').map(withoutOrdinal);
}

function goldValidationError(event:EventLike):string|null {
  if(!Number.isSafeInteger(event.recipientId)||(event.recipientId as number)<=0)return 'recipientId';
  if(!Number.isSafeInteger(event.targetId)||(event.targetId as number)<=0)return 'targetId';
  if(typeof event.amount!=='number'||!Number.isFinite(event.amount)||event.amount<=0)return 'amount';
  if(typeof event.tick!=='number'||typeof event.ordinal!=='number')return 'tick/ordinal';
  if(typeof event.reason!=='string'||!GOLD_REASONS.includes(event.reason as typeof GOLD_REASONS[number]))return 'reason';
  const position=event.position as {x?:unknown;z?:unknown}|null|undefined;
  if(!position||typeof position.x!=='number'||!Number.isFinite(position.x)||typeof position.z!=='number'||!Number.isFinite(position.z))return 'position';
  return null;
}

async function runVersion(baselineRuntime:Runtime,currentRuntime:Runtime,baselineRoot:string,currentRoot:string,seed:number,ticks:number,contentVersion:number):Promise<VersionResult> {
  const baseline=await createSide(baselineRuntime,baselineRoot,seed,contentVersion);
  const current=await createSide(currentRuntime,currentRoot,seed,contentVersion);
  const result:VersionResult={
    contentVersion,
    ticks:0,
    completedEarly:false,
    botInputsMatch:true,
    stateHashesMatch:true,
    serializedStatesMatch:true,
    legacyEventsMatch:true,
    ordinalsUnique:true,
    goldEventErrors:[],
    baselineEventCount:0,
    baselineGoldEventCount:0,
    goldEventCount:0,
    goldReasons:Object.fromEntries(GOLD_REASONS.map(reason=>[reason,0])),
    finalHash:'',
    firstDifference:null,
  };
  const record=(kind:string,tick:number):void=>{
    result.firstDifference??=`${kind} at tick ${tick}`;
  };
  try{
    for(let tick=1;tick<=ticks;tick+=1){
      if(baseline.sim.isComplete()||current.sim.isComplete()){
        result.completedEarly=true;
        record('match completed before requested ticks',tick-1);
        break;
      }
      const baselineCommands=baseline.bots.flatMap(bot=>bot.think(baseline.sim));
      const currentCommands=current.bots.flatMap(bot=>bot.think(current.sim));
      if(baselineRuntime.stableStringify(baselineCommands)!==currentRuntime.stableStringify(currentCommands)){
        result.botInputsMatch=false;
        record('bot input mismatch',tick);
        break;
      }
      baseline.sim.step(baseline.sim.commandFrame(baselineCommands));
      current.sim.step(current.sim.commandFrame(currentCommands));
      result.ticks=tick;

      const baselineHash=baseline.sim.finalHash();
      const currentHash=current.sim.finalHash();
      if(baselineHash!==currentHash){
        result.stateHashesMatch=false;
        record('tick state hash mismatch',tick);
      }
      if(baselineRuntime.stableStringify(baseline.sim.state)!==currentRuntime.stableStringify(current.sim.state)){
        result.serializedStatesMatch=false;
        record('serialized state mismatch',tick);
      }

      const baselineEvents=baseline.sim.snapshot().events;
      const currentEvents=current.sim.snapshot().events;
      result.baselineEventCount+=baselineEvents.length;
      const baselineGold=baselineEvents.filter(event=>event.type==='goldAwarded');
      result.baselineGoldEventCount+=baselineGold.length;
      if(baselineGold.length>0)record('baseline source already emits goldAwarded',tick);
      const currentGold=currentEvents.filter(event=>event.type==='goldAwarded');
      result.goldEventCount+=currentGold.length;
      for(const event of currentGold){
        const reason=event.reason as string;
        if(reason in result.goldReasons)result.goldReasons[reason]=(result.goldReasons[reason]??0)+1;
        const error=goldValidationError(event);
        if(error&&result.goldEventErrors.length<10)result.goldEventErrors.push(`tick ${tick}: ${error}`);
      }
      for(const batch of [baselineEvents,currentEvents]){
        if(new Set(batch.map(event=>event.ordinal)).size!==batch.length){
          result.ordinalsUnique=false;
          record('duplicate ordinal in batch',tick);
        }
      }
      if(baselineRuntime.stableStringify(comparableEvents(baselineEvents,false))!==currentRuntime.stableStringify(comparableEvents(currentEvents,false))){
        result.legacyEventsMatch=false;
        record('legacy event payload/order mismatch',tick);
      }
      if(!result.stateHashesMatch||!result.serializedStatesMatch||!result.legacyEventsMatch||!result.ordinalsUnique){
        break;
      }
    }
    result.finalHash=current.sim.finalHash();
  } finally {
    baseline.navigation.destroy();
    current.navigation.destroy();
  }
  return result;
}

async function main():Promise<void> {
  const options=parseArgs(process.argv.slice(2));
  const repoRoot=process.cwd();
  const resolvedCommit=git(repoRoot,['rev-parse','--verify',`${options.commit}^{commit}`]).toString('utf8').trim();
  const currentRuntime=await loadRuntime(repoRoot);
  const baselineRoot=await extractBaseline(repoRoot,resolvedCommit);
  try{
    // The baseline simulation must be produced by the baseline source tree, not
    // by the current one; otherwise this compares the new code with itself.
    const baselineRuntime=await loadRuntime(baselineRoot);
    const versions:VersionResult[]=[];
    for(const contentVersion of CONTENT_VERSIONS){
      versions.push(await runVersion(baselineRuntime,currentRuntime,baselineRoot,repoRoot,options.seed,options.ticks,contentVersion));
    }
    const passed=versions.every(version=>
      !version.completedEarly&&
      version.ticks>=options.ticks&&
      version.botInputsMatch&&
      version.stateHashesMatch&&
      version.serializedStatesMatch&&
      version.legacyEventsMatch&&
      version.ordinalsUnique&&
      version.baselineGoldEventCount===0&&
      version.goldEventErrors.length===0,
    );
    console.log(JSON.stringify({
      baselineCommit:resolvedCommit,
      baselineSource:'git-objects',
      seed:options.seed,
      requestedTicks:options.ticks,
      mode:'normal bots, both sides, same per-tick inputs',
      passed,
      versions,
    },null,2));
    if(!passed)process.exitCode=1;
  } finally {
    await rm(baselineRoot,{recursive:true,force:true});
  }
}

main().catch((error:unknown)=>{
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
