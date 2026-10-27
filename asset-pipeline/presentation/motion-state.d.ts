import type {ContentCatalog} from '../../src/content/types.js';
import type {PresentationEvent} from '../../src/sim/types.js';
export interface MotionAttack {action?:'basicAttack';targetId?:number;castId:number|null;startedAt:number;windup:number;resolvedAt:number|null;cancelledAt:number|null;visualStopAt?:number;}
export function createMotionState(actorId:number,catalog:ContentCatalog):{reset():void;consume(events:readonly PresentationEvent[],time:number,alive:boolean):void;finish(time:number):void;inspect():{attack:MotionAttack|null;hurtAt:number|null};};
export function attackSample(time:number,attack:MotionAttack|null,options?:{strike?:number;recovery?:number;fade?:number}):{weight:number;time:number};
