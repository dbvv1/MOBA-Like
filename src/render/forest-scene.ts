import * as THREE from 'three';

export type ForestScene='baseline'|'forest-verge-v1';
/** One whole-scene trial; absent, invalid and duplicate values retain the default. */
export function parseForestScene(search:string):ForestScene{
  const values=new URLSearchParams(search).getAll('scene');
  return values.length===1&&values[0]==='forest-verge-v1'?'forest-verge-v1':'baseline';
}
/** All positions are outside the playable strip; no simulation RNG is consumed. */
export function forestVergeLayout(minX:number,maxX:number){
  const result:Array<{id:'tree'|'rock';x:number;z:number;scale:number;angle:number}>=[];
  for(let i=0,x=minX-15;x<=maxX+15;i++,x+=13){
    for(const side of [-1,1]){
      // Alternating gaps reveal the floor instead of a uniformly repeated fence.
      const gap=(i+(side>0?2:0))%5===2;
      const depth=side*(15.5+2.8*Math.sin(i*1.7+side));
      for(let n=0;n<(gap?1:3);n++)result.push({id:'tree',x:x+Math.sin(n*2.4+i)*3.5,z:depth+side*n*2.3,scale:.78+.13*((i+n)%4),angle:i*.83+n});
      if(i%3===0)result.push({id:'rock',x:x+4,z:side*(10.8+(i%2)*1.3),scale:.75+(i%4)*.14,angle:i*.6});
    }
  }
  return result;
}
/** Shared world-space macro mask stays continuous across independently tessellated
 * road, forest and shoulder meshes. No new samplers or per-frame allocations. */
export function applyForestGround(_geometry:THREE.BufferGeometry,material:THREE.MeshStandardMaterial|THREE.MeshToonMaterial){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.vertexShader='varying vec2 vForestWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvForestWorld=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader='varying vec2 vForestWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float forestPatch=0.5+0.28*sin(vForestWorld.x*0.17+sin(vForestWorld.y*0.21))+0.22*cos(vForestWorld.y*0.31-vForestWorld.x*0.07);
 float forestVerge=smoothstep(3.8,12.0,abs(vForestWorld.y));
 float forestValue=0.87+0.13*forestPatch;
 diffuseColor.rgb*=forestValue*vec3(1.0-0.12*forestVerge,1.0-0.025*forestVerge,0.92+0.03*forestVerge);`);
  };
  material.customProgramCacheKey=()=>key.call(material)+'|forest-verge-v1';material.needsUpdate=true;
}
/** Palette and distance haze are environmental only; don't recolor health,
 * aim indicators, team colors, or unlit combat feedback. */
export function applyForestAtmosphere(scene:THREE.Scene){
  scene.background=new THREE.Color('#344c52');scene.fog=new THREE.Fog('#344c52',65,150);
  scene.traverse(object=>{if(object instanceof THREE.HemisphereLight){object.color.set('#c6dedb');object.groundColor.set('#303f30');object.intensity=1.45;}});
}
