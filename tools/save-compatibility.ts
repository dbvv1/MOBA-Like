import {createHash} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
/** Conservative compatibility: rule/content/AI/navigation/dependency edits invalidate old replays. */
export function saveCompatibility(root:string):string{
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
