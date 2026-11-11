import manifest from '../../asset-pipeline/veyra-death-contact/canonical/manifest.json';

// Pin actual Blender 4.3 canonical build -> UAL1 retarget outputs.
// Only the existing full combat trial consumes these; shipped defaults stay unchanged.
export const VEYRA_CONTACT_PINS=[
  {
    "id": "veyra-teal",
    "file": "asset-pipeline/veyra-death-contact/canonical/exported/veyra-teal.glb",
    "bytes": 181652,
    "sha256": "17bb8e1a3dbfc683167ad153a0e72bccacc41f87e9305d8f5ed60a011be83707"
  },
  {
    "id": "veyra-rust",
    "file": "asset-pipeline/veyra-death-contact/canonical/exported/veyra-rust.glb",
    "bytes": 182508,
    "sha256": "d55535fd6cbc1cd06f7d1d5aeac7c564909cdc0c980cbba65e6cc5999ed8d046"
  }
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
