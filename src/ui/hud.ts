import {skillDescription} from './skill-description.js';
import {abilityViewModel} from '../../asset-pipeline/presentation/icons.js';
import type {AbilitySlot,ContentCatalog} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';

export function createHud(root:HTMLElement,catalog:ContentCatalog,onSkill:(slot:AbilitySlot)=>void,onBuy:(item:string)=>void,onLock:(locked:boolean)=>void){
  root.innerHTML='<div class="match"><span data-match></span><label><input type="checkbox" data-lock checked> Lock camera</label></div><div data-hero></div><div class="skills" data-skills></div><div class="shop" data-shop></div><div role="status" data-message></div>';
  const find=(selector:string)=>{const node=root.querySelector<HTMLElement>(selector);if(!node)throw new Error('Missing HUD element');return node;};
  const match=find('[data-match]'),heroText=find('[data-hero]'),skills=find('[data-skills]'),shop=find('[data-shop]'),message=find('[data-message]');
  const abort=new AbortController();root.querySelector<HTMLInputElement>('[data-lock]')!.addEventListener('change',event=>onLock((event.target as HTMLInputElement).checked),{signal:abort.signal});
  const skillButtons=new Map<AbilitySlot,HTMLButtonElement>();
  for(const slot of ['Q','W','E','R'] as const){const button=document.createElement('button');button.type='button';button.addEventListener('click',()=>onSkill(slot),{signal:abort.signal});skills.append(button);skillButtons.set(slot,button);}
  const itemButtons=new Map<string,HTMLButtonElement>();
  for(const item of Object.values(catalog.items)){const button=document.createElement('button');button.type='button';button.textContent=`${item.name} · ${item.cost}g`;button.addEventListener('click',()=>onBuy(item.id),{signal:abort.signal});shop.append(button);itemButtons.set(item.id,button);}
  function update(snapshot:Snapshot,playerId:number){
    const hero=snapshot.heroes.find(h=>h.id===playerId);if(!hero)return;
    match.textContent=`${Math.floor(snapshot.timeSeconds/60)}:${String(Math.floor(snapshot.timeSeconds%60)).padStart(2,'0')} · ${snapshot.status} · Wave combat`;
    heroText.textContent=`${hero.name} · Lv ${hero.level} · HP ${Math.ceil(hero.hp)}/${hero.maxHp} · Mana ${Math.floor(hero.mana)}/${hero.maxMana} · ${Math.floor(hero.gold)}g${hero.alive?'':` · respawn in ${Math.max(0,Math.ceil((hero.respawnAtTick-snapshot.tick)/catalog.rules.tickRate))}s`}`;
    for(const model of abilityViewModel(hero,catalog)){
      const button=skillButtons.get(model.slot)!;button.disabled=model.disabled||snapshot.status!=='running';button.title=skillDescription(model.name,catalog.abilities[model.abilityId]!.targetType,snapshot.status==='running'?model.reasons:[...model.reasons,'match ended']);
      // Names are text, and the optional icon URL is generated from our fixed semantic set.
      if(button.dataset['icon']!==(model.icon??'')){
        button.dataset['icon']=model.icon??'';button.replaceChildren();
        if(model.icon){const image=document.createElement('img');image.src=model.icon;image.alt='';image.width=32;image.height=32;button.append(image);}
      }
      let label=button.querySelector('span');if(!label){label=document.createElement('span');button.append(label);}
      label.textContent=`${model.slot} ${model.name}${model.cooldownSeconds>0?' '+model.cooldownSeconds.toFixed(1)+'s':''}`;
    }
    for(const [id,button]of itemButtons){const item=catalog.items[id]!;button.disabled=!hero.alive||snapshot.status!=='running'||hero.gold<item.cost||hero.items.includes(id);}
  }
  return {update,disable(){for(const button of root.querySelectorAll('button'))button.disabled=true;},setLocked(value:boolean){root.querySelector<HTMLInputElement>('[data-lock]')!.checked=value;},say(text:string){message.textContent=text;},dispose(){abort.abort();root.replaceChildren();}};
}
