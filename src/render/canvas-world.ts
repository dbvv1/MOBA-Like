import type {ContentCatalog,AbilitySlot,Vec2} from '../content/types.js';
import type {Snapshot} from '../sim/types.js';
import type {Aim} from '../input/commands.js';

/** Functional emergency renderer, not a substitute for 3D visual acceptance. */
export function createCanvasWorld(host:HTMLElement,catalog:ContentCatalog){
  const canvas=document.createElement('canvas');canvas.tabIndex=0;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Neither WebGL2 nor Canvas2D is available.');
  host.replaceChildren(canvas);
  let snapshot:Snapshot|null=null,playerId=0,locked=true,slot:AbilitySlot|null=null;
  let pointer:Vec2|null=null,inside=false,focus={x:0,z:0};
  const span=70;
  function fit(){canvas.width=Math.max(1,host.clientWidth||800);canvas.height=Math.max(1,host.clientHeight||600);}
  fit();window.addEventListener('resize',fit);
  const scale=()=>Math.min(canvas.width,canvas.height)/span;
  function aim():Aim{
    if(!pointer||!snapshot)return {point:null,entityId:null};
    const point={x:focus.x+(pointer.x-canvas.width/2)/scale(),z:focus.z+(pointer.z-canvas.height/2)/scale()};
    const picked=snapshot.entities.filter(e=>e.alive&&Math.hypot(e.position.x-point.x,e.position.z-point.z)<2).sort((a,b)=>Math.hypot(a.position.x-point.x,a.position.z-point.z)-Math.hypot(b.position.x-point.x,b.position.z-point.z))[0];
    return {point,entityId:picked?.id??null};
  }
  function draw(seconds:number){
    const player=snapshot?.heroes.find(h=>h.id===playerId);
    if(locked&&player)focus={...player.position};
    else if(inside&&pointer){if(pointer.x>canvas.width*.94)focus.x+=24*seconds;if(pointer.x<canvas.width*.06)focus.x-=24*seconds;if(pointer.z>canvas.height*.94)focus.z+=24*seconds;if(pointer.z<canvas.height*.06)focus.z-=24*seconds;}
    focus.x=Math.max(catalog.map.world.minX,Math.min(catalog.map.world.maxX,focus.x));focus.z=Math.max(catalog.map.world.minZ,Math.min(catalog.map.world.maxZ,focus.z));
    ctx!.fillStyle='#253c31';ctx!.fillRect(0,0,canvas.width,canvas.height);
    ctx!.strokeStyle='#61715b';ctx!.lineWidth=12;ctx!.beginPath();ctx!.moveTo(0,canvas.height/2);ctx!.lineTo(canvas.width,canvas.height/2);ctx!.stroke();
    for(const e of snapshot?.entities??[]){if(!e.alive)continue;const x=canvas.width/2+(e.position.x-focus.x)*scale(),y=canvas.height/2+(e.position.z-focus.z)*scale();ctx!.fillStyle=e.team===0?'#6ed7db':'#e79268';ctx!.beginPath();ctx!.arc(x,y,e.kind==='hero'?8:e.kind==='structure'?12:4,0,Math.PI*2);ctx!.fill();if(e.id===playerId){ctx!.strokeStyle='#ffffff';ctx!.stroke();}}
    ctx!.fillStyle='#ffffff';ctx!.font='14px sans-serif';ctx!.fillText(`Canvas2D recovery · tick ${snapshot?.tick??0}${slot?' · aim '+slot:''}`,12,22);
  }
  return {canvas,aim,groundPoint:()=>aim().point,setPointer(x:number,y:number){const r=canvas.getBoundingClientRect();pointer={x:(x-r.left)*canvas.width/Math.max(1,r.width),z:(y-r.top)*canvas.height/Math.max(1,r.height)};inside=true;},leavePointer(){inside=false;},
    sync(value:Snapshot,id:number){snapshot=value;playerId=id;},draw:(seconds:number,_alpha?:number)=>draw(seconds),
    setLocked(value:boolean){locked=value;},setFocusHeld(_value:boolean){},setTargeting(value:AbilitySlot|null){slot=value;},
    cameraState:()=>({locked,temporaryFollow:false,position:{x:focus.x,y:0,z:focus.z}}),lightingState:()=>({style:'canvas2d-recovery'}),materialState:()=>({requested:null,configured:'canvas2d-recovery',active:null}),effectState:()=>({}),targetingState:()=>({slot}),motionState:()=>({}),
    dispose(){window.removeEventListener('resize',fit);canvas.remove();snapshot=null;}
  };
}
