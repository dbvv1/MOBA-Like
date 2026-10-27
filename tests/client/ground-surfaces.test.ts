import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {createGroundSurfaces} from '../../src/render/ground-surfaces.js';
import source from '../../asset-pipeline/ground-surfaces/exported/grass-geometries.json';

describe('sparse ground shoulder source',()=>{
  it('preserves the 9.6m combat centre and keeps all foliage below half a metre',()=>{
    const surface=createGroundSurfaces();surface.root.updateMatrixWorld(true);
    surface.root.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return;
      const position=node.geometry.getAttribute('position'),matrix=new THREE.Matrix4();
      const count=node instanceof THREE.InstancedMesh?node.count:1;
      for(let i=0;i<count;i++){
        if(node instanceof THREE.InstancedMesh)node.getMatrixAt(i,matrix);else matrix.identity();
        for(let j=0;j<position.count;j++){
          const p=new THREE.Vector3().fromBufferAttribute(position,j).applyMatrix4(matrix);
          expect(Math.abs(p.z)).toBeGreaterThanOrEqual(4.8-1e-6);expect(p.y).toBeLessThan(.5);
        }
      }
    });surface.dispose();
  });
  it('uses exactly three opaque draws, zero textures, no shadow casting or gameplay identity',()=>{
    const surface=createGroundSurfaces();expect(surface.root.children).toHaveLength(3);
    const normal=(surface.root.children[0] as THREE.Mesh).geometry.getAttribute('normal');
    for(let i=0;i<normal.count;i++)expect(normal.getY(i)).toBeGreaterThan(.999);
    for(const child of surface.root.children){
      const mesh=child as THREE.Mesh,material=mesh.material as THREE.MeshStandardMaterial;
      expect(material.transparent).toBe(false);expect(material.map).toBeNull();
      expect(mesh.castShadow).toBe(false);expect(mesh.userData['simEntityId']).toBeUndefined();
    }surface.dispose();
  });
  it('is reproducible, has authored shape variants, and releases everything once',()=>{
    const a=createGroundSurfaces(),b=createGroundSurfaces();expect(a.root.toJSON()).toBeDefined();
    for(let i=0;i<a.root.children.length;i++){
      const x=a.root.children[i] as THREE.Mesh,y=b.root.children[i] as THREE.Mesh;
      expect(x.geometry.getAttribute('position').array).toEqual(y.geometry.getAttribute('position').array);
      if(x instanceof THREE.InstancedMesh&&y instanceof THREE.InstancedMesh)expect(x.instanceMatrix.array).toEqual(y.instanceMatrix.array);
    }
    expect(source.blade.triangles).toBe(224);expect(source.leaf.triangles).toBe(144);
    const spies=a.root.children.flatMap(child=>{const mesh=child as THREE.Mesh;return [vi.spyOn(mesh.geometry,'dispose'),vi.spyOn(mesh.material as THREE.Material,'dispose')];});
    a.dispose();a.dispose();for(const spy of spies)expect(spy).toHaveBeenCalledTimes(1);expect(a.root.children).toHaveLength(0);b.dispose();
  });
  it('excludes only decorative batches from recursive aim picking, preserving targets and the command plane',()=>{
    const surface=createGroundSurfaces(),scene=new THREE.Group();scene.add(surface.root);
    const instanceRaycast=vi.spyOn(THREE.InstancedMesh.prototype,'raycast');
    const hero=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());hero.position.set(0,.5,0);hero.userData['simEntityId']=9;scene.add(hero);scene.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0));
    const hits=ray.intersectObjects(scene.children,true);expect(hits.length).toBeGreaterThan(0);expect(hits.every(hit=>hit.object===hero)).toBe(true);
    ray.set(new THREE.Vector3(-100,10,6),new THREE.Vector3(0,-1,0));expect(ray.intersectObjects(surface.root.children,true)).toEqual([]);expect(instanceRaycast).not.toHaveBeenCalled();
    const ground=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());expect(ground?.toArray()).toEqual([-100,0,6]);
    instanceRaycast.mockRestore();hero.geometry.dispose();(hero.material as THREE.Material).dispose();surface.dispose();
  });
});
