/** Optional cosmetic candidates must not hold the existing game hostage.
 * Downloads may finish later; only the value owner can dispose late resources.
 * This is not an AbortSignal/transport-cancellation implementation.
 */
export const CANDIDATE_TIMEOUT_MS=5000;
export function boundedCandidate<T>(work:()=>Promise<T>,release:(value:T)=>void,ms=CANDIDATE_TIMEOUT_MS):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  let settled=false;
  const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('Optional candidate load timed out'));}},ms);
  Promise.resolve().then(work).then(value=>{
   if(settled){release(value);return;}
   settled=true;clearTimeout(timer);resolve(value);
  },error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
 });
}
