import {preview} from 'vite';
import {access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function startServer(directory=fileURLToPath(new URL('../../../web-dist/',import.meta.url))) {
  await access(resolve(directory,'index.html'));
  const server=await preview({configFile:false,root:dirname(directory),build:{outDir:directory},preview:{host:'127.0.0.1',port:0,open:false}});
  const address=server.httpServer.address();
  if (!address || typeof address==='string') {server.httpServer.close();throw new Error('No loopback TCP address');}
  return {origin:`http://127.0.0.1:${address.port}`,async close(){
    if (!server.httpServer.listening) return;
    server.httpServer.closeAllConnections();
    await new Promise((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));
  }};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const server=await startServer();
  console.log(`MOBA_SMOKE_LOOPBACK=${server.origin}`);
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;try{await server.close();}catch(error){console.error(error);process.exitCode=1;}};
  process.once('SIGINT',close);process.once('SIGTERM',close);
}
