import manifest from '../../asset-pipeline/battle/morrow-ranged/manifest.json';
import type {AssetBytePin} from './veyra-contact-pin.js';
// Same full combat trial, same two existing battle slots; no new route.
export const MORROW_RANGED_PINS:readonly AssetBytePin[]=[
 {id:'morrow-teal',file:'asset-pipeline/battle/morrow-ranged/exported/morrow-teal.glb',bytes:168160,sha256:'36f04c77e937d16450c959df5b44d0c9b5a2a48d995bde121eacc44210314f23'},
 {id:'morrow-rust',file:'asset-pipeline/battle/morrow-ranged/exported/morrow-rust.glb',bytes:169036,sha256:'72762163d01b7cc28a3f0f58a23c8120d8d7e8d8b69f2823d11481fa4775c528'},
];
export function morrowRangedPin(id:string):AssetBytePin{
 const pin=MORROW_RANGED_PINS.find(p=>p.id===id),rows=manifest.assets.filter(a=>`morrow-${a.team}`===id);
 if(!pin||rows.length!==1||rows[0]!.bytes!==pin.bytes||rows[0]!.sha256!==pin.sha256)throw new Error(`Morrow ranged release pin mismatch: ${id}`);
 return pin;
}
