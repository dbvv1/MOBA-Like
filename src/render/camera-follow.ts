/** Persistent preference and temporary input ownership are deliberately separate. */
export type CameraFollowPolicy='baseline'|'hold-follow-v1';
export function cameraFollowPolicy(search:string):CameraFollowPolicy {
  const values=new URLSearchParams(search).getAll('camera');
  return values.length===1&&values[0]==='hold-follow-v1'?'hold-follow-v1':'baseline';
}
export function createCameraFollow(policy:CameraFollowPolicy='baseline') {
  let locked=true,held=false,capture=false;
  return {
    get locked(){return locked;},get held(){return held;},get following(){return locked||held;},
    setLocked(value:boolean){locked=value;held=false;},
    setHeld(value:boolean){held=policy==='hold-follow-v1'&&!capture&&value;},
    setCapture(value:boolean){capture=value;held=false;},
  };
}
