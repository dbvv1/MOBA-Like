import {describe,it,expect} from 'vitest';
import {fileURLToPath} from 'node:url';
import {cpSync,mkdtempSync,mkdirSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeMatchSave,restoreMatch} from '../../src/save/match.js';
import {saveCompatibility,saveSourceFingerprint} from '../../tools/save-compatibility.js';
import {testNavigation} from '../helpers.js';
import oldV1 from './fixtures/v1-match.json';
import oldV2 from './fixtures/pre-envelope-v2-match.json';
import proof from './fixtures/pre-envelope-provenance.json';

// v2 bytes and continuation hashes were produced by unmodified main 261034a,
// not by the new command-envelope implementation. v1 is the pre-existing fixture.
describe('pre-envelope save bytes survive the playable input seam',()=>{
  it('retains the old ID only for the reviewed exact source, not future rule or dependency edits',()=>{
    const root=fileURLToPath(new URL('../..',import.meta.url));
    const copy=mkdtempSync(join(tmpdir(),'moba-envelope-compat-'));
    try{
      mkdirSync(join(copy,'src'));
      cpSync(join(root,'src/sim'),join(copy,'src/sim'),{recursive:true});
      cpSync(join(root,'src/content'),join(copy,'src/content'),{recursive:true});
      cpSync(join(root,'package-lock.json'),join(copy,'package-lock.json'));
      expect(saveCompatibility(copy)).toBe(proof.compatibilityId);
      for(const file of ['src/sim/simulation.ts','src/sim/ai.ts','src/sim/nav/lane.navmesh','src/content/catalog.ts','package-lock.json']){
        appendFileSync(join(copy,file),'\nchanged');
        expect(saveCompatibility(copy)).not.toBe(proof.compatibilityId);
        expect(saveCompatibility(copy)).toBe(saveSourceFingerprint(copy));
        cpSync(join(root,file),join(copy,file));
      }
    }finally{rmSync(copy,{recursive:true,force:true});}
  });
  it('accepts the real previous build ID and reproduces its checkpoint and later state',async()=>{
    const currentId=saveCompatibility(fileURLToPath(new URL('../..',import.meta.url)));
    expect(currentId).toBe(proof.compatibilityId);
    expect(oldV2.compatibilityId).toBe(proof.compatibilityId);
    const originalBytes=JSON.stringify(oldV2);
    const restored=await restoreMatch(decodeMatchSave(originalBytes,currentId),await testNavigation(),currentId);
    expect(restored.simulation.state.tick).toBe(proof.checkpointTick);
    expect(restored.simulation.finalHash()).toBe(proof.checkpointHash);
    expect(restored.checkpoint({cameraLocked:false}).view.cameraLocked).toBe(false);
    while(restored.simulation.state.tick<proof.continuedTick)restored.step();
    expect(restored.simulation.finalHash()).toBe(proof.continuedHash);
    expect(JSON.stringify(oldV2)).toBe(originalBytes);
    expect(()=>decodeMatchSave(originalBytes,'unreviewed-rule-change')).toThrow(/another rules version/);
  });
  it('accepts historical format-1 schema under the retained real build ID',async()=>{
    // Schema projection, NOT an independently recovered historical production v1 file.
    // The separate original v1 fixture below remains unchanged and independently tested.
    const {view:_view,...checkpoint}=oldV2;
    const projectedV1={...checkpoint,formatVersion:1};
    const currentId=saveCompatibility(fileURLToPath(new URL('../..',import.meta.url)));
    const decoded=decodeMatchSave(JSON.stringify(projectedV1),currentId);
    expect(decoded.view.cameraLocked).toBe(true);
    const restored=await restoreMatch(decoded,await testNavigation(),currentId);
    expect(restored.simulation.finalHash()).toBe(proof.checkpointHash);
    while(restored.simulation.state.tick<proof.continuedTick)restored.step();
    expect(restored.simulation.finalHash()).toBe(proof.continuedHash);
  });
  it('still reads the unchanged historical format-1 fixture, without regenerating its expected hash',async()=>{
    const originalBytes=JSON.stringify(oldV1);
    const decoded=decodeMatchSave(originalBytes,oldV1.compatibilityId);
    expect(decoded.view.cameraLocked).toBe(true);
    const restored=await restoreMatch(decoded,await testNavigation(),oldV1.compatibilityId);
    expect(restored.simulation.finalHash()).toBe('0de0d7f7fb10023c');
    while(restored.simulation.state.tick<720)restored.step();
    expect(restored.simulation.finalHash()).toBe('7a2391f8764b1e14');
    expect(JSON.stringify(oldV1)).toBe(originalBytes);
  });
});
