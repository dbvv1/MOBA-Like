import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCaptureRun,writeCaptureFrame,writeCaptureReport,captureBundleIdentity,verifyCaptureSource,repeatCheckDescription,verifyServedCaptureBundle} from '../tools/capture-output.js';
const temporary:string[]=[];
async function output(){const path=await mkdtemp(join(tmpdir(),'moba-capture-output-'));temporary.push(path);return path;}
afterEach(async()=>{for(const path of temporary.splice(0))await rm(path,{recursive:true,force:true});});
const commit='a'.repeat(40),bundle='c'.repeat(64),camera='spawn-software-seed1-frame600-r1';
const bytes=(value:string)=>Buffer.from(value);
describe('capture evidence isolation',()=>{
  it('requires the served source identity on local and external consumers',()=>{
    const expected={sourceCommit:commit,sourceDirty:false};expect(()=>verifyCaptureSource({...expected},expected)).not.toThrow();
    expect(()=>verifyCaptureSource({sourceCommit:'b'.repeat(40),sourceDirty:false},expected)).toThrow('source');
    expect(()=>verifyCaptureSource({sourceCommit:commit,sourceDirty:true},expected)).toThrow('source');
    expect(()=>verifyCaptureSource({},expected)).toThrow('source');
  });
  it('does not claim an exact repetition check for a single run',()=>{expect(repeatCheckDescription('spawn',1,'3')).toContain('not performed');expect(repeatCheckDescription('spawn',2,'3')).toContain('exact RGBA');});
  it('keeps a three-frame before run intact when the same output gets a one-frame after run',async()=>{
    const root=await output(),before=await createCaptureRun(root,commit,'march');
    for(let frame=0;frame<3;frame++)await writeCaptureFrame(before,camera,frame,bytes(`before-${frame}`),{sourceCommit:commit,bundleSha256:bundle});
    await writeCaptureReport(before,{passed:true,frames:3,bundle:{sha256:bundle}});
    const original=await readFile(join(before.directory,'report.json'));
    const after=await createCaptureRun(root,commit,'march');
    await writeCaptureFrame(after,camera,0,bytes('after-0'),{sourceCommit:commit,bundleSha256:bundle});
    await writeCaptureReport(after,{passed:true,frames:1,bundle:{sha256:bundle}});
    expect(before.runId).not.toBe(after.runId);
    expect(await readFile(join(before.directory,camera,'00000.png'),'utf8')).toBe('before-0');
    expect(await readFile(join(before.directory,camera,'00002.png'),'utf8')).toBe('before-2');
    expect(await readFile(join(before.directory,'report.json'))).toEqual(original);
    expect((await readdir(join(after.directory,camera))).sort()).toEqual(['00000.json','00000.png']);
    expect(await readdir(root)).toHaveLength(2);
  });
  it('retains actual bundle/source/input identities across revisions and input changes',async()=>{
    const root=await output(),old=await createCaptureRun(root,commit,'idle'),nextCommit='b'.repeat(40),next=await createCaptureRun(root,nextCommit,'march');
    await writeCaptureFrame(old,camera,0,bytes('old'),{sourceCommit:commit,bundleSha256:bundle});
    const nextBundle='d'.repeat(64);
    await writeCaptureFrame(next,camera,0,bytes('new'),{sourceCommit:nextCommit,bundleSha256:nextBundle});
    await writeCaptureReport(next,{sourceCommit:nextCommit,bundle:{sha256:nextBundle}});
    const frame=JSON.parse(await readFile(join(next.directory,camera,'00000.json'),'utf8')),report=JSON.parse(await readFile(join(next.directory,'report.json'),'utf8'));
    expect(frame).toMatchObject({sourceCommit:nextCommit,runnerSourceCommit:nextCommit,bundleSha256:nextBundle,input:'march',runId:next.runId});
    expect(report).toMatchObject({sourceCommit:nextCommit,runnerSourceCommit:nextCommit,bundle:{sha256:nextBundle},input:'march',runId:next.runId});
    expect(JSON.parse(await readFile(join(old.directory,camera,'00000.json'),'utf8'))).toMatchObject({sourceCommit:commit,bundleSha256:bundle,input:'idle',runId:old.runId});
  });
  it('allocates exclusive roots for concurrent identical parameters',async()=>{
    const root=await output(),runs=await Promise.all(Array.from({length:8},()=>createCaptureRun(root,commit,'march')));
    expect(new Set(runs.map(run=>run.directory)).size).toBe(8);
    await Promise.all(runs.map(async(run,index)=>{await writeCaptureFrame(run,camera,0,bytes(String(index)),{});await writeCaptureReport(run,{index});}));
    for(const [index,run] of runs.entries())expect(await readFile(join(run.directory,camera,'00000.png'),'utf8')).toBe(String(index));
  });
  it('refuses duplicate frames and reports instead of overwriting evidence',async()=>{
    const run=await createCaptureRun(await output(),commit,'march');
    await writeCaptureFrame(run,camera,0,bytes('original'),{});await writeCaptureReport(run,{passed:true});
    await expect(writeCaptureFrame(run,camera,0,bytes('replacement'),{})).rejects.toMatchObject({code:'EEXIST'});
    await expect(writeCaptureReport(run,{passed:false})).rejects.toMatchObject({code:'EEXIST'});
    expect(await readFile(join(run.directory,camera,'00000.png'),'utf8')).toBe('original');
    expect(JSON.parse(await readFile(join(run.directory,'report.json'),'utf8')).passed).toBe(true);
  });
  it('rejects invalid identity and relative-path escape',async()=>{
    const root=await output();await expect(createCaptureRun(root,'bad','march')).rejects.toThrow('identity');await expect(createCaptureRun(root,commit,'../idle')).rejects.toThrow('identity');
    const run=await createCaptureRun(root,commit,'march');await expect(writeCaptureFrame(run,'../escape',0,bytes('bad'),{})).rejects.toThrow('path');
  });
  it('fingerprints actual static bundle bytes and detects changed content',async()=>{
    const root=await output();await mkdir(join(root,'assets'));await writeFile(join(root,'capture.html'),'entry');await writeFile(join(root,'assets','capture.js'),'before');
    const first=await captureBundleIdentity(root);expect(await captureBundleIdentity(root)).toEqual(first);expect(first.files.map(file=>file.file)).toEqual(['assets/capture.js','capture.html']);
    await writeFile(join(root,'assets','capture.js'),'after');const second=await captureBundleIdentity(root);expect(second.sha256).not.toBe(first.sha256);expect(second.files[1]).toEqual(first.files[1]);
  });
  it('rejects mismatched, missing or unknown served bundles even with an expected source label',async()=>{
    const root=await output();await writeFile(join(root,'capture.html'),'entry');await writeFile(join(root,'capture.js'),'expected-js');const expected=await captureBundleIdentity(root);
    expect(await verifyServedCaptureBundle(expected,file=>readFile(join(root,file)))).toBe(expected.sha256);
    await expect(verifyServedCaptureBundle(expected,async()=>bytes('different served build'))).rejects.toThrow('mismatch');
    await expect(verifyServedCaptureBundle(expected,async()=>{throw new Error('HTTP 404');})).rejects.toThrow('404');
    await expect(verifyServedCaptureBundle({sha256:'unknown',files:[]},async()=>bytes(''))).rejects.toThrow('empty');
  });
});
