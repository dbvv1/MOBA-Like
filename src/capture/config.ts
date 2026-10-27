import {CAMERAS,type CameraName} from './cameras.js';
export const CAPTURE_HZ=60,WARMUP_FRAMES=12,CONTENT_VERSION=11 as const;
export const INPUT_NAMES=['idle','march'] as const;
export type InputName=typeof INPUT_NAMES[number];
export interface CaptureConfig {readonly shot:CameraName;readonly seed:number;readonly requestedTime:number;readonly startFrame:number;readonly frames:number;readonly input:InputName;}
export function parseCaptureConfig(search:string):CaptureConfig|null {
  const query=new URLSearchParams(search);
  if(!query.has('shot'))return null;
  for(const key of ['shot','seed','t','frames','input'])if(query.getAll(key).length>1)throw new Error(`Duplicate capture parameter: ${key}`);
  const shot=query.get('shot')!;
  if(!Object.hasOwn(CAMERAS,shot))throw new Error(`Unknown shot '${shot}'; choose ${Object.keys(CAMERAS).join(', ')}`);
  const integer=(key:string,fallback:number,min:number,max:number)=>{const raw=query.get(key);if(raw===null)return fallback;const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${key} must be an integer in [${min}, ${max}]`);return value;};
  const raw=query.get('t')??'10',requestedTime=Number(raw);
  if(!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)||!Number.isFinite(requestedTime)||requestedTime<0||requestedTime>120)throw new Error('t must be seconds in [0, 120]');
  const input=query.get('input')??'march';
  if(!INPUT_NAMES.includes(input as InputName))throw new Error(`Unknown input '${input}'; choose ${INPUT_NAMES.join(', ')}`);
  return Object.freeze({shot:shot as CameraName,seed:integer('seed',1,0,0xffffffff),requestedTime,startFrame:Math.round(requestedTime*CAPTURE_HZ),frames:integer('frames',1,1,3600),input:input as InputName});
}
