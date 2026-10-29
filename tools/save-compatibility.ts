import {createHash} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
/** Conservative compatibility: rule/content/AI/navigation/dependency edits invalidate old replays. */
export function saveSourceFingerprint(root:string):string{
  const hash=createHash('sha256');hash.update('local-match-replay-policy-1\0');
  const visit=(directory:string)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(directory,entry.name);
      if(entry.isDirectory())visit(path);
      else if(entry.isFile()){hash.update(relative(root,path).replaceAll('\\','/'));hash.update('\0');hash.update(readFileSync(path));hash.update('\0');}
    }
  };
  visit(join(root,'src/sim'));visit(join(root,'src/content'));hash.update(readFileSync(join(root,'package-lock.json')));
  return hash.digest('hex');
}

/** Only exact, hash-equivalent source revisions may keep a previous save identity.
 * Unknown changes remain incompatible; never broadly accept an old ID at decode time.
 * The command-envelope entry is populated only after old-source replay comparison.
 */
const COMPATIBLE_SOURCE_REVISIONS:Readonly<Record<string,string>>=Object.freeze({
  // Main 261034a -> command-envelope seam: fixed old v1/v2 bytes + continuation
  // hashes in tests/save/envelope-legacy-compatibility.test.ts. Never auto-update.
  '89ab269c54f1d38cba633ca64eaea42b072d0953e78ead0ad02a1328b72ec16a':
    '344653383010aa1167fb3ee4fda475581cf897ff0e1b38649bd46e8151284b7f',
});
export function saveCompatibility(root:string):string{
  const fingerprint=saveSourceFingerprint(root);
  return COMPATIBLE_SOURCE_REVISIONS[fingerprint]??fingerprint;
}
