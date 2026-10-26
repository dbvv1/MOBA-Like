import {describe,it,expect} from 'vitest';
import {FixedClock} from '../../src/render/clock.js';
describe('fixed browser clock',()=>{
  it('splits frames into exact logic ticks and residual alpha',()=>{const clock=new FixedClock(1/30);let ticks=0;expect(clock.advance(1/60,()=>ticks++)).toBeCloseTo(.5);expect(ticks).toBe(0);expect(clock.advance(1/60,()=>ticks++)).toBeCloseTo(0);expect(ticks).toBe(1);});
  it('caps hidden/stalled frame backlog and resets safely',()=>{const clock=new FixedClock(1/30);let ticks=0;clock.advance(60,()=>ticks++);expect(ticks).toBe(7);clock.reset();expect(clock.advance(0,()=>ticks++)).toBe(0);expect(()=>clock.advance(-1,()=>{})).toThrow();expect(()=>new FixedClock(0)).toThrow();});
});
