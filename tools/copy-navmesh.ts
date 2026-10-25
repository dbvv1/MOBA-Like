import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolve(root, 'src/sim/nav/lane.navmesh');
  const target = resolve(root, 'dist/src/sim/nav/lane.navmesh');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`copied ${target}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
