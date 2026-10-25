"""Original low-poly placeholder generator. No external art or textures."""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parent


def material(name, color, metallic=0):
  m = bpy.data.materials.new(name)
  m.diffuse_color = color
  m.use_nodes = True
  bsdf = m.node_tree.nodes['Principled BSDF']
  bsdf.inputs['Base Color'].default_value = color
  bsdf.inputs['Roughness'].default_value = 0.72
  bsdf.inputs['Metallic'].default_value = metallic
  return m


def bind(obj, name, bone, mat, rig):
  obj.name = name
  bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
  obj.data.materials.append(mat)
  obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
  obj.modifiers.new('Skin', 'ARMATURE').object = rig
  obj.parent = rig
  return obj


def box(name, center, size, bone, mat, rig, bevel=0.035):
  bpy.ops.mesh.primitive_cube_add(size=1, location=center)
  o = bpy.context.object
  o.scale = size
  bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
  if bevel:
    mod = o.modifiers.new('Facets', 'BEVEL')
    mod.width = bevel
    mod.segments = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
  return bind(o, name, bone, mat, rig)


def limb(name, a, b, width, bone, mat, rig):
  center = (Vector(a) + Vector(b)) / 2
  o = box(name, center, (width, width, (Vector(b)-Vector(a)).length), bone, mat, rig)
  o.rotation_mode = 'QUATERNION'
  o.rotation_quaternion = Vector((0,0,1)).rotation_difference(Vector(b)-Vector(a))
  return o


