"""Own synthetic rig fixture; not a third-party character or visual-quality test."""
import sys
from pathlib import Path
import bpy

out = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
bpy.context.scene.render.fps = 30
bpy.context.scene.frame_end = 30
for name, color in [('Accent', (0.8, 0.08, 0.03, 1)), ('Neutral', (0.18, 0.18, 0.18, 1))]:
  mat = bpy.data.materials.new(name)
  mat.use_nodes = True
  mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
  mat.diffuse_color = color
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.name = 'FixtureRig'
bpy.ops.object.mode_set(mode='EDIT')
root = rig.data.edit_bones[0]
root.name = 'Root'
root.head = (0, 0, 0)
root.tail = (0, 0, 1)
arm = rig.data.edit_bones.new('Arm')
arm.head = (0, 0, 1)
arm.tail = (0.8, 0, 1)
arm.parent = root
bpy.ops.object.mode_set(mode='OBJECT')
for name, loc, size, bone, material in [
    ('Body', (0, 0, 0.7), (0.3, 0.2, 0.7), 'Root', 'Accent'),
    ('ArmMesh', (0.55, 0, 1), (0.55, 0.12, 0.12), 'Arm', 'Neutral')]:
  bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
  obj = bpy.context.object
  obj.name = name
  obj.scale = size
  bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
  obj.data.materials.append(bpy.data.materials[material])
  obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
  obj.modifiers.new('Skin', 'ARMATURE').object = rig
  obj.parent = rig
rig.animation_data_create()
for action_name, amplitude in [('Fixture_Idle', 0.1), ('Fixture_Swing', 0.8)]:
  rig.animation_data.action = bpy.data.actions.new(action_name)
  for frame, value in [(1, 0), (15, amplitude), (30, 0)]:
    rig.pose.bones['Arm'].rotation_mode = 'XYZ'
    rig.pose.bones['Arm'].rotation_euler[1] = value
    rig.pose.bones['Arm'].keyframe_insert('rotation_euler', frame=frame, group='Arm')
  rig.animation_data.action.use_fake_user = True
bpy.context.scene.frame_set(1)
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
