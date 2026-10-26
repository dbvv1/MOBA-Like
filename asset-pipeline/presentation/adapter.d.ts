import type {Group} from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {ContentCatalog} from '../../src/content/types.js';
import type {Snapshot} from '../../src/sim/types.js';
export type CharacterAssets = {blue:GLTF; amber:GLTF};
export const assetUrls: Readonly<{blue:string; amber:string}>;
export function loadCharacterAssets(load?:(url:string)=>GLTF|Promise<GLTF>,options?:{signal?:AbortSignal}):Promise<CharacterAssets>;
export function disposeCharacterAssets(assets:CharacterAssets):void;
export interface Presentation {
  root:Group;
  sync(snapshot:Snapshot):void;
  advance(seconds:number,alpha?:number):void;
  reset():void;
  motionState():Array<{id:number;attached:boolean;visible:boolean;actions:Array<{clip:string;tracks:number;weight:number;time:number}>}>;
  dispose():void;
  inspect():{tick:number|null;heroes:Array<{id:number;action:string;team:number;visible:boolean}>;entities:number};
}
export function createPresentation(options:{catalog:ContentCatalog;assets:CharacterAssets;heroesOnly?:boolean;motionOptions?:{hurtRegion?:'upper'|'full';strike?:number;recovery?:number}}):Presentation;
