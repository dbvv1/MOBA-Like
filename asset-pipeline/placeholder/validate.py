"""Verify generated assets and bounded weapon revision with actual Blender imports."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('existing_preflight',ROOT.parent/'scripts/preflight.py')
pre=importlib.util.module_from_spec(spec);spec.loader.exec_module(pre)
EXPECTED={'idle':(1,31),'walk':(1,33),'attack':(1,36)}


def sha(path):
  return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect(path):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.context.scene.render.fps=30
  if path.suffix=='.blend':
    bpy.ops.wm.open_mainfile(filepath=str(path),use_scripts=False)
  else:
    bpy.ops.import_scene.gltf(filepath=str(path),disable_bone_shape=True)
  rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
  assert len(rigs)==1 and rigs[0].name=='GuardRig'
  rig=rigs[0]
  assert len(rig.data.bones)==15
  assert not bpy.data.texts and all(not (m.use_nodes and any(n.type=='SCRIPT' for n in m.node_tree.nodes)) for m in bpy.data.materials)
  assert not bpy.data.images, 'original prototype must not depend on image textures'
  actions={a.name.split('_GuardRig')[0]:a for a in bpy.data.actions}
  assert set(actions)==set(EXPECTED),list(actions)
  for name,action in actions.items():
    assert all(abs(a-b)<1e-4 for a,b in zip(action.frame_range,EXPECTED[name])),(name,list(action.frame_range))
  rig.animation_data.action=actions['idle'];bpy.context.scene.frame_set(1)
  inventory=pre.summary();structure=pre.structural();materials=pre.material_state()
  samples={};minimum=100
  for name,action in actions.items():
    rig.animation_data.action=action
    frames=list(range(EXPECTED[name][0],EXPECTED[name][1]+1,4))
    frames+= [EXPECTED[name][1]]
    poses=[]
    for frame in frames:
      bpy.context.scene.frame_set(frame)
      deps=bpy.context.evaluated_depsgraph_get()
      pose={}
      for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        ev=obj.evaluated_get(deps)
        points=[pre.vec(ev.matrix_world @ v.co) for v in ev.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p)
        minimum=min(minimum,min(p[2] for p in points))
        pose[obj.name]=points
      poses.append(pose)
    assert poses[0]!=poses[len(poses)//2],name+' has no sampled motion'
    if name in ('idle','walk'):
      assert poses[0]==poses[-1],name+' loop endpoint mismatch'
    samples[name]=poses
  assert minimum>=-.001,('floor penetration beyond prototype tolerance',minimum)
  # Grip, guard and blade must all remain weighted to the same actual hand bone.
  for name in ['WeaponGrip','WeaponGuard','WeaponBlade']:
    obj=bpy.data.objects[name]
    for v in obj.data.vertices:
      active=[obj.vertex_groups[g.group].name for g in v.groups if g.weight>1e-6]
      assert active==['Hand_R'],(name,active)
  return {'inventory':inventory,'structure':structure,'materials':materials,'samples':samples,'min_z':minimum}


def without_markers(structure):
  result=dict(structure)
  result['objects']={k:v for k,v in structure['objects'].items() if not k.startswith('TeamMarker_')}
  return result


def compare_revision(a,b):
  left=json.loads(json.dumps(a['structure']));right=json.loads(json.dumps(b['structure']))
  assert left['objects']['WeaponBlade']['vertices']!=right['objects']['WeaponBlade']['vertices']
  del left['objects']['WeaponBlade']['vertices'];del right['objects']['WeaponBlade']['vertices']
  assert left==right,'weapon-length edit changed data outside blade vertices'
  assert a['materials']==b['materials'],'weapon revision changed materials'
  for action in a['samples']:
    for before,after in zip(a['samples'][action],b['samples'][action]):
      assert {k:v for k,v in before.items() if k!='WeaponBlade'}=={k:v for k,v in after.items() if k!='WeaponBlade'},'revision changed nonweapon animation'


def compare_roundtrip(source,export):
  assert source['inventory']['rigs']==export['inventory']['rigs']
  assert set(source['inventory']['meshes'])==set(export['inventory']['meshes'])
  for name,mesh in source['inventory']['meshes'].items():
    assert mesh['triangles']==export['inventory']['meshes'][name]['triangles']
  worst=0
  for action,poses in source['samples'].items():
    for before,after in zip(poses,export['samples'][action]):
      for name,points in before.items():
        # glTF may split vertices at normals/UV seams; compare positions both directions.
        a=[Vector(p) for p in points];b=[Vector(p) for p in after[name]]
        error=max(max(min((p-q).length for q in b) for p in a),max(min((p-q).length for q in a) for p in b))
        worst=max(worst,error)
        assert error<.0002,(action,name,error)
  return worst


def main():
  sources={name:inspect(ROOT/'assets'/f'{name}.blend') for name in ['blue','amber','blue-long']}
  exports={name:inspect(ROOT/'assets'/f'{name}.glb') for name in sources}
  errors={name:compare_roundtrip(sources[name],exports[name]) for name in sources}
  for variants in [sources,exports]:
    compare_revision(variants['blue'],variants['blue-long'])
    a,b=variants['blue'],variants['amber']
    assert without_markers(a['structure'])==without_markers(b['structure']),'team edit changed nonmarker structure'
    assert a['materials']['Team']!=b['materials']['Team']
    assert {k:v for k,v in a['materials'].items() if k!='Team'}=={k:v for k,v in b['materials'].items() if k!='Team'}
  recipe=json.loads((ROOT/'recipe.json').read_text())
  for name,key in [('blue','blade_length'),('blue-long','revised_blade_length')]:
    points=sources[name]['structure']['objects']['WeaponBlade']['vertices']
    assert math.isclose(max(p[1] for p in points)-min(p[1] for p in points),recipe[key],abs_tol=1e-6)
  report={'status':'passed','kind':'original_placeholder_not_final_art','blender':bpy.app.version_string,
          'variants':{k:{'source':v['inventory'],'glb':exports[k]['inventory'],'min_sampled_world_z':v['min_z'],'max_roundtrip_vertex_error_m':errors[k]} for k,v in sources.items()},
          'verified':['15-bone rig and idle/walk/attack in all 6 files','every fourth frame plus loop endpoints sampled','source-to-GLB deformed points within 0.2 mm','weapon hand weights','team changes limited to Team material and marker geometry','length revision only WeaponBlade vertices; other source/export data and sampled poses unchanged'],
          'limits':['not a continuous collision test','not a gameplay/engine test','no final art or accessibility certification','visual observations are separate from these assertions'],
          'files':{str(p.relative_to(ROOT)):{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted((ROOT/'assets').iterdir()) if p.suffix in ('.blend','.glb')}}
  (ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'status':report['status'],'max_roundtrip_error_m':errors,'minimum_sampled_z':{k:v['min_z'] for k,v in sources.items()}},indent=2))


if __name__=='__main__':
  # An interrupted/failing revalidation must not leave a stale success receipt.
  (ROOT/'validation.json').unlink(missing_ok=True)
  main()
