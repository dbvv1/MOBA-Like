import {createMatchGuide} from './match-guide.js';
import {createCommandNotice} from './command-notice.js';
import {battleMessage,matchResult} from './battle-state.js';
import {skillDescription} from './skill-description.js';
import {abilityViewModel} from '../../asset-pipeline/presentation/icons.js';
import type {AbilitySlot,ContentCatalog} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';

export function createHud(root:HTMLElement,catalog:ContentCatalog,onSkill:(slot:AbilitySlot)=>void,onBuy:(item:string)=>void,onLock:(locked:boolean)=>void,guideEnabled=false){
  root.innerHTML='<div class="battle-status" data-status><strong data-objective></strong><span data-hint></span></div><div class="combat-panel"><div class="hero-panel" data-hero><div class="hero-heading"><strong data-name></strong><span data-level></span></div><div class="resource health"><i data-health-fill></i><span data-health></span></div><div class="resource mana"><i data-mana-fill></i><span data-mana></span></div><span class="gold" data-gold></span></div><div class="skills" data-skills></div><div class="match"><span data-match></span><label><input type="checkbox" data-lock checked> Lock camera</label></div></div><details class="shop-panel"><summary>Equipment <span>Spend your gold</span></summary><div class="shop" data-shop></div></details><div role="status" data-message></div>';
  const find=(selector:string)=>{const node=root.querySelector<HTMLElement>(selector);if(!node)throw new Error('Missing HUD element');return node;};
  const match=find('[data-match]'),heroText=find('[data-hero]'),skills=find('[data-skills]'),shop=find('[data-shop]'),message=find('[data-message]');
  // Keep the existing live region, but announce only actual text changes.
  const setMessage=(text:string)=>{if(message.textContent!==text)message.textContent=text;};
  const notices=createCommandNotice();let currentTime=0,matchEnded=false;
  const abort=new AbortController();root.querySelector<HTMLInputElement>('[data-lock]')!.addEventListener('change',event=>onLock((event.target as HTMLInputElement).checked),{signal:abort.signal});
  const skillButtons=new Map<AbilitySlot,HTMLButtonElement>();
  for(const slot of ['Q','W','E','R'] as const){const button=document.createElement('button');button.type='button';button.addEventListener('click',()=>onSkill(slot),{signal:abort.signal});skills.append(button);skillButtons.set(slot,button);}
  const itemButtons=new Map<string,HTMLButtonElement>();
  for(const item of Object.values(catalog.items)){const button=document.createElement('button');button.type='button';button.textContent=`${item.name} · ${item.cost}g`;button.addEventListener('click',()=>onBuy(item.id),{signal:abort.signal});shop.append(button);itemButtons.set(item.id,button);}
  const guide=guideEnabled?createMatchGuide(root,catalog,onBuy):null;
  if(guide)root.querySelector<HTMLElement>('.shop-panel')!.hidden=true;
  function update(snapshot:Snapshot,playerId:number){
    guide?.update(snapshot,playerId);
    const hero=snapshot.heroes.find(h=>h.id===playerId);if(!hero)return;
    const result=matchResult(snapshot,hero.team);
    matchEnded=result!==null;
    currentTime=snapshot.timeSeconds;setMessage(result?.announcement??notices.read(hero,currentTime));
    match.textContent=`${Math.floor(snapshot.timeSeconds/60)}:${String(Math.floor(snapshot.timeSeconds%60)).padStart(2,'0')} · ${result?.label??'running'}`;
    heroText.querySelector<HTMLElement>('[data-name]')!.textContent=hero.name;
    heroText.querySelector<HTMLElement>('[data-level]')!.textContent=`Lv ${hero.level}`;
    heroText.querySelector<HTMLElement>('[data-health]')!.textContent=`HP ${Math.ceil(hero.hp)} / ${hero.maxHp}`;
    heroText.querySelector<HTMLElement>('[data-mana]')!.textContent=`Mana ${Math.floor(hero.mana)} / ${hero.maxMana}`;
    heroText.querySelector<HTMLElement>('[data-gold]')!.textContent=`◆ ${Math.floor(hero.gold)} gold${hero.shield>0?` · Shield ${Math.ceil(hero.shield)}`:''}`;
    heroText.querySelector<HTMLElement>('[data-health-fill]')!.style.width=`${Math.max(0,Math.min(100,hero.hp/hero.maxHp*100))}%`;
    heroText.querySelector<HTMLElement>('[data-mana-fill]')!.style.width=`${Math.max(0,Math.min(100,hero.mana/hero.maxMana*100))}%`;
    const objective=battleMessage(snapshot,hero,catalog);find('[data-status]').dataset['tone']=objective.tone;find('[data-objective]').textContent=objective.label;find('[data-hint]').textContent=objective.hint;
    for(const model of abilityViewModel(hero,catalog)){
      const button=skillButtons.get(model.slot)!;button.disabled=model.disabled||snapshot.status!=='running';button.title=skillDescription(model.name,catalog.abilities[model.abilityId]!.targetType,snapshot.status==='running'?model.reasons:[...model.reasons,'match ended']);
      // Names are text, and the optional icon URL is generated from our fixed semantic set.
      if(button.dataset['icon']!==(model.icon??'')){
        button.dataset['icon']=model.icon??'';button.replaceChildren();
        if(model.icon){const image=document.createElement('img');image.src=model.icon;image.alt='';image.width=32;image.height=32;button.append(image);}
      }
      let label=button.querySelector('span');if(!label){label=document.createElement('span');button.append(label);}
      label.textContent=`${model.slot}  ${model.name}${model.cooldownSeconds>0?' · '+model.cooldownSeconds.toFixed(1)+'s':''}`;button.dataset['cooling']=String(model.cooldownSeconds>0);
    }
    for(const [id,button]of itemButtons){const item=catalog.items[id]!;button.disabled=!hero.alive||snapshot.status!=='running'||hero.gold<item.cost||hero.items.includes(id);}
  }
  return {update,disable(){for(const button of root.querySelectorAll('button'))button.disabled=true;},setLocked(value:boolean){root.querySelector<HTMLInputElement>('[data-lock]')!.checked=value;},say(text:string){if(matchEnded)return;notices.say(text);setMessage(text);},reject(reason:string){if(matchEnded)return;notices.reject(reason,currentTime);setMessage(`Command rejected: ${reason}`);},dispose(){guide?.dispose();abort.abort();root.replaceChildren();}};
}
