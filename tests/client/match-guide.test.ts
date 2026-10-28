import {describe,it,expect} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {matchGuideEnabled,matchGuideModel,itemBenefits,createMatchGuide} from '../../src/ui/match-guide.js';
import {makeSim,hero,structure,place} from '../helpers.js';
const catalog=getContent(10);
const view=(sim:Awaited<ReturnType<typeof makeSim>>)=>{const snapshot=sim.snapshot();return matchGuideModel(snapshot,snapshot.heroes[0]!,sim.catalog);};

describe('existing match progression companion',()=>{
  it('is explicit, rejects malformed requests, and does not opt the normal URL in',()=>{
    expect(matchGuideEnabled('')).toBe(false);expect(matchGuideEnabled('?match-guide=v1')).toBe(true);
    for(const q of ['?match-guide=','?match-guide=v2','?match-guide=v1&match-guide=v1'])expect(()=>matchGuideEnabled(q)).toThrow();
  });
  it('reads catalog effects without mislabeling recovery as cooldown reduction',()=>{
    expect(itemBenefits(catalog.items.wayfarer_boots!)).toContain('+10% cooldown recovery');
    expect(itemBenefits(catalog.items.sunsteel_blade!)).toContain('+12% attack speed');
  });
  it('tracks a real purchase, denies duplicates, and resets inventory on a fresh match',async()=>{
    const sim=await makeSim(10,12),player=hero(sim,0);player.gold=800;
    expect(view(sim).items[0]).toMatchObject({disabled:false,owned:false,state:'Buy · 800 gold'});
    const damage=player.stats.attackDamage;expect(sim.step([{type:'buyItem',heroId:player.id,itemId:'sunsteel_blade'}])[0]?.accepted).toBe(true);
    expect(player.stats.attackDamage).toBe(damage+18);expect(view(sim).items[0]).toMatchObject({disabled:true,owned:true,state:'Equipped'});
    expect(view(sim).loadout).toBe('Sunsteel Blade');
    expect(sim.step([{type:'buyItem',heroId:player.id,itemId:'sunsteel_blade'}])[0]?.reason).toBe('alreadyOwned');
    const reset=await makeSim(10,12);expect(view(reset).loadout).toBe('No equipment yet');
  });
  it('updates next objective when an actual committed attack destroys a tower',async()=>{
    const sim=await makeSim(10,13),player=hero(sim,0),tower=structure(sim,'red-outer-tower');
    expect(view(sim).target).toContain('Red Outer Tower');tower.hp=1;place(player,{x:tower.position.x-4,z:0});
    sim.step([{type:'attack',heroId:player.id,targetId:tower.id}]);
    for(let n=0;n<40&&tower.alive;n++)sim.step([]);
    expect(tower.alive).toBe(false);expect(view(sim).target).toContain('Red Inner Tower');expect(view(sim).objectives[0]?.alive).toBe(false);
  });
  it('matches real wave ticks, siege scheduling, and stops promising waves after barracks loss',async()=>{
    const sim=await makeSim(10,14);expect(view(sim).wave).toBe('Next wave 1 in 8s');
    while(sim.state.waveNumber<2)sim.step([]);
    expect(view(sim).wave).toBe('Next SIEGE wave 3 in 25s');
    const barracks=structure(sim,'blue-barracks');barracks.alive=false;barracks.hp=0;
    expect(view(sim).wave).toContain('no more allied waves');
    const count=sim.state.entities.filter(e=>e.kind==='minion'&&e.team===0&&e.wave===3).length;
    while(sim.state.waveNumber<3)sim.step([]);
    expect(sim.state.entities.filter(e=>e.kind==='minion'&&e.team===0&&e.wave===3)).toHaveLength(count);
  });
  it('supports the opposite team, death, and terminal outcomes without mutating snapshots',async()=>{
    const sim=await makeSim(10,15,{maxMatchSeconds:1}),red=hero(sim,1);red.alive=false;
    let snap=sim.snapshot();const model=matchGuideModel(snap,snap.heroes[1]!,catalog);expect(model.target).toContain('Blue Outer Tower');expect(model.items.every(i=>i.disabled)).toBe(true);
    while(!sim.isComplete())sim.step([]);snap=sim.snapshot();const before=JSON.stringify(snap);const ended=matchGuideModel(snap,snap.heroes[0]!,catalog);
    expect(ended.summary).toContain('TIME LIMIT');expect(ended.wave).toBe('Match complete');expect(ended.items.every(i=>i.disabled)).toBe(true);expect(JSON.stringify(snap)).toBe(before);
  });
  it('derives XP progress from existing thresholds',async()=>{
    const sim=await makeSim(10,16),player=hero(sim,0);player.xp=50;
    expect(view(sim).xp).toBe('50 / 180 XP to level 2');player.level=catalog.rules.xpLevels.length;
    expect(view(sim).xp).toBe('Maximum level');
  });
});

// Minimal DOM adapter: exercise the actual production consumer without launching a browser.
class Node {
  children:Node[]=[];textContent='';className='';type='';disabled=false;open=false;dataset:Record<string,string>={};parent:Node|null=null;
  listeners:Record<string,()=>void>={};
  append(...nodes:Node[]){for(const n of nodes){this.children.push(n);n.parent=this;}}
  prepend(n:Node){this.children.unshift(n);n.parent=this;}
  replaceChildren(){this.children=[];}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(){}
  addEventListener(name:string,fn:()=>void,opts:{signal:AbortSignal}){this.listeners[name]=fn;opts.signal.addEventListener('abort',()=>{delete this.listeners[name];});}
}
it('production panel dispatches only original buy IDs, displays committed ownership, and disposes listeners',async()=>{
  const old=globalThis.document;
  Object.assign(globalThis,{document:{createElement:()=>new Node()}});
  try{
    const root=new Node(),sim=await makeSim(10,17),player=hero(sim,0);player.gold=800;
    const issued:string[]=[];const panel=createMatchGuide(root as unknown as HTMLElement,catalog,id=>{issued.push(id);sim.step([{type:'buyItem',heroId:player.id,itemId:id}]);});
    panel.update(sim.snapshot(),player.id);
    let stopped=false;
    (root.children[0]!.listeners.keydown as unknown as (event:{stopPropagation:()=>void})=>void)({stopPropagation(){stopped=true;}});
    expect(stopped).toBe(true);
    const body=root.children[0]!.children[1]!,button=body.children[6]!.children[0]!.children[2]!;
    expect(button.disabled).toBe(false);button.listeners.click!();panel.update(sim.snapshot(),player.id);
    expect(issued).toEqual(['sunsteel_blade']);expect(button.textContent).toBe('Equipped');expect(button.disabled).toBe(true);
    panel.dispose();expect(root.children).toHaveLength(0);expect(button.listeners.click).toBeUndefined();
  }finally{if(old)Object.assign(globalThis,{document:old});else Reflect.deleteProperty(globalThis,'document');}
});
