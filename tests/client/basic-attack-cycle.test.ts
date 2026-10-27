import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {makeSim,hero,place} from '../helpers.js';
import {createMotionState,attackSample} from '../../asset-pipeline/presentation/motion-state.js';
import {createImpacts} from '../../src/render/impact.js';
import {createEffects} from '../../src/render/effects.js';
import {basicAttackStatus} from '../../src/ui/battle-state.js';
import {battleCue} from '../../src/audio/battle.js';

async function arena(){const sim=await makeSim(11),blue=hero(sim,0),red=hero(sim,1);place(blue,{x:0,z:0});place(red,{x:5,z:0});blue.stats.hpRegen=red.stats.hpRegen=0;return{sim,blue,red};}
describe('v11 attack event consumers (CPU, not visual or audio quality)',()=>{
  it('preparation/cancel have no release or hit; commit preserves the true windup and release pose',async()=>{
    const {sim,blue,red}=await arena(),motion=createMotionState(blue.id,sim.catalog);
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);let snapshot=sim.snapshot();motion.consume(snapshot.events,snapshot.timeSeconds,true);
    const first=motion.inspect().attack!;expect(first.windup).toBeGreaterThan(0);expect(first.resolvedAt).toBeNull();
    expect(snapshot.events.map(event=>battleCue(event,snapshot,blue.id))).toEqual([null]);
    sim.step([{type:'stop',heroId:blue.id}]);snapshot=sim.snapshot();motion.consume(snapshot.events,snapshot.timeSeconds,true);
    expect(motion.inspect().attack!.cancelledAt).toBe(snapshot.timeSeconds);expect(attackSample(snapshot.timeSeconds+1,motion.inspect().attack).weight).toBe(0);
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);snapshot=sim.snapshot();motion.consume(snapshot.events,snapshot.timeSeconds,true);
    const restarted=motion.inspect().attack!;while(!sim.snapshot().events.some(e=>e.type==='basicAttack')){sim.step([]);snapshot=sim.snapshot();motion.consume(snapshot.events,snapshot.timeSeconds,true);}
    const committed=motion.inspect().attack!;
    expect(committed.castId).toBe(restarted.castId);expect(committed.startedAt).toBe(restarted.startedAt);expect(committed.windup).toBe(restarted.windup);
    expect(committed.resolvedAt).toBe(snapshot.timeSeconds);expect(attackSample(snapshot.timeSeconds,committed).time).toBeCloseTo(18/30);
    expect(snapshot.events.map(event=>battleCue(event,snapshot,blue.id)?.kind).filter(Boolean)).toEqual(['swing']);
    expect(motion.inspect().hurtAt).toBeNull();
  });
  it('cancelling on the commit tick never samples the basic release pose',async()=>{
    const {sim,blue,red}=await arena(),motion=createMotionState(blue.id,sim.catalog);
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);motion.consume(sim.snapshot().events,sim.timeSeconds,true);const commit=blue.basicAttack!.commitTick;
    while(sim.state.tick<commit-1){sim.step([]);motion.consume(sim.snapshot().events,sim.timeSeconds,true);}
    sim.step([{type:'stop',heroId:blue.id}]);motion.consume(sim.snapshot().events,sim.timeSeconds,true);
    const attack=motion.inspect().attack!;expect(attack.resolvedAt).toBeNull();expect(attack.cancelledAt).toBe(sim.timeSeconds);
    for(const elapsed of [0,.01,.04])expect(attackSample(sim.timeSeconds+elapsed,attack).time).toBeLessThanOrEqual(13/30);
  });
  it('HUD does not claim readiness while dead, controlled, casting or ended',async()=>{
    const {sim}=await arena(),snapshot=sim.snapshot(),hero=snapshot.heroes[0]!;
    expect(basicAttackStatus(snapshot,hero,sim.catalog).label).toBe('Attack · ready');
    for(const [copy,label] of [[{...hero,alive:false},'dead'],[{...hero,stunned:true},'stunned'],[{...hero,castSlot:'Q' as const},'casting']] as const){
      const status=basicAttackStatus(snapshot,copy,sim.catalog);expect(status.label).toBe(`Attack · ${label}`);expect(status.hint).toBe('Attacks are unavailable.');
    }
    expect(basicAttackStatus({...snapshot,status:'timeout'},hero,sim.catalog).label).toBe('Attack · ended');
  });
  it('launch is a short source cue plus a real moving projectile; contact alone produces one ring and hit sound',async()=>{
    const {sim,blue,red}=await arena(),scene=new THREE.Scene(),impacts=createImpacts(scene),effects=createEffects(scene);
    sim.step([{type:'attack',heroId:blue.id,targetId:red.id}]);impacts.sync(sim.snapshot());effects.sync(sim.snapshot());
    expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(0);expect(effects.root.children).toHaveLength(0);
    while(!sim.snapshot().events.some(e=>e.type==='basicAttack'))sim.step([]);
    let snapshot=sim.snapshot();impacts.sync(snapshot);effects.sync(snapshot);impacts.draw(.25);
    const streak=scene.getObjectByName('hero-release-streak')!;expect(streak.scale.z).toBe(.8);
    const projectile=snapshot.projectiles[0]!;expect(projectile.basicAttack?.sourceId).toBe(blue.id);
    const shape=effects.root.getObjectByName(`projectile-${projectile.id}`)!;expect(shape.userData['delivery']).toBe('basicAttack');expect(shape.position.y).toBe(1.2);
    const startX=shape.position.x;sim.step([{type:'move',heroId:blue.id,point:{x:-6,z:0}}]);snapshot=sim.snapshot();effects.sync(snapshot);effects.draw(1);
    expect(blue.position.x).toBeLessThan(0);expect(shape.position.x).toBeGreaterThan(startX);
    for(let i=0;i<40&&!snapshot.events.some(e=>e.type==='basicAttackHit');i++){sim.step([]);snapshot=sim.snapshot();effects.sync(snapshot);impacts.draw(.1);}
    expect(snapshot.events.some(e=>e.type==='basicAttackHit')).toBe(true);expect(effects.root.children).toHaveLength(0);
    impacts.sync(snapshot);impacts.sync(snapshot);impacts.draw(.25);
    expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(1);
    expect(snapshot.events.map(event=>battleCue(event,snapshot,blue.id)?.kind).filter(Boolean)).toEqual(['hit']);
    const hash=sim.finalHash();for(let i=0;i<4;i++)impacts.draw(.1);expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(0);expect(sim.finalHash()).toBe(hash);
    impacts.dispose();effects.dispose();expect(scene.children).toHaveLength(0);
  });
  it('a lethal minion hit keeps feedback after cleanup, without inferring it from disappearance',async()=>{
    const {sim,blue}=await arena();while(!sim.state.entities.some(e=>e.kind==='minion'))sim.step([]);
    const target=sim.state.entities.find(e=>e.kind==='minion'&&e.team===1)!;place(blue,{x:-4,z:0});place(target,{x:0,z:0});target.hp=1;
    sim.state.entities=sim.state.entities.filter(e=>e.kind!=='minion'||e.id===target.id);target.statuses.push({kind:'stun',percent:0,expiresTick:sim.state.tick+100,sourceId:blue.id});
    sim.step([{type:'attack',heroId:blue.id,targetId:target.id}]);for(let i=0;i<60&&sim.getEntityById(target.id);i++)sim.step([]);
    const snapshot=sim.snapshot(),scene=new THREE.Scene(),impacts=createImpacts(scene);expect(sim.getEntityById(target.id)).toBeNull();
    expect(snapshot.events.some(e=>e.type==='basicAttackHit')).toBe(true);impacts.sync(snapshot);impacts.draw(.25);expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(1);
    expect(snapshot.events.map(event=>battleCue(event,snapshot,blue.id)?.kind).filter(Boolean)).toEqual(['hit']);impacts.dispose();
    const absent=createImpacts(scene);absent.sync({...snapshot,events:snapshot.events.filter(event=>event.type!=='basicAttackHit')});expect(scene.getObjectByName('battle-feedback')!.children).toHaveLength(0);absent.dispose();
  });
});
