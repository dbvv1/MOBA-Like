import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { init, importNavMesh, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { DetourNavigation } from '../src/sim/navigation.js';
import type { Vec2 } from '../src/content/types.js';

const start = { x: -94, z: 1.2 };
const end = { x: 94, z: -1.2 };
const owned: DetourNavigation[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const navigation of owned) navigation.destroy();
  owned.length = 0;
});

async function lane() {
  await init();
  const data = await readFile(new URL('../src/sim/nav/lane.navmesh', import.meta.url));
  const { navMesh } = importNavMesh(new Uint8Array(data));
  const navigation = new DetourNavigation(navMesh);
  owned.push(navigation);
  return navigation;
}

async function islands() {
  await init();
  // Real disconnected Detour polygons exercise its successful partial corridor.
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [left, right] of [[-30, -10], [10, 30]]) {
    const base = positions.length / 3;
    positions.push(left!, 0, -5, right!, 0, -5, right!, 0, 5, left!, 0, 5);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const result = generateSoloNavMesh(positions, indices, {
    cs: 0.35, ch: 0.2, walkableHeight: 1.8, walkableClimb: 0.3,
    walkableRadius: 0.5, minRegionArea: 1, mergeRegionArea: 1,
  });
  if (!result.success) throw new Error(result.error);
  const navigation = new DetourNavigation(result.navMesh);
  owned.push(navigation);
  return navigation;
}

function queryOf(navigation: DetourNavigation) {
  return (navigation as unknown as { query: NavMeshQuery }).query;
}

function trackArrays(query: NavMeshQuery, change?: {
  corridor?: (result: ReturnType<NavMeshQuery['findPath']>) => void;
  straight?: (result: ReturnType<NavMeshQuery['findStraightPath']>) => void;
}) {
  const releases: ReturnType<typeof vi.spyOn>[] = [];
  const find = query.findPath.bind(query);
  const straight = query.findStraightPath.bind(query);
  vi.spyOn(query, 'findPath').mockImplementation((...args) => {
    const result = find(...args);
    releases.push(vi.spyOn(result.polys, 'destroy'));
    change?.corridor?.(result);
    return result;
  });
  vi.spyOn(query, 'findStraightPath').mockImplementation((...args) => {
    const result = straight(...args);
    for (const value of [result.straightPath, result.straightPathFlags, result.straightPathRefs]) {
      releases.push(vi.spyOn(value, 'destroy'));
    }
    change?.straight?.(result);
    return result;
  });
  return releases;
}

function originalSuccessfulPath(query: NavMeshQuery, from: Vec2, to: Vec2) {
  const result = query.computePath(
    { x: from.x, y: 0, z: from.z },
    { x: to.x, y: 0, z: to.z },
    { halfExtents: { x: 2, y: 2, z: 2 }, maxPathPolys: 512, maxStraightPathPoints: 512 },
  );
  expect(result.success).toBe(true);
  const points: Vec2[] = [];
  for (const point of result.path) {
    const previous = points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.05) {
      points.push({ x: point.x, z: point.z });
    }
  }
  return { success: true, points, reason: null };
}

describe('caller-owned Detour path query arrays', () => {
  it('keeps successful baked-lane paths equivalent and releases all returned arrays', async () => {
    const navigation = await lane();
    const query = queryOf(navigation);
    const cases: [Vec2, Vec2][] = [
      [start, end], [end, start], [{ x: 0, z: 0 }, { x: 0.02, z: 0.01 }],
    ];
    for (const [from, to] of cases) {
      const expected = originalSuccessfulPath(query, from, to);
      const releases = trackArrays(query);
      expect(navigation.findPath(from, to)).toEqual(expected);
      expect(releases).toHaveLength(4);
      for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
  });

  it('releases every failed unreachable-path corridor and can still query afterward', async () => {
    const navigation = await lane();
    const releases = trackArrays(queryOf(navigation));
    for (let i = 0; i < 100; i += 1) {
      expect(navigation.findPath(start, { x: 500, z: 500 })).toEqual({
        success: false, points: [], reason: 'findPath unsuccessful',
      });
    }
    expect(releases).toHaveLength(100);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
    expect(navigation.findPath(start, end).success).toBe(true);
  });

  it('preserves an actual disconnected-mesh partial route and clamps to its last polygon', async () => {
    const navigation = await islands();
    const query = queryOf(navigation);
    const from = { x: -20, z: 0 }, to = { x: 20, z: 0 };
    const expected = originalSuccessfulPath(query, from, to);
    expect(expected.points.at(-1)!.x).toBeLessThan(0);
    const closest = vi.spyOn(query, 'closestPointOnPoly');
    const releases = trackArrays(query);
    expect(navigation.findPath(from, to)).toEqual(expected);
    expect(closest).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(4);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases an empty corridor returned by the query', async () => {
    const navigation = await lane();
    const releases = trackArrays(queryOf(navigation), { corridor: result => result.polys.resize(0) });
    expect(navigation.findPath(start, end)).toEqual({
      success: false, points: [], reason: 'no polygon path found',
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it.each(['failure', 'empty', 'decode-throw'] as const)('releases corridor and straight arrays on straight-path %s', async fault => {
    const navigation = await lane();
    const releases = trackArrays(queryOf(navigation), {
      straight: result => {
        if (fault === 'failure') result.success = false;
        else if (fault === 'empty') result.straightPathCount = 0;
        else vi.spyOn(result.straightPath, 'get').mockImplementation(() => { throw new Error('decode failed'); });
      },
    });
    const reason = fault === 'failure' ? 'findStraightPath unsuccessful' : fault === 'empty' ? 'no path' : 'decode failed';
    expect(navigation.findPath(start, end)).toEqual({ success: false, points: [], reason });
    expect(releases).toHaveLength(4);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['failure', 'throw'] as const)('releases the partial corridor on endpoint-clamp %s', async fault => {
    const navigation = await islands();
    const query = queryOf(navigation);
    const closest = query.closestPointOnPoly.bind(query);
    const releases = trackArrays(query);
    vi.spyOn(query, 'closestPointOnPoly').mockImplementation((...args) => {
      if (fault === 'throw') throw new Error('clamp failed');
      return { ...closest(...args), success: false };
    });
    expect(navigation.findPath({ x: -20, z: 0 }, { x: 20, z: 0 })).toEqual({
      success: false, points: [], reason: fault === 'throw' ? 'clamp failed' : 'no closest point on last polygon found',
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])('preserves nearest-poly failure %s without acquiring a corridor', async failedCall => {
    const navigation = await lane();
    const query = queryOf(navigation);
    const nearest = query.findNearestPoly.bind(query);
    const releases = trackArrays(query);
    let calls = 0;
    vi.spyOn(query, 'findNearestPoly').mockImplementation((...args) => {
      const result = nearest(...args);
      calls += 1;
      return calls === failedCall ? { ...result, success: false } : result;
    });
    expect(navigation.findPath(start, end)).toEqual({
      success: false, points: [], reason: `findNearestPoly for ${failedCall === 1 ? 'start' : 'end'} position failed`,
    });
    expect(releases).toHaveLength(0);
  });
});
