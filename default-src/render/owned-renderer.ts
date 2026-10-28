import type * as THREE from 'three';
const closed=new WeakSet<object>();
/** Final shutdown only: this world owns its canvas and will never reuse this context. */
export function disposeOwnedRenderer(renderer:Pick<THREE.WebGLRenderer,'dispose'|'forceContextLoss'|'domElement'>,releaseResources:()=>void=()=>{}):void{
  if(closed.has(renderer))return;closed.add(renderer);
  try{releaseResources();}
  finally{try{renderer.dispose();}finally{try{renderer.forceContextLoss();}finally{renderer.domElement.remove();}}}
}
