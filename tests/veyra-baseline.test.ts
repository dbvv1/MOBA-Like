import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readVeyraBaseline,resolveVeyraBaselineDir} from './veyra-baseline.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const original=await readVeyraBaseline();
async function withSnapshot(run:(root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'veyra-baseline-test-'));
  try{
    for(const [path,bytes] of original){
      await mkdir(dirname(join(root,path)),{recursive:true});
      await writeFile(join(root,path),bytes);
    }
    await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}

describe('Veyra consumer original baseline',()=>{
  it('resolves the default snapshot and relative/absolute overrides without consulting cwd',()=>{
    expect(resolveVeyraBaselineDir('')).toBe(resolve(repo,'asset-pipeline/veyra-death-contact/baseline'));
    expect(resolveVeyraBaselineDir('other/snapshot')).toBe(resolve(repo,'other/snapshot'));
    expect(resolveVeyraBaselineDir(tmpdir())).toBe(resolve(tmpdir()));
  });
  it('accepts an exact external snapshot and returns only verified original bytes',async()=>{
    await withSnapshot(async root=>expect(await readVeyraBaseline(root)).toEqual(original));
  });
  for(const path of original.keys()){
    it(`fails closed when ${path} is missing`,async()=>{
      await withSnapshot(async root=>{
        await rm(join(root,path));
        await expect(readVeyraBaseline(root)).rejects.toThrow(`Missing/unreadable Veyra baseline file: ${path}. Prepare explicitly:`);
      });
    });
    it(`rejects same-size digest tampering in ${path}`,async()=>{
      await withSnapshot(async root=>{
        const bytes=Buffer.from(original.get(path)!);
        bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
        await writeFile(join(root,path),bytes);
        await expect(readVeyraBaseline(root)).rejects.toThrow(`Veyra baseline identity mismatch: ${path}`);
      });
    });
  }
  it('rejects a changed byte count',async()=>{
    await withSnapshot(async root=>{
      await writeFile(join(root,'exported/veyra-teal.glb'),original.get('exported/veyra-teal.glb')!.subarray(1));
      await expect(readVeyraBaseline(root)).rejects.toThrow('Veyra baseline identity mismatch: exported/veyra-teal.glb');
    });
  });
  it('does not trust a mutable manifest that blesses substituted exports',async()=>{
    await withSnapshot(async root=>{
      const manifest=JSON.parse(original.get('manifest.json')!.toString()) as {assets:{id:string;sha256:string;bytes:number}[]};
      const candidate=await readFile(resolve(repo,'asset-pipeline/veyra-death-contact/exported/veyra-teal.glb'));
      await writeFile(join(root,'exported/veyra-teal.glb'),candidate);
      const asset=manifest.assets.find(entry=>entry.id==='veyra-teal')!;
      asset.sha256=createHash('sha256').update(candidate).digest('hex');
      asset.bytes=candidate.length;
      await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
      await expect(readVeyraBaseline(root)).rejects.toThrow('Veyra baseline identity mismatch: manifest.json');
    });
  });
  it('reports an absent snapshot without preparing it or falling back to the heroes release',async()=>{
    await withSnapshot(async root=>{
      const absent=join(root,'absent');
      await expect(readVeyraBaseline(absent)).rejects.toThrow('Prepare explicitly: python asset-pipeline/veyra-death-contact/tools/baseline.py');
      const {stat}=await import('node:fs/promises');
      await expect(stat(absent)).rejects.toMatchObject({code:'ENOENT'});
    });
  });
});
