"""Blender CPU-rendered inspection sheets from exported GLBs, not illustrations."""
import hashlib
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
(ROOT/'previews/manifest.json').unlink(missing_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.cycles.use_denoising=False
scene.render.resolution_x=1000
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.render.fps=30
scene.world=bpy.data.worlds.new('PreviewWorld')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.18,0.21,0.25,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
scene.view_settings.view_transform='Standard'
scene.view_settings.look='Medium High Contrast'


def mat(name,c):
  m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
  m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1)
  return m


def text(body, pos, size=.2):
  curve=bpy.data.curves.new('Label','FONT');curve.body=body;curve.size=size;curve.align_x='CENTER'
  o=bpy.data.objects.new('Label',curve);bpy.context.collection.objects.link(o)
  o.location=pos;o.data.materials.append(mat('Ink',(.02,.03,.04)))
  return o


# Freeze four diagnostic poses per column; source animation remains untouched on disk.
for col,variant in enumerate(['blue','amber','blue-long']):
  for row,(action,frame) in enumerate([('idle',16),('walk',9),('attack',14),('attack',19)]):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets'/f'{variant}.glb'),disable_bone_shape=True)
    added=set(bpy.data.objects)-before
    rig=next(o for o in added if o.type=='ARMATURE')
    # Names are suffixed on repeated imports; the rig's available action is imported with the same suffix.
    matches=[a for a in bpy.data.actions if a.name.startswith(action+'_GuardRig')]
    clip=max(matches,key=lambda a: int(a.name.rsplit('.',1)[1]) if a.name.rsplit('.',1)[-1].isdigit() else 0)
    rig.animation_data.action=clip
    scene.frame_set(frame)
    deps=bpy.context.evaluated_depsgraph_get()
    # Bake evaluated geometry for one contact-sheet pose. This is preview-only.
    for o in list(added):
      if o.type=='MESH':
        ev=o.evaluated_get(deps)
        mesh=bpy.data.meshes.new_from_object(ev,depsgraph=deps)
        posed=bpy.data.objects.new('Preview_'+o.name,mesh)
        bpy.context.collection.objects.link(posed)
        posed.matrix_world=o.matrix_world.copy()
        posed.location+=Vector(((col-1)*3.3,(1.5-row)*3.3,0))
    for o in added:
      bpy.data.objects.remove(o,do_unlink=True)
    text(f'{variant}  {action}:{frame}',((col-1)*3.3,(1.5-row)*3.3-1.6,.02),.18)

floor=mat('Ground',(.22,.26,.29))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.015));bpy.context.object.data.materials.append(floor)
bpy.ops.object.light_add(type='AREA',location=(-3,-5,12))
bpy.context.object.data.energy=1800;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=8
bpy.ops.object.camera_add(location=(7,-11,17))
cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.6))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=16
scene.camera=cam
out=ROOT/'previews';out.mkdir(exist_ok=True)
scene.render.filepath=str(out/'poses.png')
bpy.ops.render.render(write_still=True)
# Exact top view: check geometry-only team marker separation and weapon reach.
cam.location=(0,0,20);cam.rotation_euler=(0,0,0)
cam.data.ortho_scale=15
scene.render.filepath=str(out/'top.png')
bpy.ops.render.render(write_still=True)
manifest={'renderer':'Blender '+bpy.app.version_string+' Cycles CPU, 24 samples, no denoising',
          'poses':[['idle',16],['walk',9],['attack',14],['attack',19]],
          'source_glb_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'assets').glob('*.glb'))},
          'preview_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob('*.png'))}}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Rendered poses.png and top.png from exported assets')
