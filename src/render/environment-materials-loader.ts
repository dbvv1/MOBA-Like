import * as THREE from 'three';

// Immutable source identity, distinct from the runtime decoded bitmap dimensions.
export const environmentSources = {
 'lane-stone-albedo.png': {bytes:2389508,sha256:'a5878abeb7e6ff3ea87e30f74f14bc66a71d77cdbd3802c67e12326605e524c9'},
 'structure-stone-albedo.png': {bytes:2443606,sha256:'67f45b31e7b603c167458e4b3522b79acbe46e70714467cafea2843950490e92'},
 'forest-edge-albedo-v2.png': {bytes:1734711,sha256:'e1569f6e4133a47c7859263da7a6a61403b3b3fdf206c3436462a8dd03dce59d'},
} as const;
export const environmentDecodeOptions: ImageBitmapOptions = {
 resizeWidth:1024,resizeHeight:1024,resizeQuality:'high',
 // Bitmap uploads ignore Texture.flipY/premultiplyAlpha. Apply here, exactly once.
 imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none',
};
export function mipStorageBytes(width:number,height:number){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error('Invalid texture dimensions');
 let bytes=0; do {bytes+=width*height*4;if(width===1&&height===1)break;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}while(true);return bytes;
}
type Dependencies={fetch:typeof fetch;decode:typeof createImageBitmap;digest:typeof crypto.subtle.digest};
export async function loadBoundedEnvironmentTexture(url:string,signal?:AbortSignal,deps?:Dependencies){
 const cancelled=()=>{if(signal?.aborted)throw new Error('Environment material load cancelled');};
 cancelled();
 const source=Object.entries(environmentSources).find(([name])=>new URL(url, 'https://asset.invalid').pathname.endsWith('/'+name));
 // Vite production asset URLs include hashes, so callers provide the source name
 // through a stable fragment; the fragment is never sent in the HTTP request.
 const name=new URL(url,'https://asset.invalid').hash.slice(1);
 const identity=source?.[1]??environmentSources[name as keyof typeof environmentSources];
 if(!identity)throw new Error('Unknown environment source');
 if(!deps&&(typeof createImageBitmap!=='function'||!globalThis.crypto?.subtle))throw new Error('Bounded environment decode unavailable');
 const io=deps??{fetch:globalThis.fetch.bind(globalThis),decode:globalThis.createImageBitmap.bind(globalThis),digest:globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)};
 const response=await io.fetch(url,signal?{signal}:{});if(!response.ok)throw new Error('Environment source HTTP failure');
 const bytes=await response.arrayBuffer();cancelled();
 const view=new DataView(bytes),signature=[137,80,78,71,13,10,26,10];
 if(bytes.byteLength!==identity.bytes||bytes.byteLength<33||signature.some((v,i)=>view.getUint8(i)!==v)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(16)!==1254||view.getUint32(20)!==1254)throw new Error('Environment source PNG identity mismatch');
 const sha256=Array.from(new Uint8Array(await io.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(sha256!==identity.sha256)throw new Error('Environment source SHA256 mismatch');cancelled();
 const bitmap=await io.decode(new Blob([bytes],{type:'image/png'}),{...environmentDecodeOptions});
 let owned=true;const close=()=>{if(owned){owned=false;bitmap.close();}};
 let texture:THREE.Texture|undefined;
 try{
  cancelled();
  if(bitmap.width!==1024||bitmap.height!==1024)throw new Error('Environment decoded dimensions rejected');
  texture=new THREE.Texture(bitmap);
  // Source family is authored/declared sRGB base color; no browser conversion.
  // This declaration is not evidence of calibrated source color or browser output.
  texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.premultiplyAlpha=false;
  texture.userData.environmentDecode={sourceSha256:sha256,sourceBytes:bytes.byteLength,sourceWidth:1254,sourceHeight:1254,requestedWidth:1024,requestedHeight:1024,decodedWidth:bitmap.width,decodedHeight:bitmap.height,options:{...environmentDecodeOptions},estimatedRgba8MipBytes:mipStorageBytes(bitmap.width,bitmap.height)};
  texture.addEventListener('dispose',close);return texture;
 }catch(error){try{texture?.dispose();}finally{close();}throw error;}
}
