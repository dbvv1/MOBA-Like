import {describe,it,expect} from 'vitest';
import {hero,makeSim,perform,place,stepMany} from './helpers.js';

describe('read-only effect presentation snapshots',()=>{
  it('copies a real projectile direction/width without exposing live state',async()=>{
    const sim=await makeSim(2,910),blue=hero(sim,0);place(blue,{x:0,z:0});
    expect(perform(sim,{type:'cast',heroId:blue.id,slot:'Q',direction:{x:1,z:0},point:null,targetId:null}).accepted).toBe(true);
    for(let i=0;i<20&&!sim.state.projectiles.length;i++)sim.step([]);
    const snapshot=sim.snapshot(),projectile=snapshot.projectiles[0]!,live=sim.state.projectiles[0]!;
    expect(projectile).toBeDefined();expect(projectile.direction).toEqual(live.direction);expect(projectile.width).toBe(live.width);
    const before=sim.finalHash();
    // @ts-expect-error presentation direction is readonly
    projectile.direction.x=123;
    // @ts-expect-error presentation width is readonly
    projectile.width=999;
    expect(sim.finalHash()).toBe(before);expect(live.direction.x).toBe(1);
    const stable=sim.snapshot(),serialized=JSON.stringify(stable);stepMany(sim,20);expect(JSON.stringify(stable)).toBe(serialized);
  });
  it('exposes actual delayed-area timing and deeply copied positions until trigger',async()=>{
    const sim=await makeSim(2,911),blue=hero(sim,0);place(blue,{x:0,z:0});
    expect(perform(sim,{type:'cast',heroId:blue.id,slot:'R',direction:null,point:{x:5,z:0},targetId:null}).accepted).toBe(true);
    for(let i=0;i<20&&!sim.state.delayedAreas.length;i++)sim.step([]);
    const snapshot=sim.snapshot(),area=snapshot.delayedAreas[0]!,live=sim.state.delayedAreas[0]!;
    expect(area).toEqual({id:live.id,team:live.team,abilityId:live.abilityId,position:live.position,radius:live.radius,triggerTick:live.triggerTick});
    expect(area.triggerTick).toBeGreaterThan(snapshot.tick);const hash=sim.finalHash();
    // @ts-expect-error presentation position is readonly
    area.position.x=999;
    // @ts-expect-error presentation timing is readonly
    area.triggerTick=0;
    expect(sim.finalHash()).toBe(hash);expect(live.position.x).toBe(5);
    const stable=sim.snapshot(),serialized=JSON.stringify(stable);stepMany(sim,30);
    expect(sim.snapshot().delayedAreas).toHaveLength(0);expect(JSON.stringify(stable)).toBe(serialized);
  });
});
