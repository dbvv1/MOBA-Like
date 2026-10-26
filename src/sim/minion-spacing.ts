import type {Vec2} from '../content/types.js';

export interface SpacingBody {id:number;position:Readonly<Vec2>;radius:number;movable:boolean}
/** Jacobi contact correction: every pair reads the same positions, never RNG. */
export function minionSpacing(bodies:readonly SpacingBody[],maxDisplacement:number):Map<number,Vec2>{
  const sorted=[...bodies].sort((a,b)=>a.id-b.id),offsets=new Map<number,Vec2>();
  for(const body of sorted)offsets.set(body.id,{x:0,z:0});
  for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
    const a=sorted[i]!,b=sorted[j]!,dx=b.position.x-a.position.x,dz=b.position.z-a.position.z;
    const length=Math.hypot(dx,dz),overlap=a.radius+b.radius-length;
    if(overlap<=0||(!a.movable&&!b.movable))continue;
    // Exact coincidence has no geometric normal. Stable ID chooses opposite
    // lateral sides; no team receives priority and no random draw is consumed.
    const nx=length>1e-8?dx/length:0,nz=length>1e-8?dz/length:1;
    const total=Number(a.movable)+Number(b.movable),share=overlap/total;
    if(a.movable){const v=offsets.get(a.id)!;v.x-=nx*share;v.z-=nz*share;}
    if(b.movable){const v=offsets.get(b.id)!;v.x+=nx*share;v.z+=nz*share;}
  }
  for(const offset of offsets.values()){
    const length=Math.hypot(offset.x,offset.z);
    if(length>maxDisplacement&&length>0){offset.x*=maxDisplacement/length;offset.z*=maxDisplacement/length;}
  }
  return offsets;
}
