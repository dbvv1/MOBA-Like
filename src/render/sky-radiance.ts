import {DataUtils,MathUtils,type DataTexture} from 'three';

export const SKY_SUN_SEPARATION=Object.freeze({innerDegrees:2,outerDegrees:5,ringDegrees:8});

/**
 * A real-time sky light must not contain an unshadowed duplicate of the sun.
 * Replace only the small solar neighbourhood by its surrounding sky, before
 * PMREM convolution. The directional light supplies that direct-light role.
 * This is an art-directed daylight rig, not an absolute photometric calibration.
 * Original asset bytes and all pixels outside the angular mask are unchanged.
 */
export function separateSkyRadiance(texture:DataTexture){
  const {width,height,data}=texture.image;
  if(!(data instanceof Uint16Array)&&!(data instanceof Float32Array))throw new Error('Expected linear half/float HDR radiance');
  if(width<2||height<2||data.length!==width*height*4)throw new Error('Invalid equirectangular radiance dimensions');
  const read=(i:number)=>data instanceof Uint16Array?DataUtils.fromHalfFloat(data[i]!):data[i]!;
  const write=(i:number,value:number)=>{data[i]=data instanceof Uint16Array?DataUtils.toHalfFloat(value):value;};
  let peak=-1,peakLuminance=-1;
  // The sun is above the horizon. Do not treat a bright lower-hemisphere object
  // as the sun if a different HDR is accidentally supplied.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,r=read(i),g=read(i+1),b=read(i+2),a=read(i+3);
    if(!Number.isFinite(r)||!Number.isFinite(g)||!Number.isFinite(b)||!Number.isFinite(a)||r<0||g<0||b<0||a<0)
      throw new Error('Invalid HDR radiance sample');
    if(y>=Math.ceil(height/2))continue;
    const luminance=.2126*r+.7152*g+.0722*b;
    if(luminance>peakLuminance){peak=i;peakLuminance=luminance;}
  }
  const peakX=(peak/4)%width,peakY=Math.floor(peak/4/width);
  const theta=(peakY+.5)*Math.PI/height,phi=(peakX+.5)*2*Math.PI/width;
  const direction=[Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)];
  const cosInner=Math.cos(MathUtils.degToRad(SKY_SUN_SEPARATION.innerDegrees));
  const cosOuter=Math.cos(MathUtils.degToRad(SKY_SUN_SEPARATION.outerDegrees));
  const cosRing=Math.cos(MathUtils.degToRad(SKY_SUN_SEPARATION.ringDegrees));
  const cosPhi=Array.from({length:width},(_,x)=>Math.cos((x+.5)*2*Math.PI/width));
  const sinPhi=Array.from({length:width},(_,x)=>Math.sin((x+.5)*2*Math.PI/width));
  const mask:Array<{i:number;weight:number}>=[],ring:number[][]=[[],[],[]];
  for(let y=0;y<Math.ceil(height/2);y++){
    const rowTheta=(y+.5)*Math.PI/height,sinTheta=Math.sin(rowTheta),cosTheta=Math.cos(rowTheta);
    for(let x=0;x<width;x++){
      const dot=sinTheta*(cosPhi[x]!*direction[0]!+sinPhi[x]!*direction[2]!)+cosTheta*direction[1]!;
      const i=(y*width+x)*4;
      if(dot>cosOuter)mask.push({i,weight:MathUtils.smoothstep(dot,cosOuter,cosInner)});
      else if(dot>cosRing)for(let c=0;c<3;c++)ring[c]!.push(read(i+c));
    }
  }
  if(ring.some(channel=>channel.length===0))throw new Error('HDR too small to isolate the solar neighbourhood');
  const sky=ring.map(channel=>{channel.sort((a,b)=>a-b);return channel[Math.floor(channel.length/2)]!;});
  const skyLuminance=.2126*sky[0]!+.7152*sky[1]!+.0722*sky[2]!;
  // An overcast map has no solar hotspot: preserve it, do not invent one.
  if(peakLuminance<Math.max(1,skyLuminance*16))return {separated:false,peakLuminance,peakX,peakY,pixels:0,sky};
  for(const {i,weight} of mask)for(let c=0;c<3;c++)write(i+c,MathUtils.lerp(read(i+c),sky[c]!,weight));
  texture.needsUpdate=true;
  return {separated:true,peakLuminance,peakX,peakY,pixels:mask.length,sky};
}
