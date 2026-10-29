import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
const source=readFileSync(new URL('./standards.mjs',import.meta.url),'utf8');
const body=source.slice(source.lastIndexOf('finally{')+'finally{'.length).trim().replace(/}$/, '');
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
it.each([false,true])('always writes a failed manifest when server close rejects (prior cleanup errors: %s)',async prior=>{
 const report={passed:true},process={exitCode:0},writeFile=vi.fn(),server={close:async()=>{throw new Error('close failure');}};
 await new AsyncFunction('report','resources','cleanup','server','process','writeFile','resolve','output',body)(report,{},async()=>prior?['browser: close failure']:[],server,process,writeFile,(a:string,b:string)=>`${a}/${b}`,'out');
 expect(report.passed).toBe(false);expect(process.exitCode).toBe(1);expect(writeFile).toHaveBeenCalledOnce();expect(JSON.parse(writeFile.mock.calls[0]![1]).cleanup).toContain('browser-server: close failure');
});
it('clean shutdown preserves successful evidence and writes its manifest',async()=>{
 const report={passed:true},process={exitCode:0},writeFile=vi.fn();
 await new AsyncFunction('report','resources','cleanup','server','process','writeFile','resolve','output',body)(report,{},async()=>[],{close:async()=>{}},process,writeFile,(a:string,b:string)=>`${a}/${b}`,'out');
 expect(report.passed).toBe(true);expect(process.exitCode).toBe(0);expect(writeFile).toHaveBeenCalledOnce();
});
