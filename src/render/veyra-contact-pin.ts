import manifest from '../../asset-pipeline/veyra-death-contact/manifest.json';

// Pin the already received Blender 5.2 source exports, not the binary fallback
// or the separate Blender 4.3 recipe outputs. Only the existing combat trial
// consumes these two files; default/quiet releases keep their own locks.
export const VEYRA_CONTACT_PINS=[
  {id:'veyra-teal',file:'asset-pipeline/veyra-death-contact/exported/veyra-teal.glb',bytes:164164,sha256:'32102965a65ea13248cbb88d28f522e3e3f8b9bd5ccf99dc9b3dedcf5ab60e12'},
  {id:'veyra-rust',file:'asset-pipeline/veyra-death-contact/exported/veyra-rust.glb',bytes:165016,sha256:'80e0512ca0f57aed589c8a0aca9f5c1de4d0aa789f6dd43a0ab0a2beb1a2e921'},
] as const;
export type VeyraContactPin=typeof VEYRA_CONTACT_PINS[number];

export function veyraContactPin(id:string):VeyraContactPin{
  const pin=VEYRA_CONTACT_PINS.find(entry=>entry.id===id);
  const entries=manifest.assets.filter(entry=>entry.id===id);
  if(!pin||entries.length!==1||entries[0]!.file!==pin.file||entries[0]!.bytes!==pin.bytes||entries[0]!.sha256!==pin.sha256)
    throw new Error(`Veyra contact release pin mismatch: ${id}`);
  return pin;
}

export async function verifyVeyraContactBytes(bytes:ArrayBuffer,pin:VeyraContactPin):Promise<void>{
  if(bytes.byteLength!==pin.bytes)throw new Error(`Veyra contact byte count mismatch: ${pin.id}`);
  if(!globalThis.crypto?.subtle)throw new Error('Veyra contact SHA-256 verification unavailable');
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==pin.sha256)throw new Error(`Veyra contact SHA-256 mismatch: ${pin.id}`);
}
