/** A posted-message task, not a nested timer or rAF. This changes scheduling,
 * never the number/order of virtual frames, and is not a browser-hang fix. */
export function yieldCaptureTask(signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const channel=new MessageChannel();
    const cleanup=()=>{channel.port1.onmessage=null;channel.port1.close();channel.port2.close();signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(signal.reason);};
    channel.port1.onmessage=()=>{cleanup();resolve();};
    signal.addEventListener('abort',abort,{once:true});
    channel.port2.postMessage(null);
  });
}

export interface FrameAcknowledgment {ready:boolean;frame:number;frames:number;complete:boolean;}
/** Only acknowledge the existing public contract, one frame at a time. */
export async function advanceCaptureFrames(read:()=>FrameAcknowledgment,next:(frame:number)=>boolean,count:1|15,yieldTask:()=>Promise<void>){
  let expected=read().frame,advanced=0;
  for(let i=0;i<count;i++){
    const before=read();
    if(!before.ready)throw new Error('Capture is not ready');
    if(before.frame!==expected)throw new Error('Stale frame acknowledgment');
    if(before.complete||before.frame>=before.frames-1)break;
    if(!next(expected))break;
    const after=read();
    if(after.frame!==expected+1)throw new Error('Capture did not acknowledge exactly one frame');
    expected++;advanced++;
    // Let the page update between visible frames, not only after a 15-draw task.
    if(i+1<count&&!after.complete)await yieldTask();
  }
  return advanced;
}
