import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import lock from '../asset-pipeline/veyra-death-contact/baseline-lock.json';

const repo=fileURLToPath(new URL('../',import.meta.url));
const commit='b489ed38592dc184fffe2ab9b3b186441c7dc9bb';
const files=['manifest.json','exported/veyra-teal.glb','exported/veyra-rust.glb','source/veyra-teal.blend','source/veyra-rust.blend'];
const preparation='Prepare explicitly: python asset-pipeline/veyra-death-contact/tools/baseline.py (requires the pinned commit in local Git; never fetches).';

// Match the Python recipe: overrides are repo-relative, not cwd-relative.
export function resolveVeyraBaselineDir(override=process.env.VEYRA_DEATH_BASELINE_DIR):string{
  return resolve(repo,override||'asset-pipeline/veyra-death-contact/baseline');
}

// Keep the bytes that were verified, so consumers never reopen an unchecked
// path. All five original files are mandatory, including manifest and sources.
export async function readVeyraBaseline(root=resolveVeyraBaselineDir()):Promise<Map<string,Buffer>>{
  if(lock.schemaVersion!==1||lock.commit!==commit||lock.source!=='asset-pipeline/heroes/veyra-release'
    ||lock.files.length!==files.length||new Set(lock.files.map(row=>row.path)).size!==files.length
    ||lock.files.some(row=>!files.includes(row.path)||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<=0)){
    throw new Error('Invalid Veyra baseline-lock.json identity or file set');
  }
  const verified=new Map<string,Buffer>();
  for(const row of lock.files){
    let bytes:Buffer;
    try{bytes=await readFile(resolve(root,row.path));}
    catch{throw new Error(`Missing/unreadable Veyra baseline file: ${row.path}. ${preparation}`);}
    if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256){
      throw new Error(`Veyra baseline identity mismatch: ${row.path} (requires ${commit})`);
    }
    verified.set(row.path,bytes);
  }
  return verified;
}