def make(team, blade_length, recipe):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.context.scene.unit_settings.system = 'METRIC'
  bpy.context.scene.unit_settings.scale_length = 1
  bpy.context.scene.render.fps = recipe['fps']
  bpy.context.scene.frame_end = 30
  bpy.context.preferences.filepaths.save_version = 0
  colors = {'Team': (recipe['teams'][team]['color'], 0), 'Armor': ((0.13,0.18,0.23,1),0.3),
            'Trim': ((0.82,0.87,0.78,1),0.15), 'Visor': ((0.012,0.02,0.025,1),0),
            'Blade': ((0.82,0.88,0.92,1),0.1), 'Grip': ((0.08,0.06,0.045,1),0)}
  mats = {name: material(name, *v) for name,v in colors.items()}
  data = bpy.data.armatures.new('GuardSkeleton')
  rig = bpy.data.objects.new('GuardRig', data)
  bpy.context.collection.objects.link(rig)
  bpy.context.view_layer.objects.active = rig
  rig.select_set(True)
  bpy.ops.object.mode_set(mode='EDIT')
  bones = [('Root',(0,0,0),(0,0,0.9),None),
           ('Torso',(0,0,0.9),(0,0,1.55),'Root'),
           ('Head',(0,0,1.55),(0,0,2.05),'Torso')]
  for side, sign in [('L',-1),('R',1)]:
    bones += [(f'UpperArm_{side}',(sign*.46,0,1.45),(sign*.56,0,1.12),'Torso'),
              (f'Forearm_{side}',(sign*.56,0,1.12),(sign*.6,0,.85),f'UpperArm_{side}'),
              (f'Hand_{side}',(sign*.6,0,.85),(sign*.6,-.18,.85),f'Forearm_{side}'),
              (f'Thigh_{side}',(sign*.18,0,.9),(sign*.18,0,.5),'Root'),
              (f'Shin_{side}',(sign*.18,0,.5),(sign*.18,0,.13),f'Thigh_{side}'),
              (f'Foot_{side}',(sign*.18,0,.13),(sign*.18,-.25,.13),f'Shin_{side}')]
  for name, head, tail, parent in bones:
    b = data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
      b.parent = data.edit_bones[parent]
  bpy.ops.object.mode_set(mode='OBJECT')
  box('Pelvis',(0,0,.92),(.52,.32,.22),'Root',mats['Armor'],rig)
  box('Coat',(0,0,1.23),(.64,.36,.57),'Torso',mats['Team'],rig,.07)
  box('ChestPlate',(0,-.19,1.3),(.38,.06,.3),'Torso',mats['Armor'],rig)
  box('Neck',(0,0,1.59),(.2,.18,.14),'Head',mats['Armor'],rig)
  box('Helmet',(0,0,1.83),(.52,.44,.43),'Head',mats['Trim'],rig,.08)
  box('FaceVisor',(0,-.224,1.83),(.36,.04,.11),'Head',mats['Visor'],rig,.012)
  box('TeamBand',(0,-.25,1.96),(.36,.025,.06),'Head',mats['Team'],rig,.006)
  for side, sign in [('L',-1),('R',1)]:
    box(f'Shoulder_{side}',(sign*.43,0,1.46),(.26,.35,.25),f'UpperArm_{side}',mats['Team'],rig)
    limb(f'UpperArmMesh_{side}',(sign*.46,0,1.4),(sign*.56,0,1.12),.19,f'UpperArm_{side}',mats['Armor'],rig)
    limb(f'ForearmMesh_{side}',(sign*.56,0,1.1),(sign*.6,0,.87),.19,f'Forearm_{side}',mats['Trim'],rig)
    box(f'HandMesh_{side}',(sign*.6,-.04,.85),(.2,.2,.18),f'Hand_{side}',mats['Armor'],rig)
    limb(f'ThighMesh_{side}',(sign*.18,0,.86),(sign*.18,0,.51),.23,f'Thigh_{side}',mats['Team'],rig)
    limb(f'ShinMesh_{side}',(sign*.18,0,.48),(sign*.18,0,.16),.19,f'Shin_{side}',mats['Armor'],rig)
    box(f'Boot_{side}',(sign*.18,-.09,.12),(.25,.38,.23),f'Foot_{side}',mats['Trim'],rig)
  # A single tall center fin versus two shorter separated fins: color-independent geometry.
  fins = [(0,.22)] if recipe['teams'][team]['marker']=='single_fin' else [(-.15,.13),(.15,.13)]
  for i,(x,height) in enumerate(fins):
    box(f'TeamMarker_{i}',(x,.015,2.02+height/2),(.07,.34,height),'Head',mats['Team'],rig,.018)
  box('WeaponGrip',(.6,-.1,.85),(.075,.29,.075),'Hand_R',mats['Grip'],rig,.012)
  box('WeaponGuard',(.6,-.26,.85),(.33,.065,.065),'Hand_R',mats['Trim'],rig,.012)
  # Only this mesh changes for the requested finite revision. Pivot and guard stay fixed.
  y0=-.3
  vertices=[(.6+sx,y,.85+sz) for y,half in [(y0,.105),(y0-blade_length*.8,.09),(y0-blade_length,0.005)] for sx,sz in [(-half,-.025),(half,-.025),(half,.025),(-half,.025)]]
  faces=[(0,3,2,1),(8,9,10,11)]
  for segment in range(2):
    for i in range(4):
      a=segment*4+i; b=segment*4+(i+1)%4
      faces.append((a,b,b+4,a+4))
  mesh=bpy.data.meshes.new('WeaponBladeGeometry'); mesh.from_pydata(vertices,[],faces); mesh.update()
  obj=bpy.data.objects.new('WeaponBlade',mesh); bpy.context.collection.objects.link(obj)
  bpy.context.view_layer.objects.active=obj
  bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
  bind(obj,'WeaponBlade','Hand_R',mats['Blade'],rig)
  rig.animation_data_create()
  def pose(frame, rotations, bob=0, breathe=0):
    for pb in rig.pose.bones:
      pb.rotation_mode='QUATERNION'
      pb.rotation_quaternion=(1,0,0,0)
      pb.location=(0,0,0)
      if pb.name in rotations:
        # Define readable motion around model-space X; convert into bone-local axes.
        axis=pb.bone.matrix_local.to_3x3().inverted() @ Vector((1,0,0))
        pb.rotation_quaternion=Quaternion(axis,math.radians(rotations[pb.name]))
      if pb.name=='Torso':
        pb.location=(0,breathe,0)
      if pb.name=='Root':
        pb.location=(0,bob,0)  # Root's local Y follows model Z.
      pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
      pb.keyframe_insert('location',frame=frame,group=pb.name)
  for name in ['idle','walk','attack']:
    a=bpy.data.actions.new(name); a.use_fake_user=True; rig.animation_data.action=a
    if name=='idle':
      for f,bob in [(1,0),(16,.018),(31,0)]:
        pose(f,{'UpperArm_R':-8,'UpperArm_L':6},breathe=bob)
    elif name=='walk':
      for f,phase in [(1,0),(9,1),(17,0),(25,-1),(33,0)]:
        pose(f,{'Thigh_L':phase*24,'Thigh_R':-phase*24,'Shin_L':max(phase,0)*25,
                'Shin_R':max(-phase,0)*25,'Foot_L':-phase*24-max(phase,0)*25,'Foot_R':phase*24-max(-phase,0)*25,
                'UpperArm_L':-phase*18,'UpperArm_R':phase*12-8},-abs(phase)*.07)
    else:
      for f,angle in [(1,-8),(10,-95),(14,-100),(19,12),(24,8),(36,-8)]:
        pose(f,{'UpperArm_R':angle,'Forearm_R':-12 if f in (10,14) else 0,
                'UpperArm_L':-15 if f in (10,14,19) else 6})
    for fc in a.fcurves:
      for k in fc.keyframe_points:
        k.interpolation='LINEAR' if name=='walk' else 'BEZIER'
  # Bake a small vertical root correction from the lower boot sole per frame.
  # This is contact alignment for a placeholder, not a full locomotion IK system.
  for action in bpy.data.actions:
    rig.animation_data.action=action
    for frame in range(int(action.frame_range[0]),int(action.frame_range[1])+1):
      bpy.context.scene.frame_set(frame)
      deps=bpy.context.evaluated_depsgraph_get()
      low=min((o.evaluated_get(deps).matrix_world @ v.co).z
              for o in bpy.context.scene.objects if o.name.startswith('Boot_')
              for v in o.evaluated_get(deps).data.vertices)
      rig.pose.bones['Root'].location.y-=low
      rig.pose.bones['Root'].keyframe_insert('location',frame=frame,group='Root')
    for fc in action.fcurves:
      if fc.data_path=='pose.bones["Root"].location':
        for k in fc.keyframe_points:k.interpolation='LINEAR'
  rig.animation_data.action=bpy.data.actions['idle']
  bpy.context.scene.frame_set(1)
  return rig


def main():
  parser=argparse.ArgumentParser()
  parser.add_argument('--output',type=Path,default=ROOT/'assets')
  args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
  recipe=json.loads((ROOT/'recipe.json').read_text())
  for key in ['blade_length','revised_blade_length']:
    assert .2 <= recipe[key] <= 1.5, 'blade length outside supported prototype range'
  for stale in ['validation.json','test-results.json','previews/manifest.json']:
    (ROOT/stale).unlink(missing_ok=True)
  args.output.mkdir(parents=True,exist_ok=True)
  for name,team,length in [('blue','blue',recipe['blade_length']),('amber','amber',recipe['blade_length']),('blue-long','blue',recipe['revised_blade_length'])]:
    make(team,length,recipe)
    bpy.ops.wm.save_as_mainfile(filepath=str((args.output/f'{name}.blend').resolve()),compress=True)
    bpy.ops.export_scene.gltf(filepath=str((args.output/f'{name}.glb').resolve()),export_format='GLB',export_animation_mode='ACTIONS',export_force_sampling=True,export_animations=True)
  print('Generated original blue, amber and blue-long Blend/GLB variants')


if __name__=='__main__':
  main()
