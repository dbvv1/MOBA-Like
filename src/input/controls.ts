import type {AbilitySlot,ContentCatalog} from '../content/types.js';
import type {HeroSnapshot,SimCommand,Snapshot} from '../sim/types.js';
import type {GameWorld} from '../render/world.js';
import {commandForCast,commandForRightClick,isInputElement,validPoint,type Aim} from './commands.js';
import {actionForKey,DEFAULT_BINDINGS,type KeyboardBindings} from './bindings.js';

type Mode={kind:'cast';slot:AbilitySlot}|{kind:'attackMove'}|null;
export function createControls(world:GameWorld,catalog:ContentCatalog,current:()=>{snapshot:Snapshot;hero:HeroSnapshot},enqueue:(command:SimCommand)=>void,say:(text:string)=>void,focusCamera:()=>void,bindings?:Pick<KeyboardBindings,'resolve'|'label'|'cancelCapture'>){
  const abort=new AbortController();const options={signal:abort.signal};let mode:Mode=null;let enabled=true;let lastPointer:{button:number;aim:Aim;command:SimCommand|null}|null=null;
  function setMode(next:Mode){mode=next;world.setTargeting(next?.kind==='cast'?next.slot:null);}
  function release(){setMode(null);lastPointer=null;bindings?.cancelCapture();}
  function skill(slot:AbilitySlot){
    if(!enabled)return;
    const {snapshot,hero}=current();const definition=catalog.heroes[hero.definitionId];const ability=definition&&catalog.abilities[definition.abilities[slot]];
    if(!ability||!hero.alive||snapshot.status!=='running')return;
    if(ability.targetType==='self'){const command=commandForCast(hero,slot,world.aim(),snapshot,catalog);if(command)enqueue(command);setMode(null);}
    else{setMode({kind:'cast',slot});say(`${bindings?.label(slot)??slot} ${ability.name}: left-click ${ability.targetType==='enemyUnit'?'an enemy':'the ground'}; dashed lines show requested aim, not a guaranteed cast. Esc cancels.`);}
  }
  world.canvas.addEventListener('contextmenu',event=>event.preventDefault(),options);
  world.canvas.addEventListener('pointermove',event=>world.setPointer(event.clientX,event.clientY),options);
  world.canvas.addEventListener('pointerleave',()=>world.leavePointer(),options);
  world.canvas.addEventListener('pointerdown',event=>{
    if(!enabled)return;
    if(event.button!==0&&event.button!==2)return;event.preventDefault();world.canvas.focus();world.setPointer(event.clientX,event.clientY);
    const {snapshot,hero}=current();if(!hero.alive||snapshot.status!=='running')return;
    const aim=world.aim();let command:SimCommand|null=null;
    if(event.button===2){setMode(null);command=commandForRightClick(hero,aim,snapshot);}
    else if(mode?.kind==='cast')command=commandForCast(hero,mode.slot,aim,snapshot,catalog);
    else if(mode?.kind==='attackMove'&&validPoint(aim.point))command={type:'attackMove',heroId:hero.id,point:{...aim.point}};
    lastPointer=structuredClone({button:event.button,aim,command});
    if(command){enqueue(command);setMode(null);say('Command queued.');}
    else if(event.button===2)say('No valid attack or movement target here.');
    else if(mode)say('No valid target here. Aim again or press Esc.');
  },options);
  window.addEventListener('keydown',event=>{
    if(!enabled||event.defaultPrevented||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||isInputElement(event.target))return;
    const action=bindings?bindings.resolve(event):actionForKey(DEFAULT_BINDINGS,event);
    if(action==='Q'||action==='W'||action==='E'||action==='R'){event.preventDefault();skill(action);}
    else if(action==='attackMove'){event.preventDefault();setMode({kind:'attackMove'});say('Attack-move: left-click a destination; Esc cancels.');}
    else if(action==='stop'){event.preventDefault();setMode(null);enqueue({type:'stop',heroId:current().hero.id});}
    else if(event.key==='Escape'){setMode(null);say('Aim cancelled.');}
    else if(action==='focusCamera'){event.preventDefault();focusCamera();}
  },options);
  window.addEventListener('blur',release,options);
  return {skill,setEnabled(value:boolean){if(abort.signal.aborted)return;enabled=value;if(!value)release();},inspectPointer:()=>lastPointer?structuredClone(lastPointer):null,dispose(){enabled=false;abort.abort();release();}};
}
