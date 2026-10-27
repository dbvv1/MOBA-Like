import {Simulation} from '../sim/simulation.js';
import {HeroBot} from '../sim/ai.js';
import type {Navigation} from '../sim/navigation.js';
import type {Snapshot,SimCommand} from '../sim/types.js';
import {FixedClock} from '../render/clock.js';
import {CAPTURE_HZ,CONTENT_VERSION,WARMUP_FRAMES,type CaptureConfig} from './config.js';
import {CaptureLifetime} from './lifetime.js';
export interface CaptureConsumer {sync(snapshot:Snapshot,playerId:number):void;draw(seconds:number,alpha:number,render:boolean):void;renderOnly():void;}

export interface CaptureProgress {phase:'preroll'|'warmup';completed:number;total:number;virtualFrame:number;}

export class CaptureSession {
  readonly sim:Simulation;
  readonly playerId:number;
  private readonly bot:HeroBot;
  private readonly clock:FixedClock;
  private virtualFrame=0;
  private frame=0;
  private prepared=false;
  private alpha=0;
  constructor(readonly config:CaptureConfig,navigation:Navigation,private lifetime=new CaptureLifetime()){
    // Same roster, bot and rules as this candidate's normal client. Only the
    // clock, input tape and camera differ; no relocation or state edits.
    this.sim=new Simulation({seed:config.seed,contentVersion:CONTENT_VERSION,navigation,heroesPerTeam:1,heroIdsByTeam:[['veyra'],['veyra']]});
    this.playerId=this.sim.getHero(0,0)!.id;
    this.bot=new HeroBot({team:1,slotIndex:0,difficulty:'normal',seed:1002});
    this.clock=new FixedClock(1/this.sim.tickRateHz);
  }
  get metadata(){return {shot:this.config.shot,seed:this.config.seed,input:this.config.input,requestedTime:this.config.requestedTime,t:this.virtualFrame/CAPTURE_HZ,virtualFrame:this.virtualFrame,fixedDt:1/CAPTURE_HZ,simTick:this.sim.snapshot().tick,simTime:this.sim.snapshot().timeSeconds,contentVersion:CONTENT_VERSION,stateHash:this.sim.finalHash(),frame:this.frame,frames:this.config.frames,complete:this.frame===this.config.frames-1,warmupFrames:WARMUP_FRAMES,alpha:this.alpha};}
  private step(consumer:CaptureConsumer,render:boolean){
    this.lifetime.assertActive();
    this.alpha=this.clock.advance(1/CAPTURE_HZ,()=>{
      if(this.sim.isComplete())return;
      const commands:SimCommand[]=this.config.input==='march'&&this.sim.snapshot().tick===0?[{type:'move',heroId:this.playerId,point:{x:-18,z:1.2}}]:[];
      this.sim.step([...commands,...this.bot.think(this.sim)]);consumer.sync(this.sim.snapshot(),this.playerId);
    });
    this.virtualFrame++;consumer.draw(1/CAPTURE_HZ,this.sim.isComplete()?1:this.alpha,render);
  }
  async prepare(consumer:CaptureConsumer,yieldTask:()=>Promise<void>=async()=>{},progress:(value:CaptureProgress)=>void=()=>{}){
    if(this.prepared)throw new Error('Capture already prepared');this.prepared=true;this.lifetime.assertActive();
    consumer.sync(this.sim.snapshot(),this.playerId);consumer.draw(0,0,false);
    progress({phase:'preroll',completed:0,total:this.config.startFrame,virtualFrame:this.virtualFrame});
    while(this.virtualFrame<this.config.startFrame){this.step(consumer,false);if(this.virtualFrame%60===0){progress({phase:'preroll',completed:this.virtualFrame,total:this.config.startFrame,virtualFrame:this.virtualFrame});await yieldTask();this.lifetime.assertActive();}}
    // Renderer history converges on exactly the final pose; no repeated action
    // sampling, extra simulation ticks, animation time or camera movement.
    progress({phase:'preroll',completed:this.virtualFrame,total:this.config.startFrame,virtualFrame:this.virtualFrame});
    // Yield once before the expensive first GPU submission so its phase is visible.
    progress({phase:'warmup',completed:0,total:WARMUP_FRAMES,virtualFrame:this.virtualFrame});
    await yieldTask();this.lifetime.assertActive();
    for(let i=0;i<WARMUP_FRAMES;i++){this.lifetime.assertActive();consumer.renderOnly();progress({phase:'warmup',completed:i+1,total:WARMUP_FRAMES,virtualFrame:this.virtualFrame});}
  }
  next(consumer:CaptureConsumer,expectedFrame=this.frame){
    this.lifetime.assertActive();if(!this.prepared)throw new Error('Capture not prepared');
    if(expectedFrame!==this.frame)throw new Error('Stale frame acknowledgment');
    if(this.frame>=this.config.frames-1)return false;
    this.step(consumer,true);this.frame++;return true;
  }
}
