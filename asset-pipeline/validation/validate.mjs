import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

// An explicit list prevents empty directory/glob results from passing.
export const variants = ['blue.glb', 'amber.glb', 'blue-long.glb'];
const here = dirname(fileURLToPath(import.meta.url));

export async function validateFile(path, name) {
  const bytes = await readFile(path);
  let externalRequests = 0;
  const report = await validator.validateBytes(new Uint8Array(bytes), {
    uri: name, format: 'glb', maxIssues: 0, writeTimestamp: false,
    externalResourceFunction: async () => {
      externalRequests++;
      throw new Error('These placeholder GLBs must be self-contained');
    },
  });
  return {
    input: name, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    externalRequests, ...report,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--assets-dir')) {
    throw new Error('Usage: node validate.mjs [--assets-dir DIRECTORY]');
  }
  const dir = args.length ? resolve(args[1]) : resolve(here, '../placeholder/assets');
  const results = [];
  let failed = false;
  for (const name of variants) {
    try {
      const result = await validateFile(resolve(dir, name), name);
      const { numErrors, numWarnings, numInfos, numHints, truncated } = result.issues;
      failed ||= numErrors > 0 || result.externalRequests > 0 || truncated;
      console.error(`${name}: errors=${numErrors} warnings=${numWarnings} infos=${numInfos} hints=${numHints}`);
      results.push(result);
    } catch (error) {
      failed = true;
      // Do not leak absolute local paths into reproducible output.
      results.push({ input: name, failure: error.code || 'VALIDATOR_EXCEPTION' });
      console.error(`${name}: failure=${error.code || 'VALIDATOR_EXCEPTION'}`);
    }
  }
  const exit = failed ? 1 : 0;
  console.log(JSON.stringify({ validator: validator.version(), results, exit }, null, 2));
  console.error(`exit=${exit}`);
  process.exitCode = exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
