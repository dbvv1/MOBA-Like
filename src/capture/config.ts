import {CAMERAS,type CameraName} from './cameras.js';
export const CAPTURE_HZ=60,WARMUP_FRAMES=12,CONTENT_VERSION=11 as const;
export const INPUT_NAMES=['idle','march'] as const;
export type InputName=typeof INPUT_NAMES[number];
export const STANDARD_NAME='quiet-five-v1' as const;
export const STANDARD_SHOT='standards-quiet-five-v1' as const;
export const STANDARD_POSE={position:{x:0,y:24,z:18},target:{x:0,y:0,z:0},fov:45} as const;
export interface CaptureConfig {readonly standards?:typeof STANDARD_NAME;readonly shot:CameraName;readonly seed:number;readonly requestedTime:number;readonly startFrame:number;readonly frames:number;readonly input:InputName;}
export function parseCaptureConfig(search:string):CaptureConfig|null {
  const query=new URLSearchParams(search);
  if(!query.has('shot')){if(query.has('standards'))throw new Error('standards requires explicit shot=spawn');return null;}
  for(const key of ['shot','seed','t','frames','input','standards'])if(query.getAll(key).length>1)throw new Error(`Duplicate capture parameter: ${key}`);
  const shot=query.get('shot')!;
  if(!Object.hasOwn(CAMERAS,shot))throw new Error(`Unknown shot '${shot}'; choose ${Object.keys(CAMERAS).join(', ')}`);
  const standards=query.get('standards');
  if(standards!==null&&(standards!==STANDARD_NAME||shot!=='spawn'))throw new Error('standards requires quiet-five-v1 with shot=spawn; it is not a normal gameplay camera');
  const integer=(key:string,fallback:number,min:number,max:number)=>{const raw=query.get(key);if(raw===null)return fallback;const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${key} must be an integer in [${min}, ${max}]`);return value;};
  const raw=query.get('t')??'10',requestedTime=Number(raw);
  if(!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)||!Number.isFinite(requestedTime)||requestedTime<0||requestedTime>120)throw new Error('t must be seconds in [0, 120]');
  const input=query.get('input')??'march';
  if(!INPUT_NAMES.includes(input as InputName))throw new Error(`Unknown input '${input}'; choose ${INPUT_NAMES.join(', ')}`);
  return Object.freeze({...(standards===STANDARD_NAME?{standards}:{}),shot:shot as CameraName,seed:integer('seed',1,0,0xffffffff),requestedTime,startFrame:Math.round(requestedTime*CAPTURE_HZ),frames:integer('frames',1,1,3600),input:input as InputName});
}

/** Public artifact identity is never one of the four gameplay cameras. */
export function captureArtifactIdentity(config:CaptureConfig){
  return config.standards?{captureRole:'content-standards',standardsName:config.standards,shot:STANDARD_SHOT,requestedGameplayShot:config.shot}:{captureRole:'gameplay'};
}
