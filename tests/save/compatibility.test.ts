import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveCompatibility} from '../../tools/save-compatibility.js';
describe('build-time replay compatibility identity',()=>{
  it('changes for rules, content, navigation and dependencies, not UI choices',()=>{
    const root=mkdtempSync(join(tmpdir(),'moba-save-identity-'));
    try{
      mkdirSync(join(root,'src/sim/nav'),{recursive:true});mkdirSync(join(root,'src/content'));mkdirSync(join(root,'src/ui'));
      const files=['src/sim/ai.ts','src/sim/nav/lane.navmesh','src/content/catalog.ts','package-lock.json'];
      for(const file of files)writeFileSync(join(root,file),'original');
      const original=saveCompatibility(root);expect(saveCompatibility(root)).toBe(original);
      writeFileSync(join(root,'src/ui/hud.ts'),'new UI');expect(saveCompatibility(root)).toBe(original);
      for(const file of files){writeFileSync(join(root,file),'changed');expect(saveCompatibility(root)).not.toBe(original);writeFileSync(join(root,file),'original');}
      rmSync(join(root,'package-lock.json'));expect(()=>saveCompatibility(root)).toThrow();
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
