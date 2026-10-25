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
    try {
      const result = this.query.computePath(
        { x: start.x, y: 0, z: start.z },
        { x: end.x, y: 0, z: end.z },
        {
          halfExtents: { x: 2, y: 2, z: 2 },
          maxPathPolys: 512,
          maxStraightPathPoints: 512,
        },
      );

      if (!result.success || result.path.length === 0) {
        return {
          success: false,
          points: [],
          reason: result.error?.name ?? 'no path',
        };
      }

      const points: Vec2[] = [];
      for (const point of result.path) {
        const next = { x: point.x, z: point.z };
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
