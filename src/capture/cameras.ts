import type {CapturePose} from '../render/capture-view.js';
export const CAPTURE_SIZE=Object.freeze({width:1280,height:720});
const normal=(x:number,z=0):CapturePose=>({position:{x,y:24,z:z+18},target:{x,y:0,z},fov:45});
/** Retains the current 45° gameplay lens, not a claimed LoL lens match. */
export const CAMERAS={
  gameplay:{purpose:'Normal locked player-follow view; current gameplay lens',pose:null},
  spawn:{purpose:'Home base, spawn and barracks; normal gameplay scale',pose:normal(-94,1.2)},
  'barracks-road':{purpose:'Friendly barracks and adjacent continuous road; normal gameplay scale, no simulation relocation',pose:normal(-82)},
  'first-tower':{purpose:'Friendly outer tower and its lane/shoulder transition; normal gameplay scale',pose:normal(-28)},
  'spawn-to-tower':{purpose:'Maximum-gap overview: complete home-to-outer-tower environment, including inner tower',pose:{position:{x:-65,y:62,z:46.5},target:{x:-65,y:0,z:0},fov:45}},
} as const;
export type CameraName=keyof typeof CAMERAS;
