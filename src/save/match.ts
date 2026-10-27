import {CONTENT_VERSIONS, getContent} from '../content/catalog.js';
import type {ContentVersion, Difficulty} from '../content/types.js';
import {HeroBot} from '../sim/ai.js';
import type {Navigation} from '../sim/navigation.js';
import {Simulation} from '../sim/simulation.js';
import type {SimCommand} from '../sim/types.js';

export const MAX_SAVE_CHARS=2_000_000;
const MAX_TICKS=36_000, MAX_COMMANDS=24_000;
export interface MatchRecipe {
  seed:number;
  contentVersion:ContentVersion;
  heroIdsByTeam:readonly [readonly [string],readonly [string]];
  maxMatchSeconds:number;
  botSeed:number;
  botDifficulty:Difficulty;
}
export interface InputFrame {tick:number;commands:SimCommand[]}
export interface SavedView {cameraLocked:boolean}
export interface MatchSave {
  formatVersion:2;
  compatibilityId:string;
  recipe:MatchRecipe;
  tick:number;
  stateHash:string;
  inputs:InputFrame[];
  view:SavedView;
}
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const vector=(value:unknown)=>record(value)&&exact(value,['x','z'])&&typeof value.x==='number'&&Number.isFinite(value.x)&&Math.abs(value.x)<=10_000&&typeof value.z==='number'&&Number.isFinite(value.z)&&Math.abs(value.z)<=10_000;
function validCommand(value:unknown):value is SimCommand {
  if(!record(value)||!integer(value.heroId,1,1_000_000))return false;
  switch(value.type){
    case 'move':case 'attackMove':return exact(value,['type','heroId','point'])&&vector(value.point);
    case 'attack':return exact(value,['type','heroId','targetId'])&&integer(value.targetId,1,1_000_000);
    case 'stop':return exact(value,['type','heroId']);
    case 'buyItem':return exact(value,['type','heroId','itemId'])&&typeof value.itemId==='string'&&value.itemId.length<=80;
    case 'cast':return exact(value,['type','heroId','slot','targetId','direction','point'])&&typeof value.slot==='string'&&['Q','W','E','R'].includes(value.slot)&&(value.targetId===null||integer(value.targetId,1,1_000_000))&&(value.direction===null||vector(value.direction))&&(value.point===null||vector(value.point));
    default:return false;
  }
}
export class SaveError extends Error {
  constructor(readonly code:'invalid'|'incompatible'|'mismatch'|'limit',message:string){super(message);}
}

/** Decode untrusted local bytes before constructing a simulation. Never repair or overwrite them. */
export function decodeMatchSave(raw:string,compatibilityId:string):MatchSave {
  if(raw.length>MAX_SAVE_CHARS)throw new SaveError('limit','Saved match is too large.');
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new SaveError('invalid','Saved match is not valid JSON.');}
  if(!record(value))throw new SaveError('invalid','Saved match is not an object.');
  if((value.formatVersion!==1&&value.formatVersion!==2)||value.compatibilityId!==compatibilityId)throw new SaveError('incompatible','Saved match belongs to another rules version.');
  const fail=()=>{throw new SaveError('invalid','Saved match contains invalid data.');};
  const keys=['formatVersion','compatibilityId','recipe','tick','stateHash','inputs'];
  if(value.formatVersion===2)keys.push('view');
  if(!exact(value,keys)||!integer(value.tick,0,MAX_TICKS)||typeof value.stateHash!=='string'||!/^[0-9a-f]{16}$/.test(value.stateHash)||!record(value.recipe)||!Array.isArray(value.inputs))return fail();
  if(value.formatVersion===2&&(!record(value.view)||!exact(value.view,['cameraLocked'])||typeof value.view.cameraLocked!=='boolean'))return fail();
  const recipe=value.recipe;
  if(!exact(recipe,['seed','contentVersion','heroIdsByTeam','maxMatchSeconds','botSeed','botDifficulty'])||!integer(recipe.seed,0,0xffffffff)||!integer(recipe.botSeed,0,0xffffffff)||!CONTENT_VERSIONS.includes(recipe.contentVersion as ContentVersion)||typeof recipe.botDifficulty!=='string'||!['low','normal','high'].includes(recipe.botDifficulty)||!integer(recipe.maxMatchSeconds,1,1200))return fail();
  const catalog=getContent(recipe.contentVersion as ContentVersion);
  if(value.tick>=recipe.maxMatchSeconds*catalog.rules.tickRate||!Array.isArray(recipe.heroIdsByTeam)||recipe.heroIdsByTeam.length!==2||!recipe.heroIdsByTeam.every(team=>Array.isArray(team)&&team.length===1&&typeof team[0]==='string'&&Object.hasOwn(catalog.heroes,team[0])))return fail();
  let lastTick=0,count=0;
  for(const frame of value.inputs){
    if(!record(frame)||!exact(frame,['tick','commands'])||!integer(frame.tick,lastTick+1,value.tick)||!Array.isArray(frame.commands)||frame.commands.length<1||frame.commands.length>32||!frame.commands.every(validCommand))return fail();
    lastTick=frame.tick;count+=frame.commands.length;
    if(count>MAX_COMMANDS)throw new SaveError('limit','Saved match has too many inputs.');
  }
  // Version 1 always started with a locked camera. Only that known old format gets a default.
  return {...value,formatVersion:2,view:value.formatVersion===1?{cameraLocked:true}:value.view} as unknown as MatchSave;
}

