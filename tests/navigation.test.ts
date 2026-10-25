import { describe, expect, it } from 'vitest';
import { distance } from '../src/sim/math.js';
import { testNavigation } from './helpers.js';

describe('offline Detour navigation input', () => {
  it('loads the baked navmesh and finds a path across the lane', async () => {
    const navigation = await testNavigation();
    const path = navigation.findPath({ x: -94, z: 1.2 }, { x: 94, z: -1.2 });
    expect(path.success).toBe(true);
    expect(path.points.length).toBeGreaterThanOrEqual(2);
    expect(distance(path.points[0]!, { x: -94, z: 1.2 })).toBeLessThan(0.2);
    expect(distance(path.points[path.points.length - 1]!, { x: 94, z: -1.2 })).toBeLessThan(0.2);
  });

  it('snaps an out-of-lane point back to walkable ground', async () => {
    const navigation = await testNavigation();
    const snapped = navigation.closestPoint({ x: 0, z: 10 });
    expect(snapped).not.toBeNull();
    expect(Math.abs(snapped!.z)).toBeLessThanOrEqual(9);
  });

  it('does not silently fall back to a straight line for an unreachable far point', async () => {
    const navigation = await testNavigation();
    const path = navigation.findPath({ x: -94, z: 0 }, { x: 500, z: 500 });
    expect(path.success).toBe(false);
    expect(path.points).toHaveLength(0);
    expect(path.reason).not.toBeNull();
  });
});
