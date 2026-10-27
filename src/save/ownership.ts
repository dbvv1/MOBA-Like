/** One coordinator per document, never shared between tabs. */
export function createSaveOwnership(getLocks:()=>Pick<LockManager,'request'>|undefined){
  const releasing=new Set<Promise<void>>();
  return async function acquireSaveOwnership(signal?:AbortSignal):Promise<(()=>void)|null>{
    // Only await this document's relinquished requests, never another tab's owner.
    while(releasing.size&&!signal?.aborted){
      const done=Promise.all([...releasing]);
      if(!signal)await done;
      else await new Promise<void>(resolve=>{
        const finish=()=>{signal.removeEventListener('abort',finish);resolve();};
        signal.addEventListener('abort',finish,{once:true});void done.then(finish);
      });
    }
    if(signal?.aborted)return null;
    let locks:Pick<LockManager,'request'>|undefined;
    try{locks=getLocks();}catch{return null;}
    if(!locks)return null;
    return new Promise(resolve=>{
      let finishHold=()=>{},releaseRequested=false;
      let finishRelease!:()=>void;
      const released=new Promise<void>(done=>{finishRelease=done;});
      const release=()=>{
        if(releaseRequested)return;releaseRequested=true;
        releasing.add(released);void released.then(()=>releasing.delete(released));
        finishHold();
      };
      const cancel=()=>{release();resolve(null);};
      const complete=()=>{signal?.removeEventListener('abort',cancel);finishRelease();};
      const failed=()=>{resolve(null);complete();};
      signal?.addEventListener('abort',cancel,{once:true});
      try{
        // ifAvailable cannot be combined with the native signal option. A cancelled
        // callback instead returns immediately, and its release remains a barrier.
        void locks.request('ashen-furrow-local-match',{ifAvailable:true},async lock=>{
          if(!lock||releaseRequested){resolve(null);return;}
          await new Promise<void>(unlock=>{finishHold=unlock;resolve(release);});
        }).then(complete,failed);
      }catch{failed();}
      // request() settles AFTER native release; resolving finishHold alone is not
      // enough for an immediate New match. https://w3c.github.io/web-locks/#locks
    });
  };
}
