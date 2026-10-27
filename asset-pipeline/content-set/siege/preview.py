"""CPU source preview from exported GLBs. NOT a game/GPU acceptance frame."""
import argparse
import bpy
import math
from mathutils import Vector
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
p.add_argument('--pose-sheet', action='store_true')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
a.output.mkdir(exist_ok=True, parents=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def add(path, x, y, clip='idle', at=0):
    before = set(bpy.context.scene.objects)
    actions_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = set(bpy.context.scene.objects) - before
    parent = bpy.data.objects.new(path.stem + '-placement', None)
    bpy.context.collection.objects.link(parent)
    for obj in objects:
        if obj.parent not in objects:
            obj.parent = parent
        if obj.type == 'ARMATURE':
            if obj.animation_data:
                for track in obj.animation_data.nla_tracks:
                    track.mute = True
                imported_actions = set(bpy.data.actions) - actions_before
                action = next((x for x in imported_actions if x.name.split('.')[0] == clip), None)
                if action:
                    obj.animation_data.action = action
    # Freeze this imported sample before the global scene clock is used by the next.
    bpy.context.scene.frame_set(at)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type == 'MESH' and any(m.type == 'ARMATURE' for m in obj.modifiers):
            evaluated = obj.evaluated_get(depsgraph)
            obj.data = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
            for modifier in list(obj.modifiers):
                if modifier.type == 'ARMATURE':
                    obj.modifiers.remove(modifier)
    parent.location = (x, y, 0)
    parent.rotation_euler.z = 0 if path.stem == 'lane-ground' else math.radians(-90)
    return parent


if a.pose_sheet:
    for x, clip, frame in [(-4.5, 'idle', 0), (-1.5, 'attack_prepare', 13), (1.5, 'attack_release', 5), (4.5, 'death', 30)]:
        add(HERE / 'exported/siege-rust.glb', x, 0, clip, frame)
else:
    add(REPO / 'asset-pipeline/heroes/veyra-release/exported/veyra-teal.glb', -3, 0)
    add(REPO / 'asset-pipeline/battle/exported/melee-rust.glb', 0, 0)
    add(HERE / 'exported/siege-rust.glb', 3, 0)
    add(REPO / 'asset-pipeline/battle/exported/ranged-rust.glb', 0, 2.5)
    add(HERE / 'exported/siege-teal.glb', 3, 3)
for x in (-12, 0, 12):
    # Road orientation does not matter for the source card, but scale does.
    add(REPO / 'asset-pipeline/battle/exported/lane-ground.glb', x, 0)
bpy.ops.mesh.primitive_plane_add(size=150, location=(0, 0, -.035))
ground = bpy.context.object
material = bpy.data.materials.new('Source-preview-ground')
material.diffuse_color = (.021219, .072272, .056128, 1)
material.use_nodes = True
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = material.diffuse_color
material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
ground.data.materials.append(material)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new('Source preview world')
scene.world.color = (.16, .20, .18)
bpy.ops.object.light_add(type='SUN', location=(-12, -12, 26))
sun = bpy.context.object
sun.rotation_euler = (Vector((0, 0, 0)) - sun.location).to_track_quat('-Z', 'Y').to_euler()
sun.data.energy = 2.5
sun.data.color = (1, .94, .81)
sun.data.angle = .08
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = 100
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 24
camera.data.lens = 24 / (2 * math.tan(math.radians(22.5)))
scene.camera = camera
scene.frame_set(0)
views = [('source-poses-idle-prepare-release-death', (0, 0, .6), (0, -8, 7), (1400, 700))] if a.pose_sheet else [('normal-camera-source-only', (0, 0, 0), (0, -18, 24), (1280, 720)),
                                    ('normal-320-source-only', (0, 0, 0), (0, -18, 24), (320, 180)),
                                    ('close-inspection-not-acceptance', (2, 0, .6), (0, -6, 5), (1000, 700))]
for label, focus, offset, size in views:
    camera.location = Vector(focus) + Vector(offset)
    camera.rotation_euler = (Vector(focus) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(a.output / (label + '.png'))
    bpy.ops.render.render(write_still=True)
