import type {ContentCatalog,ItemDefinition} from '../content/types.js';
import type {HeroSnapshot,Snapshot} from '../sim/types.js';
import {matchResult} from './battle-state.js';

export function matchGuideEnabled(search:string):boolean {
  const values=new URLSearchParams(search).getAll('match-guide');
  if(values.length===0)return false;
  if(values.length!==1||values[0]!=='v1')throw new Error('Unknown match-guide candidate');
  return true;
}

/** Describe existing catalog modifiers, not a second balance table. */
export function itemBenefits(item:ItemDefinition):string {
  const values:[[number,string],...Array<[number,string]>]=[
    [item.maxHp,'health'],[item.maxMana,'mana'],[item.attackDamage,'attack damage'],
    [item.armor,'armor'],[item.magicResist,'magic resist'],[item.moveSpeed,'move speed'],
    [item.attackSpeedPercent*100,'% attack speed'],[item.cooldownRate*100,'% cooldown recovery'],
  ];
  return values.filter(([value])=>value!==0).map(([value,label])=>`${value>0?'+':''}${Number(value.toFixed(2))}${label.startsWith('%')?'':' '}${label}`).join(' · ');
}

export function matchGuideModel(snapshot:Snapshot,hero:HeroSnapshot,catalog:ContentCatalog){
  const enemy=(1-hero.team) as 0|1;
  const definitions=catalog.map.pushOrder[hero.team].map(id=>catalog.map.structures.find(s=>s.id===id)!).filter(Boolean);
  const objectives=definitions.map(definition=>{
    const entity=snapshot.entities.find(e=>e.kind==='structure'&&e.team===enemy&&e.name===definition.name);
    return {name:definition.name,alive:entity?.alive??false,hp:entity?.hp??0,maxHp:entity?.maxHp??definition.maxHp,locked:entity?.invulnerable??false};
  });
  const target=objectives.find(value=>value.alive);
  const result=matchResult(snapshot,hero.team);
  const waves=catalog.rules.waves,rate=catalog.rules.tickRate;
  const first=Math.max(1,Math.round(waves.firstWaveTime*rate)),interval=Math.max(1,Math.round(waves.interval*rate));
  const nextNumber=snapshot.tick<first?1:Math.floor((snapshot.tick-first)/interval)+2;
  const nextTick=first+(nextNumber-1)*interval;
  const barracks=snapshot.entities.find(e=>e.kind==='structure'&&e.team===hero.team&&e.structureKind==='barracks');
  const nextSiege=nextNumber>=waves.siegeStartWave&&nextNumber%waves.siegeEvery===0;
  const wave=result?'Match complete':!barracks?.alive?'Your barracks is down — no more allied waves':`Next ${nextSiege?'SIEGE ':''}wave ${nextNumber} in ${Math.max(0,Math.ceil((nextTick-snapshot.tick)/rate))}s`;
  const lower=catalog.rules.xpLevels[hero.level-1]??0,upper=catalog.rules.xpLevels[hero.level];
  const xp=upper===undefined?'Maximum level':`${Math.max(0,Math.floor(hero.xp-lower))} / ${upper-lower} XP to level ${hero.level+1}`;
  const items=Object.values(catalog.items).map(item=>{
    const owned=hero.items.includes(item.id),shortfall=Math.max(0,Math.ceil(item.cost-hero.gold));
    const state=owned?'Equipped':result?'Match ended':!hero.alive?'Available after respawn':shortfall>0?`Need ${shortfall} more gold`:`Buy · ${item.cost} gold`;
    return {id:item.id,name:item.name,benefits:itemBenefits(item),owned,state,disabled:owned||result!==null||!hero.alive||shortfall>0};
  });
  return {objectives,target:result?result.label:target?`Next objective: ${target.name}`:'Enemy objectives cleared',wave,xp,items,
    loadout:hero.items.map(id=>catalog.items[id]?.name??id).join(' · ')||'No equipment yet',
    summary:result?`${result.label} · ${hero.kills} kills / ${hero.deaths} deaths · Level ${hero.level} · Team: ${snapshot.stats.structureKills[hero.team]} structures, ${snapshot.stats.minionKills[hero.team]} minions. ${result.hint}`:null};
}

/** Candidate-only full-match companion; it sends the original buy command via the supplied callback. */
export function createMatchGuide(root:HTMLElement,catalog:ContentCatalog,onBuy:(id:string)=>void){
  const panel=document.createElement('details');panel.className='match-guide';
  const summary=document.createElement('summary');summary.textContent='Match plan & equipment';panel.append(summary);
  const body=document.createElement('div');body.className='match-guide-body';panel.append(body);
  const objective=document.createElement('strong'),wave=document.createElement('p'),route=document.createElement('ol'),growth=document.createElement('p'),loadout=document.createElement('p'),result=document.createElement('p');
  result.setAttribute('role','status');body.append(objective,wave,route,growth,loadout,result);
  const shop=document.createElement('div');shop.className='match-guide-shop';body.append(shop);
  const abort=new AbortController(),buttons=new Map<string,{button:HTMLButtonElement;state:HTMLElement}>();
  for(const item of Object.values(catalog.items)){
    const card=document.createElement('div'),name=document.createElement('strong'),benefits=document.createElement('p'),button=document.createElement('button');
    name.textContent=`${item.name} · ${item.cost} gold`;benefits.textContent=itemBenefits(item);button.type='button';button.addEventListener('click',()=>onBuy(item.id),{signal:abort.signal});
    card.append(name,benefits,button);shop.append(card);buttons.set(item.id,{button,state:button});
  }
  // Focused panel controls retain native keyboard actions; world shortcuts must not consume them.
  panel.addEventListener('keydown',event=>event.stopPropagation(),{signal:abort.signal});
  root.prepend(panel);
  let priorRoute='',ended=false;
  return {update(snapshot:Snapshot,playerId:number){
    const hero=snapshot.heroes.find(value=>value.id===playerId);if(!hero)return;
    const model=matchGuideModel(snapshot,hero,catalog);objective.textContent=model.target;wave.textContent=model.wave;growth.textContent=`Level ${hero.level} · ${model.xp}`;loadout.textContent=`Equipped: ${model.loadout}`;
    const key=JSON.stringify(model.objectives);
    if(key!==priorRoute){priorRoute=key;route.replaceChildren();for(const point of model.objectives){const li=document.createElement('li');li.textContent=`${point.alive?point.locked?'Protected':'Standing':'Destroyed'} · ${point.name}${point.alive?` · ${Math.ceil(point.hp)} / ${point.maxHp} HP`:''}`;li.dataset['destroyed']=String(!point.alive);route.append(li);}}
    for(const item of model.items){const entry=buttons.get(item.id)!;entry.button.disabled=item.disabled;entry.state.textContent=item.state;}
    const text=model.summary??'';if(result.textContent!==text)result.textContent=text;
    if(model.summary&&!ended){panel.open=true;ended=true;}else if(!model.summary)ended=false;
  },dispose(){abort.abort();panel.remove();}};
}
