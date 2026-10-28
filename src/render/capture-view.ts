import type * as THREE from 'three';

export interface CapturePose {
  readonly position: Readonly<{x:number;y:number;z:number}>;
  readonly target: Readonly<{x:number;y:number;z:number}>;
  readonly fov:number;
}
export interface CaptureView {
  readonly width:number;
  readonly height:number;
  readonly pixelRatio:number;
  /** null keeps the ordinary player-follow camera and its lens. */
  readonly pose:CapturePose|null;
}

/** Validate before changing any live camera/renderer state. */
export function copyCaptureView(view:CaptureView):CaptureView {
  if(!Number.isInteger(view.width)||view.width<1||view.width>7680||!Number.isInteger(view.height)||view.height<1||view.height>4320||!Number.isFinite(view.pixelRatio)||view.pixelRatio<=0||view.pixelRatio>2)throw new Error('Invalid capture viewport');
  const pose=view.pose;
  if(pose&&(![pose.fov,...Object.values(pose.position),...Object.values(pose.target)].every(Number.isFinite)||pose.fov<=0||pose.fov>=180||Math.hypot(pose.position.x-pose.target.x,pose.position.y-pose.target.y,pose.position.z-pose.target.z)<.001))throw new Error('Invalid capture camera');
  return {...view,pose:pose?{position:{...pose.position},target:{...pose.target},fov:pose.fov}:null};
}

export function applyCapturePose(camera:THREE.PerspectiveCamera,pose:CapturePose):void {
  camera.fov=pose.fov;camera.position.set(pose.position.x,pose.position.y,pose.position.z);
  camera.lookAt(pose.target.x,pose.target.y,pose.target.z);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}
