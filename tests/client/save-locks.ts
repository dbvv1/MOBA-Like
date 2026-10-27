/** Model separate waiting/released promises; no DOM/browser acceptance is implied. */
export function createAsyncLockManager(){
  let held=false;
  const releases:Array<()=>void>=[],callbacks:Array<()=>void>=[];
  const requests:Array<{name:string;options:LockOptions}>=[];
  let pauseCallbacks=false;
  const request=async(name:string,options:LockOptions,callback:(lock:Lock|null)=>unknown)=>{
    if(options.ifAvailable!==true)throw new Error('Save ownership must never queue behind another tab');
    requests.push({name,options});
    // The lock task decides availability before delivering the callback to this agent.
    const granted=!held;if(granted)held=true;
    if(pauseCallbacks)await new Promise<void>(resolve=>callbacks.push(resolve));
    else await Promise.resolve();
    try{return await callback(granted?{name,mode:'exclusive'} as Lock:null);}
    finally{
      // Callback completion does not synchronously finish the UA's release task.
      if(granted)await new Promise<void>(resolve=>releases.push(()=>{held=false;resolve();}));
    }
  };
  return {
    locks:{request} as Pick<LockManager,'request'>,requests,
    get held(){return held;},get releasing(){return releases.length;},get pendingCallbacks(){return callbacks.length;},
    pauseCallbacks(value:boolean){pauseCallbacks=value;},
    deliverCallback(){const next=callbacks.shift();if(!next)throw new Error('No pending lock callback');next();},
    finishRelease(){const next=releases.shift();if(!next)throw new Error('No pending lock release');next();},
  };
}
