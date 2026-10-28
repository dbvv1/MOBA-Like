"""Blender 4.3.2: existing CC0 cart + catapult, independent six-bone rigid rig."""
import bpy
import bmesh
import hashlib
import json
import math
from pathlib import Path
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = HERE / 'source'
EXPORT = HERE / 'exported'
EXPORT.mkdir(exist_ok=True)
SOURCE.mkdir(exist_ok=True)


def verify_sources():
    provenance = json.loads((SOURCE / 'provenance.json').read_text())
    for row in provenance['kenney']['files']:
        assert hashlib.sha256((SOURCE / row['path']).read_bytes()).hexdigest() == row['sha256'], row['path']
    for row in provenance['kaykit']['files']:
        assert hashlib.sha256((REPO / row['path']).read_bytes()).hexdigest() == row['sha256'], row['path']


def bounds(objects):
    points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    return ([min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)])


def import_meshes(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in set(bpy.context.scene.objects) - before if o.type == 'MESH']


def freeze(object):
    matrix = object.matrix_world.copy()
    object.parent = None
    object.matrix_world = Matrix.Identity(4)
    object.data.transform(matrix)


def build(team, source_team):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cart = import_meshes(SOURCE / 'kenney/cart.glb')
    # Resolve by source names/parentage, not import order; preserve both source wheels.
    body = next(o for o in cart if o.name == 'cart')
    # This is self-propelled: remove the handcart's rear handles and their
    # parking legs, beyond the original rear board at y=.305. Keep the complete
    # deck, board silhouette, wheels and source file; cap each cut wood boundary.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    cut = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        dist=1e-7, plane_co=(0, .306, 0), plane_no=(0, 1, 0), clear_outer=True)
    edges = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(body.data)
    bm.free()
    wheels = [o for o in cart if o != body]
    assert len(wheels) == 2
    original_matrices = {o: o.matrix_world.copy() for o in cart}
    for o in cart:
        o.parent = None
        o.matrix_world = original_matrices[o]
        freeze(o)
        o.data.transform(Matrix.Scale(1.5, 4))
        # Wheel axle is at source y=-.195, centre this on simulation position.
        o.data.transform(Matrix.Translation((0, .2925, 0)))
    # The adopted simulation circle is unchanged. Shorten only the deck's
    # longitudinal dimension around the axle; wheels/head retain their size.
    # The deck is now 1.0m long at the unchanged .975m width (corner radius
    # about .70m), clear of an adjacent soldier's forward stance.
    body.data.transform(Matrix.Diagonal((1, 2/3, 1, 1)))
    wheels.sort(key=lambda o: bounds([o])[0][0])
    body.name = 'CarriageGeometry'
    for o, name in zip(wheels, ['Wheel_L_Geometry', 'Wheel_R_Geometry']):
        o.name = name
    wheel_centres = [Vector([(a + b) / 2 for a, b in zip(*bounds([o]))]) for o in wheels]
    wheel_radius = (bounds([wheels[0]])[1][2] - bounds([wheels[0]])[0][2]) / 2
    # Reuse the adopted linear team colour on EXISTING side-board faces.
    # Do not paint the whole wood atlas or add decorative geometry to simulate identity.
    panel = bpy.data.materials.new(f'battle-{team}-panel')
    panel.use_nodes = True
    panel_color = (.035, .33, .25, 1) if team == 'teal' else (.56, .105, .045, 1)
    panel.diffuse_color = panel_color
    panel.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = panel_color
    body.data.materials.append(panel)
    body.data.update()
    panel_faces = [p for p in body.data.polygons
                   if (abs(p.normal.x) > .9 and .38 < p.center.z < .72)
                   or (p.normal.z > .9 and .48 < p.center.z < .51 and abs(p.center.y) < .7)]
    assert panel_faces, 'Fixed source side boards no longer match; inspect the source rather than guessing'
    panel_triangles = sum(len(p.vertices) - 2 for p in panel_faces)
    for p in panel_faces:
        p.material_index = len(body.data.materials) - 1

    tower_path = REPO / f'asset-pipeline/battle/source/kaykit/buildings/{source_team}/building_tower_catapult_{source_team}.gltf'
    tower = import_meshes(tower_path)
    turret = next(o for o in tower if o.name == f'catapult_turret_{source_team}')
    arm = next(o for o in tower if o.name == f'catapult_arm_{source_team}')
    building = next(o for o in tower if o.name == f'building_tower_catapult_{source_team}')
    mats = {o: o.matrix_world.copy() for o in (turret, arm)}
    pivot = arm.matrix_world.translation.copy()
    for o in (turret, arm):
        o.parent = None
        o.matrix_world = mats[o]
        freeze(o)
    bpy.data.objects.remove(building, do_unlink=True)
    # Full mechanical head stays proportionate; only translate/UNIFORM scale original pieces.
    head_transform = Matrix.Translation((0, 0, .57)) @ Matrix.Scale(1.15, 4) @ Matrix.Translation((0, 0, -1.4))
    for o in (turret, arm):
        o.data.transform(head_transform)
    pivot = head_transform @ pivot
    turret.name = 'TurretGeometry'
    arm.name = 'ThrowingArmGeometry'
    all_meshes = cart + [turret, arm]
    chassis_lo, chassis_hi = bounds([body])
    chassis_radius = max(math.hypot(v.co.x, v.co.y) for v in body.data.vertices)

    # Explicit mechanical rig: no humanoid retarget, no scaled melee source.
    rig_data = bpy.data.armatures.new('SiegeRig')
    rig = bpy.data.objects.new('SiegeRig', rig_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    anchors = {'Root': Vector((0, 0, 0)), 'Carriage': Vector((0, 0, .35)),
               'Wheel_L': wheel_centres[0], 'Wheel_R': wheel_centres[1],
               'Turret': Vector((0, 0, .57)), 'Arm': pivot}
    parents = {'Carriage': 'Root', 'Wheel_L': 'Root', 'Wheel_R': 'Root', 'Turret': 'Carriage', 'Arm': 'Turret'}
    for name, anchor in anchors.items():
        bone = rig_data.edit_bones.new(name)
        bone.head = anchor
        bone.tail = anchor + Vector((0, 0, .12))
        if name in parents:
            bone.parent = rig_data.edit_bones[parents[name]]
    bpy.ops.object.mode_set(mode='OBJECT')
    for o, name in [(body, 'Carriage'), (wheels[0], 'Wheel_L'), (wheels[1], 'Wheel_R'), (turret, 'Turret'), (arm, 'Arm')]:
        group = o.vertex_groups.new(name=name)
        group.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    bpy.ops.object.select_all(action='DESELECT')
    for o in all_meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    mesh = body
    mesh.name = f'siege-{team}-geometry'
    mesh.parent = rig
    modifier = mesh.modifiers.new('Rigid mechanical skin', 'ARMATURE')
    modifier.object = rig
    # Native source atlases remain outside the explicit team panels.
    for material in mesh.data.materials:
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = .82
        bsdf.inputs['Metallic'].default_value = 0

    scene = bpy.context.scene
    scene.render.fps = 30
    walk_frames = 18
    durations = {'idle': 30, 'walk': walk_frames, 'attack': 22, 'hurt': 12, 'death': 30,
                 'attack_prepare': 13, 'attack_release': 5, 'attack_recover': 17, 'attack_cycle_preview_only': 35}
    rig.animation_data_create()
    for name, frame_count in durations.items():
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        frames = list(range(math.ceil(frame_count))) + [frame_count]
        for frame in frames:
            t = frame / frame_count
            for bone in rig.pose.bones:
                bone.rotation_mode = 'XYZ'
                bone.rotation_euler = (0, 0, 0)
                bone.location = (0, 0, 0)
                bone.scale = (1, 1, 1)
            arm_pose = rig.pose.bones['Arm']
            if name == 'walk':
                for wheel in ('Wheel_L', 'Wheel_R'):
                    rig.pose.bones[wheel].rotation_euler.x = 2 * math.pi * t
                # Small suspension motion only. No authored root translation.
                rig.pose.bones['Carriage'].location.y = .006 * (1 - math.cos(4 * math.pi * t))
            if name == 'attack_prepare':
                arm_pose.rotation_euler.x = math.radians(-22 * t)
            elif name == 'attack_release':
                arm_pose.rotation_euler.x = math.radians(-22 + 97 * t)
            elif name == 'attack_recover':
                arm_pose.rotation_euler.x = math.radians(75 * (1 - t))
            elif name == 'attack_cycle_preview_only':
                f = frame
                angle = -22 * f / 13 if f <= 13 else -22 + 97 * (f - 13) / 5 if f <= 18 else 75 * (1 - (f - 18) / 17)
                arm_pose.rotation_euler.x = math.radians(angle)
            elif name == 'attack':
                # Existing minion consumer sees committed release only. Never show preparation AFTER damage.
                angle = 75 * frame / 5 if frame <= 5 else 75 * (1 - (frame - 5) / 17)
                arm_pose.rotation_euler.x = math.radians(angle)
            elif name == 'hurt':
                rig.pose.bones['Turret'].rotation_euler.z = math.radians(4 * math.sin(t * math.pi * 2) * (1 - t))
            elif name == 'death':
                f = min(1, t / .7)
                arm_pose.rotation_euler.x = math.radians(-35 * f)
                rig.pose.bones['Turret'].rotation_euler.z = math.radians(55 * f)
                rig.pose.bones['Carriage'].rotation_euler.x = math.radians(-8 * f)
                rig.pose.bones['Carriage'].location.y = .14 * f
            for bone in rig.pose.bones:
                for prop in ('location', 'rotation_euler', 'scale'):
                    bone.keyframe_insert(prop, frame=frame)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        action.use_fake_user = True
    rig.animation_data.action = bpy.data.actions['idle']
    scene.frame_start = 0
    scene.frame_end = 30
    scene.frame_set(0)
    bpy.ops.file.pack_all()
    for image in bpy.data.images:
        if image.packed_file:
            image.filepath = '//embedded/' + image.name
            for packed in image.packed_files:
                packed.filepath = image.filepath
    # Portable authoring source also excludes Blender's default UI home path.
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == 'FILE_BROWSER' and space.params:
                    space.params.directory = b'//'
                    space.params.filename = ''
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f'siege-{team}.blend'), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(EXPORT / f'siege-{team}.glb'), export_format='GLB',
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_range=False, export_yup=True, export_skins=True, export_apply=False)
    b = (EXPORT / f'siege-{team}.glb').read_bytes()
    lo, hi = bounds([mesh])
    return dict(id=f'siege-{team}',file=f'exported/siege-{team}.glb',bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),
                restBoundsBlender=dict(min=lo,max=hi),bones=list(anchors),clipFrames=durations,
                staticChassisBoundsBlender=dict(min=chassis_lo,max=chassis_hi),staticChassisHorizontalRadius=chassis_radius,
                wheelRadius=wheel_radius,distancePerWalkCycle=2*math.pi*wheel_radius,
                nominalWalkSpeed=2*math.pi*wheel_radius/(walk_frames/30),teamPanelTriangles=panel_triangles,
                sourceGeometry='Kenney cart deck and two wheels, rear pull handles/parking legs removed and cuts capped, deck longitudinal scale 2/3; original KayKit turret and arm; stone tower excluded')


verify_sources()
assets = [build('teal', 'green'), build('rust', 'red')]
(HERE / 'manifest.json').write_text(json.dumps(dict(schemaVersion=1,status='source-candidate',
    license='CC0-1.0',up='+Y',forward='+Z',fps=30,nominalGroundY=0,assets=assets,
    animationContract=dict(defaultAttack='release-first 5/30s + recover 17/30s; triggered only at real basicAttack',
        optionalPhases='prepare 13/30s, release 5/30s, recover 17/30s; consumer must have authoritative phase events',
        previewOnly='attack_cycle_preview_only is an author comparison, NOT a gameplay clip',
        movement='no Root motion; v11 wheels sample authored walk rotation by actual travelled distance independently of cast phase; v10 walk uses speed ratio',
        death='cosmetic mechanical collapse only, no projectile/hit/splash particles; use real minionDied'),
    runtimeConsumer='src/render/battlefield.ts'),indent=2)+'\n')
