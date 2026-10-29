import type {LocalMatch} from '../save/match.js';
import type {SimCommand,CommandResult,PresentationEvent} from '../sim/types.js';
export interface FeelInput {id:string;enteredAfterFrame:number;inputFrame:number;targetTick:number;before:{mana:number;wCooldown:number;alive:boolean;castSlot:string|null};command:SimCommand;}
export interface FeelStep {recordingFrame:number;tick:number;stateHash:string;results:CommandResult[];events:PresentationEvent[];position:{x:number;z:number};mana:number;wCooldown:number;}
/** Fixed in-game command replay; no DOM/device simulation or state mutation. */
export class SkillFeelTape {
  readonly inputs:FeelInput[]=[];
  readonly steps:FeelStep[]=[];
  private queued:SimCommand[]=[];
  constructor(private readonly match:LocalMatch){}
  enter(enteredAfterFrame:number) {
    const spec=enteredAfterFrame===0?['q-start','Q']:enteredAfterFrame===2?['w-during-q','W']:enteredAfterFrame===22?['w-after-q','W']:null;
    if(!spec)return;
    const command:SimCommand={type:'cast',heroId:this.match.playerId,slot:spec[1] as 'Q'|'W',targetId:null,direction:{x:1,z:0},point:null};
    const hero=this.match.simulation.getHero(0,0)!;
    this.inputs.push({before:{mana:hero.mana,wCooldown:hero.cooldowns.W,alive:hero.alive,castSlot:hero.cast?.slot??null},id:spec[0]!,enteredAfterFrame,inputFrame:enteredAfterFrame+1,targetTick:this.match.simulation.state.tick+1,command:structuredClone(command)});
    this.queued.push(command);
  }
  step(recordingFrame:number) {
    const results=this.match.step(this.queued.splice(0));
    const sim=this.match.simulation,hero=sim.getHero(0,0)!;
    this.steps.push({recordingFrame,tick:sim.state.tick,stateHash:sim.finalHash(),results:structuredClone(results),events:structuredClone([...sim.snapshot().events]),position:{...hero.position},mana:hero.mana,wCooldown:hero.cooldowns.W});
  }
  get metadata(){return {tape:'skill-buffer',simulationHz:30,recordingFps:60,inputs:structuredClone(this.inputs),steps:structuredClone(this.steps),stage:'world.draw submitted; PNG not captured; not display present',firstVisibleFrame:null,audio:'unknown: not recorded',scope:'real LocalMatch player/bot command frame and production world; no DOM aim UI or HUD input feedback'};}
}
