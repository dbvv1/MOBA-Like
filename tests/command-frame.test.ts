import { describe, expect, it } from 'vitest';
import { Simulation, replayMatch, runBotMatch } from '../src/sim/index.js';
import type { CommandFrame, SimCommand } from '../src/sim/types.js';
import { makeSim, testNavigation } from './helpers.js';

describe('live stable-seat command frames', () => {
  it('allocates stable team/roster seats in the simulation, not by packet arrival', async () => {
    const sim = new Simulation({ seed: 1, contentVersion: 11, navigation: await testNavigation(), heroesPerTeam: 3 });
    expect(sim.inputSeats).toEqual([0, 1].flatMap(team => [0, 1, 2].map(slot => ({ seat: team * 3 + slot, heroId: sim.getHero(team as 0 | 1, slot)!.id }))));
    const seats = sim.inputSeats as {seat:number;heroId:number}[];
    seats[0]!.heroId = -1;
    expect(sim.inputSeats[0]!.heroId).toBe(sim.getHero(0)!.id);
  });

  it('sorts shuffled seat envelopes but preserves move/stop order within the seat and legacy state hash', async () => {
    const old = await makeSim(11, 71), live = await makeSim(11, 71);
    const player = old.getHero(0)!.id, bot = old.getHero(1)!.id;
    const commands: SimCommand[] = [{type:'move', heroId:player, point:{x:0,z:0}}, {type:'stop', heroId:player}, {type:'move',heroId:bot,point:{x:0,z:0}}];
    const frame = live.commandFrame(commands);
    expect(live.step({...frame, inputs:[...frame.inputs].reverse()})).toEqual(old.step(commands));
    expect(live.finalHash()).toBe(old.finalHash());
    const reversed = await makeSim(11, 71);
    reversed.step(reversed.commandFrame([commands[1]!,commands[0]!,commands[2]!]));
    expect(reversed.finalHash()).not.toBe(live.finalHash());
  });

  it('deduplicates identical per-seat retries once, rejecting conflicts atomically', async () => {
    const a = await makeSim(11, 72), b = await makeSim(11, 72);
    const frame = a.commandFrame([{type:'move',heroId:a.getHero(0)!.id,point:{x:0,z:0}}]);
    a.step({...frame, inputs:[frame.inputs[1]!,frame.inputs[0]!,structuredClone(frame.inputs[0]!)]});
    b.step(frame);
    expect(a.finalHash()).toBe(b.finalHash());
    const fresh = await makeSim(11,72), hash = fresh.finalHash();
    expect(() => fresh.step({...frame,inputs:[...frame.inputs,{seat:0,commands:[]}]})).toThrow('conflicting input retry');
    expect(fresh.finalHash()).toBe(hash);
  });

  it('rejects missing/invalid seats, wrong ownership, malformed commands and non-next ticks without mutation', async () => {
    const sim = await makeSim(11,73), frame = sim.commandFrame([]), hash = sim.finalHash();
    const cases: CommandFrame[] = [
      Object.assign(Object.create({tick:1}),{inputs:frame.inputs,extra:true}),
      {...frame,inputs:[Object.assign(Object.create({seat:0}),{commands:[],extra:true}),frame.inputs[1]!] },
      {...frame,tick:0}, {...frame,tick:2}, {...frame,tick:NaN}, {...frame,inputs:[frame.inputs[0]!] },
      {...frame,inputs:[...frame.inputs,{seat:9,commands:[]}]},
      {...frame,inputs:[{seat:0,commands:[{type:'stop',heroId:sim.getHero(1)!.id}]},frame.inputs[1]!] },
      {...frame,inputs:[{seat:0,commands:[{type:'stop',heroId:sim.getHero(0)!.id,mana:999} as SimCommand]},frame.inputs[1]!] },
    ];
    for(const invalid of cases){expect(() => sim.step(invalid)).toThrow();expect(sim.finalHash()).toBe(hash);expect(sim.snapshot().events).toEqual([]);}
    sim.step(frame);
    const nextHash=sim.finalHash();
    expect(() => sim.step(frame)).toThrow('next simulation tick');
    expect(sim.finalHash()).toBe(nextHash);
  });

  it('owns copied local input and explicitly emits empty seats for a no-input tick', async () => {
    const sim = await makeSim(11,74);
    const cmd: SimCommand={type:'move',heroId:sim.getHero(0)!.id,point:{x:0,z:0}};
    const frame=sim.commandFrame([cmd]);cmd.point.x=999;
    expect(frame.inputs[0]!.commands[0]).toMatchObject({point:{x:0,z:0}});
    expect(sim.commandFrame([]).inputs).toEqual(sim.inputSeats.map(({seat})=>({seat,commands:[]})));
  });

  it('records the adopted protocol and replays real multi-bot output with unchanged final hash', async () => {
    const navigation=await testNavigation();
    const match=runBotMatch({seed:75,contentVersion:11,navigation,heroesPerTeam:3,blueDifficulty:'normal',redDifficulty:'normal',maxMatchSeconds:20});
    expect(match.commandCount).toBeGreaterThan(0);
    expect(match.replay.inputProtocol).toBe('stable-seats-v1');
    expect(replayMatch(match.replay,navigation).hashMatches).toBe(true);
    const legacy={...match.replay};delete legacy.inputProtocol;
    expect(replayMatch(legacy,navigation).hashMatches).toBe(true);
  });
});
