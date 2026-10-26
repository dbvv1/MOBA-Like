import type {AbilitySlot,ContentCatalog} from '../content/types.js';
import type {HeroSnapshot,SimCommand,Snapshot} from '../sim/types.js';
import type {GameWorld} from '../render/world.js';
import {commandForCast,isInputElement,moveCommand,validPoint} from './commands.js';

type Mode={kind:'cast';slot:AbilitySlot}|{kind:'attackMove'}|null;
export function createControls(world:GameWorld,catalog:ContentCatalog,current:()=>{snapshot:Snapshot;hero:HeroSnapshot},enqueue:(command:SimCommand)=>void,say:(text:string)=>void,focusCamera:()=>void){
  const abort=new AbortController();const options={signal:abort.signal};let mode:Mode=null;
  function skill(slot:AbilitySlot){
    const {snapshot,hero}=current();const definition=catalog.heroes[hero.definitionId];const ability=definition&&catalog.abilities[definition.abilities[slot]];
    if(!ability||!hero.alive||snapshot.status!=='running')return;
    if(ability.targetType==='self'){const command=commandForCast(hero,slot,world.aim(),snapshot,catalog);if(command)enqueue(command);mode=null;}
    else{mode={kind:'cast',slot};say(`${slot} ${ability.name}: left-click ${ability.targetType==='enemyUnit'?'an enemy':'the ground'}; Esc cancels.`);}
  }
  world.canvas.addEventListener('contextmenu',event=>event.preventDefault(),options);
  world.canvas.addEventListener('pointermove',event=>world.setPointer(event.clientX,event.clientY),options);
  world.canvas.addEventListener('pointerleave',()=>world.leavePointer(),options);
  world.canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0&&event.button!==2)return;event.preventDefault();world.canvas.focus();world.setPointer(event.clientX,event.clientY);
    const {snapshot,hero}=current();if(!hero.alive||snapshot.status!=='running')return;
    const aim=world.aim();let command:SimCommand|null=null;
    if(event.button===2){mode=null;command=moveCommand(hero.id,aim.point);}
    else if(mode?.kind==='cast')command=commandForCast(hero,mode.slot,aim,snapshot,catalog);
    else if(mode?.kind==='attackMove'&&validPoint(aim.point))command={type:'attackMove',heroId:hero.id,point:{...aim.point}};
    if(command){enqueue(command);mode=null;say('Command queued.');}
    else if(mode)say('No valid target here. Aim again or press Esc.');
  },options);
  window.addEventListener('keydown',event=>{
    if(event.repeat||event.altKey||event.ctrlKey||event.metaKey||isInputElement(event.target))return;
    const key=event.key.toUpperCase();
    if(['Q','W','E','R'].includes(key)){event.preventDefault();skill(key as AbilitySlot);}
    else if(key==='A'){event.preventDefault();mode={kind:'attackMove'};say('Attack-move: left-click a destination; Esc cancels.');}
    else if(key==='S'){event.preventDefault();mode=null;enqueue({type:'stop',heroId:current().hero.id});}
    else if(key==='ESCAPE'){mode=null;say('Aim cancelled.');}
    else if(event.code==='Space'){event.preventDefault();focusCamera();}
  },options);
  return {skill,dispose(){abort.abort();mode=null;}};
}
