import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {parseSceneDressing} from '../../src/render/scene-dressing.js';
import {WALKABLE_HALF_DEPTH,groundHeightAt} from '../../src/render/quiet-family.js';
import {createForest} from '../../src/render/forest.js';
import {createTerrainComposition} from '../../src/render/terrain-composition.js';
import {getContent} from '../../src/content/catalog.js';
import type {BattleAssets} from '../../src/render/battle-assets.js';

// Units are at most about two metres tall; anything lower that reaches into the
// walkable strip would be walked through, since dressing has no colliders.
const BODY_TOP=2;

function instanceBoxes(mesh:THREE.InstancedMesh){
  mesh.geometry.computeBoundingBox();
  const boxes:THREE.Box3[]=[],matrix=new THREE.Matrix4();
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);boxes.push(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));}
  return boxes;
}
function intrudes(box:THREE.Box3){return box.min.y<BODY_TOP&&box.min.z<WALKABLE_HALF_DEPTH&&box.max.z>-WALKABLE_HALF_DEPTH;}

describe('forest-lane scene dressing',()=>{
  it('is opt-in and ignores unknown or duplicate values',()=>{
    expect(parseSceneDressing('?scene=forest-lane-v1')).toBe('forest-lane-v1');
    for(const search of ['','?scene=other','?scene=forest-lane-v1&scene=forest-lane-v1'])expect(parseSceneDressing(search)).toBe('baseline');
  });
  it('uses the simulation walkable strip',()=>{
    for(const version of [11,12] as const){const world=getContent(version).map.world;expect(world.maxZ).toBe(WALKABLE_HALF_DEPTH);expect(world.minZ).toBe(-WALKABLE_HALF_DEPTH);}
  });
  it('keeps the walkable strip flat',()=>{
    for(let x=-108;x<=108;x+=.5)for(let z=-WALKABLE_HALF_DEPTH-.3;z<=WALKABLE_HALF_DEPTH+.3;z+=.25)expect(groundHeightAt(x,z)).toBe(0);
  });
  it('never stands a trunk, shrub or rock in the walkable strip',()=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
    const model=()=>({scene:new THREE.Group().add(mesh.clone())});
    const forest=createForest('forest-light-v1',{models:{rock:model(),tree:model()}} as unknown as BattleAssets,WALKABLE_HALF_DEPTH);
    let instances=0;const offenders:string[]=[];
    forest.root.traverse(object=>{
      if(!(object instanceof THREE.InstancedMesh))return;
      for(const box of instanceBoxes(object)){instances++;if(intrudes(box))offenders.push(`${object.name}@${box.getCenter(new THREE.Vector3()).toArray().map(v=>v.toFixed(1)).join(',')}`);}
    });
    expect(instances).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
    forest.dispose();
  });
  it('places shoulder stones outside the walkable strip',()=>{
    const terrain=createTerrainComposition({road:new THREE.Texture(),forest:new THREE.Texture()},'forest-light-v1',undefined,true);
    let stones=0;
    terrain.root.traverse(object=>{
      if(!(object instanceof THREE.InstancedMesh))return;
      for(const box of instanceBoxes(object)){stones++;expect(intrudes(box)).toBe(false);}
    });
    expect(stones).toBeGreaterThan(0);
    terrain.dispose();
  });
});
