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
  // commandBufferDiscarded adds derived output only. Compared with 935e8a24:
  // all eight versions matched inputs, results and per-tick state for 3600 ticks;
  // the real v12 stun-discard fixture also matched all 80 ticks (hash asserted
  // in buffer-discard-feedback.test.ts). Historical save fixtures remain fixed.
  'c32f291808b8286ebc95503a66e79b6e30c6aeaecaccc44c88d685a989e845fd':
    '344653383010aa1167fb3ee4fda475581cf897ff0e1b38649bd46e8151284b7f',
  // goldAwarded is a derived per-step presentation event: loading the 0811894
  // source as a separate baseline runtime and running
  // tools/check-gold-event-compatibility.ts --ticks 3600 --seed 1 matched every
  // per-tick state hash and serialized state on all supported versions, so old
  // saves keep their rules identity.
  'd17a4ff6d9bd482c7f6ea0cb947796737e3c5684d5c9c3301f42983681b62a51':
    '344653383010aa1167fb3ee4fda475581cf897ff0e1b38649bd46e8151284b7f',
  // v12 is opt-in; v1–v11 source paths and historical save continuation stay exact.
  '0d72f0b19b4f50a21a93e8fa8f173f39f8578fdc2e7a8f943812308817d6276e':
    '344653383010aa1167fb3ee4fda475581cf897ff0e1b38649bd46e8151284b7f',
  // Main 261034a -> command-envelope seam: fixed old v1/v2 bytes + continuation
  // hashes in tests/save/envelope-legacy-compatibility.test.ts. Never auto-update.
  '89ab269c54f1d38cba633ca64eaea42b072d0953e78ead0ad02a1328b72ec16a':
    '344653383010aa1167fb3ee4fda475581cf897ff0e1b38649bd46e8151284b7f',
});
export function saveCompatibility(root:string):string{
  const fingerprint=saveSourceFingerprint(root);
  return COMPATIBLE_SOURCE_REVISIONS[fingerprint]??fingerprint;
}