/** One owner of bot state and player input history. Renderers must not call simulation.step. */
export class LocalMatch {
  readonly simulation:Simulation;
  readonly playerId:number;
  readonly recipe:MatchRecipe;
  private readonly bot:HeroBot;
  private readonly inputs:InputFrame[]=[];
  private commandCount=0;
  private recordable=true;
  constructor(recipe:MatchRecipe,navigation:Navigation,readonly compatibilityId:string){
    this.recipe=structuredClone(recipe);
    this.simulation=new Simulation({...this.recipe,navigation,heroesPerTeam:1});
    const hero=this.simulation.getHero(0,0);
    if(!hero)throw new Error('Local match has no player hero.');
    this.playerId=hero.id;
    this.bot=new HeroBot({team:1,slotIndex:0,difficulty:recipe.botDifficulty,seed:recipe.botSeed});
  }
  step(commands:readonly SimCommand[]=[]){
    if(this.simulation.isComplete())return [];
    if(commands.length>32||!commands.every(command=>validCommand(command)&&command.heroId===this.playerId))throw new SaveError('invalid','Only this player may issue local inputs.');
    // Capture before applyCommand: input objects belong to the caller and must not alias history.
    const owned=structuredClone([...commands]);
    if(owned.length&&this.recordable){
      this.commandCount+=owned.length;
      if(this.commandCount>MAX_COMMANDS){this.recordable=false;this.inputs.length=0;}
      else this.inputs.push({tick:this.simulation.state.tick+1,commands:owned});
    }
    // Original ordering: player commands first, bot observes the PRE-step state exactly once.
    return this.simulation.step([...commands,...this.bot.think(this.simulation)]);
  }
  checkpoint(view:SavedView={cameraLocked:true}):MatchSave {
    if(!this.recordable)throw new SaveError('limit','Input history exceeded the local save limit.');
    if(this.simulation.isComplete())throw new SaveError('invalid','Finished matches cannot be resumed.');
    return {formatVersion:2,compatibilityId:this.compatibilityId,recipe:structuredClone(this.recipe),tick:this.simulation.state.tick,stateHash:this.simulation.finalHash(),inputs:structuredClone(this.inputs),view:{...view}};
  }
}

/** Rebuild both simulation AND private bot memory. No renderer, sounds, or queued live input runs. */
export async function restoreMatch(save:MatchSave,navigation:Navigation,compatibilityId:string,progress?:(tick:number,total:number)=>Promise<void>):Promise<LocalMatch>{
  const checked=decodeMatchSave(JSON.stringify(save),compatibilityId);
  const match=new LocalMatch(checked.recipe,navigation,compatibilityId);
  let index=0;
  while(match.simulation.state.tick<checked.tick){
    if(match.simulation.isComplete())throw new SaveError('mismatch','Saved match ended before its checkpoint.');
    const next=checked.inputs[index];
    const commands=next?.tick===match.simulation.state.tick+1?next.commands:[];
    if(commands.length)index++;
    match.step(commands);
    if(progress&&match.simulation.state.tick%120===0)await progress(match.simulation.state.tick,checked.tick);
  }
  if(match.simulation.finalHash()!==checked.stateHash)throw new SaveError('mismatch','Saved match did not reproduce its original state.');
  return match;
}
