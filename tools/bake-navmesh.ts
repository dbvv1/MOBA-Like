import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportNavMesh, init } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { getContent } from '../src/content/index.js';

/**
 * Offline navigation bake. Geometry is deliberately input-only here: the
 * runtime simulation loads the resulting Detour blob and never builds a mesh
 * from scene/render data.
 */
async function main(): Promise<void> {
  const map = getContent(2).map;
  const { minX, maxX, minZ, maxZ } = map.world;
  const y = 0;
  const positions = [
    minX, y, minZ,
    maxX, y, minZ,
    maxX, y, maxZ,
    minX, y, maxZ,
  ];
  const indices = [0, 2, 1, 0, 3, 2];

  await init();
  const result = generateSoloNavMesh(positions, indices, {
    cs: 0.35,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 1.8,
    walkableClimb: 0.3,
    walkableRadius: 0.5,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    buildBvTree: true,
  });
  if (!result.success) {
    throw new Error(`navmesh generation failed: ${result.error}`);
  }

  const bytes = exportNavMesh(result.navMesh);
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/sim/nav/lane.navmesh');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  result.navMesh.destroy();
  console.log(`baked ${bytes.length} bytes to ${target}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
