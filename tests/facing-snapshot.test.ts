import {describe,expect,it} from 'vitest';
import {hero,makeSim,place} from './helpers.js';

describe('authoritative facing snapshot',()=>{
  it('copies facing without mutating authoritative state or retaining old snapshots',async()=>{
    const sim=await makeSim(8),own=hero(sim,0);
    const before=sim.finalHash(),snapshot=sim.snapshot();
    expect(snapshot.heroes[0]!.facing).toEqual(own.facing);
    (snapshot.heroes[0]!.facing as {x:number;z:number}).x=123;
    expect(sim.finalHash()).toBe(before);
    const previous=sim.snapshot();own.facing={x:0,z:1};
    expect(previous.heroes[0]!.facing).not.toBe(own.facing);
    expect(sim.snapshot().heroes[0]!.facing).toEqual({x:0,z:1});
  });
  for(const version of [8,9] as const)it(`v${version} exposes actual stationary attack and resolved cast direction`,async()=>{
    const sim=await makeSim(version),own=hero(sim,0),enemy=hero(sim,1);
    place(own,{x:0,z:0});place(enemy,{x:0,z:1});
    sim.step([{type:'attack',heroId:own.id,targetId:enemy.id}]);
    expect(sim.snapshot().events.some(e=>e.type==='basicAttack'&&e.sourceId===own.id)).toBe(true);
    expect(sim.snapshot().heroes.find(h=>h.id===own.id)!.facing).toEqual(own.facing);
    expect(own.facing.z).toBeCloseTo(1);
    sim.step([{type:'cast',heroId:own.id,slot:'Q',targetId:null,point:null,direction:{x:1,z:0}}]);
    let resolved=sim.snapshot().events.some(e=>e.type==='castResolved'&&e.heroId===own.id);
    for(let i=0;i<60&&!resolved;i++){sim.step([]);resolved=sim.snapshot().events.some(e=>e.type==='castResolved'&&e.heroId===own.id);}
    expect(resolved).toBe(true);
    expect(sim.snapshot().heroes.find(h=>h.id===own.id)!.facing).toEqual(own.facing);
    expect(own.facing.x).toBeCloseTo(1);
  });
});
