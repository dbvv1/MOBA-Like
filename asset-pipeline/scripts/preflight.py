"""Blender-only offline validation and isolated material revision for a .blend source."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector


def digest(path):
  return hashlib.sha256(path.read_bytes()).hexdigest()


def vec(v):
  return [round(float(x), 6) for x in v]


def matrix(m):
  return [vec(row) for row in m]


def structural():
  objects = {}
  for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
    item = {'type': o.type, 'parent': o.parent.name if o.parent else None,
            'matrix': matrix(o.matrix_local)}
    if o.type == 'MESH':
      item.update(vertices=[vec(v.co) for v in o.data.vertices],
                  polygons=[list(p.vertices) for p in o.data.polygons],
                  material_indices=[p.material_index for p in o.data.polygons],
                  materials=[m.name for m in o.data.materials],
                  groups=[g.name for g in o.vertex_groups],
                  weights=[[(g.group, round(g.weight, 6)) for g in v.groups] for v in o.data.vertices],
                  uv={uv.name: [vec(x.uv) for x in uv.data] for uv in o.data.uv_layers},
                  modifiers=[(m.name, m.type, m.object.name if m.type == 'ARMATURE' and m.object else None) for m in o.modifiers])
    if o.type == 'ARMATURE':
      item['bones'] = {b.name: {'parent': b.parent.name if b.parent else None,
                               'rest': matrix(b.matrix_local)} for b in o.data.bones}
    objects[o.name] = item
  actions = {a.name: [(f.data_path, f.array_index,
                       [(vec(k.co), vec(k.handle_left), vec(k.handle_right), k.interpolation) for k in f.keyframe_points])
                      for f in a.fcurves] for a in bpy.data.actions}
  return {'objects': objects, 'actions': actions,
          'unit_scale': bpy.context.scene.unit_settings.scale_length,
          'fps': bpy.context.scene.render.fps}


def material_state():
  return {m.name: {'diffuse': vec(m.diffuse_color),
                  'nodes': {n.name: {'type': n.type, 'inputs': {i.name: (vec(i.default_value) if hasattr(i.default_value, '__len__') and not isinstance(i.default_value, str) else i.default_value)
                             for i in n.inputs if hasattr(i, 'default_value')},
                             'image': n.image.name if n.type == 'TEX_IMAGE' and n.image else None}
                            for n in m.node_tree.nodes} if m.use_nodes else {}}
          for m in bpy.data.materials}


def summary():
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
  assert meshes and rigs and bpy.data.actions, 'requires mesh, armature and animation actions'
  assert all(len(o.data.vertices) > 0 for o in meshes), 'empty mesh'
  assert all(any(m.type == 'ARMATURE' and m.object in rigs for m in o.modifiers) for o in meshes), 'unskinned mesh'
  assert all(v.groups and math.isclose(sum(g.weight for g in v.groups), 1, abs_tol=1e-4) for o in meshes for v in o.data.vertices), 'invalid skin weights'
  bounds = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
  for o in meshes:
    o.data.calc_loop_triangles()
  return {'meshes': {o.name: {'vertices': len(o.data.vertices), 'triangles': len(o.data.loop_triangles)} for o in meshes},
          'rigs': {o.name: len(o.data.bones) for o in rigs},
          'actions': {a.name: {'frames': vec(a.frame_range), 'fcurves': len(a.fcurves)} for a in bpy.data.actions},
          'materials': sorted(m.name for m in bpy.data.materials),
          'world_bounds': [[round(min(p[i] for p in bounds), 6) for i in range(3)], [round(max(p[i] for p in bounds), 6) for i in range(3)]],
          'unit_scale': bpy.context.scene.unit_settings.scale_length, 'fps': bpy.context.scene.render.fps}


def samples():
  result = {}
  rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
  assert len(rigs) == 1, 'this preflight supports exactly one rig'
  rig = rigs[0]
  saved = rig.animation_data.action
  for action in bpy.data.actions:
    rig.animation_data.action = action
    frames = [int(action.frame_range[0]), int(sum(action.frame_range) / 2), int(action.frame_range[1])]
    poses = []
    for frame in frames:
      bpy.context.scene.frame_set(frame)
      graph = bpy.context.evaluated_depsgraph_get()
      poses.append({o.name: [vec(o.matrix_world @ v.co) for v in o.evaluated_get(graph).data.vertices]
                    for o in bpy.context.scene.objects if o.type == 'MESH'})
    assert poses[0] != poses[1], 'action has no sampled mesh deformation'
    result[action.name] = poses
  rig.animation_data.action = saved
  bpy.context.scene.frame_set(1)
  return result


def export(path):
  bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_animations=True,
                            export_animation_mode='ACTIONS', export_force_sampling=True)


def imported(path, fps):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.context.scene.render.fps = fps
  bpy.ops.import_scene.gltf(filepath=str(path), disable_bone_shape=True)
  bpy.context.scene.frame_set(1)
  return {'summary': summary(), 'structure': structural(), 'samples': samples(), 'materials': material_state()}


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--source', type=Path, required=True)
  parser.add_argument('--output', type=Path, required=True)
  parser.add_argument('--material', default='Accent')
  parser.add_argument('--source-kind', choices=['own_synthetic_fixture', 'external_unverified'], default='external_unverified')
  args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
  source, out = args.source.resolve(), args.output.resolve()
  assert source.parent != out and source not in out.parents, 'source and output must be separate'
  # Never leave an old passed receipt after a failed rerun. Old assets may remain.
  receipt = out / 'report.json'
  if receipt.is_file():
    receipt.unlink()
  assert source.is_file(), 'source file missing'
  assert source.suffix == '.blend', 'only .blend input supported in this bounded preflight'
  before_hash = digest(source)
  bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
  initial = summary()
  before_samples = samples()
  before = structural()
  mats = material_state()
  mat = bpy.data.materials.get(args.material)
  assert mat and mat.use_nodes, 'target material missing or not node-based'
  node = mat.node_tree.nodes.get('Principled BSDF')
  assert node and not node.inputs['Base Color'].is_linked, 'requires an unlinked Principled Base Color'
  out.mkdir(parents=True, exist_ok=True)
  export(out / 'first.glb')
  node.inputs['Base Color'].default_value = (0.02, 0.18, 0.8, 1)
  mat.diffuse_color = (0.02, 0.18, 0.8, 1)
  after_mats = material_state()
  assert mats[args.material] != after_mats[args.material], 'no material change'
  assert {k: v for k, v in mats.items() if k != args.material} == {k: v for k, v in after_mats.items() if k != args.material}, 'other material changed'
  expected = json.loads(json.dumps(mats[args.material]))
  expected['diffuse'] = vec(mat.diffuse_color)
  expected['nodes'][node.name]['inputs']['Base Color'] = vec(node.inputs['Base Color'].default_value)
  assert expected == after_mats[args.material], 'unexpected target material changes'
  assert structural() == before and samples() == before_samples, 'non-material data changed'
  bpy.ops.wm.save_as_mainfile(filepath=str(out / 'blue.blend'), compress=True)
  export(out / 'blue.glb')
  first, blue = imported(out / 'first.glb', initial['fps']), imported(out / 'blue.glb', initial['fps'])
  assert first['summary'] == blue['summary'], 'export inventory changed'
  assert first['structure'] == blue['structure'], 'export mesh/rig/action changed'
  assert first['samples'] == blue['samples'], 'export deformation changed'
  assert first['materials'][args.material] != blue['materials'][args.material], 'export lost color edit'
  assert {k: v for k, v in first['materials'].items() if k != args.material} == {k: v for k, v in blue['materials'].items() if k != args.material}, 'export changed other material'
  assert len(first['summary']['actions']) == len(initial['actions']), 'export dropped actions'
  assert sum(first['summary']['rigs'].values()) == sum(initial['rigs'].values()), 'export dropped bones'
  assert first['summary']['world_bounds'] == initial['world_bounds'], 'export changed bounds'
  assert sorted(a['frames'] for a in first['summary']['actions'].values()) == sorted(a['frames'] for a in initial['actions'].values()), 'export changed animation timing'
  assert sorted(m['triangles'] for m in first['summary']['meshes'].values()) == sorted(m['triangles'] for m in initial['meshes'].values()), 'export changed triangle counts'
  assert digest(source) == before_hash, 'source bytes changed'
  report = {'status': 'passed', 'source_kind': args.source_kind, 'third_party_asset_verified': False,
            'blender': bpy.app.version_string, 'source_sha256': before_hash, 'source': source.name,
            'first': initial, 'roundtrip': first['summary'], 'source_axes': 'Blender Z up; fixture arm extends +X',
            'export_axes': 'glTF Y up via Blender exporter', 'unchanged': ['source bytes', 'mesh topology and vertices', 'UV', 'skin weights', 'rig rest matrices', 'action keyframes', 'sampled deformed vertices', 'other materials'],
            'invariant_scope': 'source before versus after color edit; first GLB versus revised GLB, not binary equality across formats',
            'allowed_changes': [args.material + '.Principled BSDF.Base Color', args.material + '.diffuse_color'],
            'artifacts': {p.name: {'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(out.iterdir()) if p.suffix in ('.blend', '.glb')}}
  (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
  print(json.dumps(report, indent=2))


if __name__ == '__main__':
  main()
