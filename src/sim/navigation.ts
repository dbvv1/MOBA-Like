import { init, importNavMesh, NavMeshQuery } from 'recast-navigation';
import type { NavMesh } from 'recast-navigation';
import type { Vec2 } from '../content/types.js';
import { distance } from './math.js';

export interface PathResult {
  success: boolean;
  points: Vec2[];
  reason: string | null;
}

export interface Navigation {
  findPath(start: Vec2, end: Vec2): PathResult;
  closestPoint(point: Vec2): Vec2 | null;
}

/**
 * Loads a previously baked Detour navmesh. The simulation layer only receives
 * this query object; it never generates navigation data from render geometry.
 */
export async function createDetourNavigation(data: Uint8Array): Promise<DetourNavigation> {
  await init();
  const { navMesh } = importNavMesh(data);
  return new DetourNavigation(navMesh);
}

export class DetourNavigation implements Navigation {
  private readonly navMesh: NavMesh;
  private readonly query: NavMeshQuery;

  constructor(navMesh: NavMesh) {
    this.navMesh = navMesh;
    this.query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
  }

  findPath(start: Vec2, end: Vec2): PathResult {
    let corridor: ReturnType<NavMeshQuery['findPath']> | undefined;
    let straight: ReturnType<NavMeshQuery['findStraightPath']> | undefined;
    const failed = (reason: string): PathResult => ({ success: false, points: [], reason });
    try {
      const from = { x: start.x, y: 0, z: start.z };
      const to = { x: end.x, y: 0, z: end.z };
      const options = { halfExtents: { x: 2, y: 2, z: 2 } };
      const startPoly = this.query.findNearestPoly(from, options);
      if (!startPoly.success) return failed('findNearestPoly for start position failed');
      const endPoly = this.query.findNearestPoly(to, options);
      if (!endPoly.success) return failed('findNearestPoly for end position failed');

      // The 0.43.1 computePath helper only frees its arrays on success. Use the
      // documented caller-owned query results so every exit releases them.
      corridor = this.query.findPath(startPoly.nearestRef, endPoly.nearestRef, from, to, { maxPathPolys: 512 });
      if (!corridor.success) return failed('findPath unsuccessful');
      if (corridor.polys.size === 0) return failed('no polygon path found');
      const lastPoly = corridor.polys.get(corridor.polys.size - 1);
      let endpoint = to;
      if (lastPoly !== endPoly.nearestRef) {
        const closest = this.query.closestPointOnPoly(lastPoly, to);
        if (!closest.success) return failed('no closest point on last polygon found');
        endpoint = closest.closestPoint;
      }
      straight = this.query.findStraightPath(from, endpoint, corridor.polys, { maxStraightPathPoints: 512 });
      if (!straight.success) return failed('findStraightPath unsuccessful');
      if (straight.straightPathCount === 0) return failed('no path');

      const points: Vec2[] = [];
      for (let i = 0; i < straight.straightPathCount; i += 1) {
        const next = { x: straight.straightPath.get(i * 3), z: straight.straightPath.get(i * 3 + 2) };
        const previous = points[points.length - 1];
        if (!previous || distance(previous, next) > 0.05) {
          points.push(next);
        }
      }

      if (points.length === 0) {
        return { success: false, points: [], reason: 'empty path' };
      }
      return { success: true, points, reason: null };
    } catch (error) {
      return {
        success: false,
        points: [],
        reason: error instanceof Error ? error.message : 'navigation query failed',
      };
    } finally {
      straight?.straightPath.destroy();
      straight?.straightPathFlags.destroy();
      straight?.straightPathRefs.destroy();
      corridor?.polys.destroy();
    }
  }

  closestPoint(point: Vec2): Vec2 | null {
    const result = this.query.findClosestPoint(
      { x: point.x, y: 0, z: point.z },
      { halfExtents: { x: 2, y: 2, z: 2 } },
    );
    if (!result.success) {
      return null;
    }
    return { x: result.point.x, z: result.point.z };
  }

  destroy(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }
}
