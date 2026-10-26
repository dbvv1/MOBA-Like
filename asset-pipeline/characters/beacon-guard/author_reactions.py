"""Extend the fixed CC0 author source, preserving its three existing actions."""

import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector, Quaternion


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def curves(action):
    return [
        (
            f.data_path,
            f.array_index,
            [
                (
                    tuple(k.co),
                    tuple(k.handle_left),
                    tuple(k.handle_right),
                    k.interpolation,
                )
                for k in f.keyframe_points
            ],
        )
        for f in action.fcurves
    ]


def source_structure():
    meshes = []
    for obj in sorted(
        (o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: o.name
    ):
        meshes.append(
            (
                obj.name,
                [tuple(v.co) for v in obj.data.vertices],
                [tuple(p.vertices) for p in obj.data.polygons],
                [[(g.group, g.weight) for g in v.groups] for v in obj.data.vertices],
                [g.name for g in obj.vertex_groups],
                [tuple(r) for r in obj.matrix_local],
                [m.name for m in obj.data.materials],
            )
        )
    bones = [
        (
            b.name,
            b.parent.name if b.parent else None,
            [tuple(r) for r in b.matrix_local],
        )
        for b in bpy.data.objects["GuardRig"].data.bones
    ]
    mats = [
        (
            m.name,
            tuple(m.diffuse_color),
            [
                (
                    n.name,
                    [
                        (
                            i.name,
                            tuple(i.default_value)
                            if hasattr(i.default_value, "__iter__")
                            else i.default_value,
                        )
                        for i in n.inputs
                        if hasattr(i, "default_value")
                    ],
                )
                for n in m.node_tree.nodes
            ],
        )
        for m in bpy.data.materials
        if m.use_nodes
    ]
    return digest((meshes, bones, mats))


def points():
    deps = bpy.context.evaluated_depsgraph_get()
    return [
        (
            o.name,
            [
                (tuple(o.evaluated_get(deps).matrix_world @ v.co))
                for v in o.evaluated_get(deps).data.vertices
            ],
        )
        for o in bpy.context.scene.objects
        if o.type == "MESH"
    ]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--fall-frames", type=int, default=24)
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    if not 18 <= a.fall_frames <= 45:
        raise ValueError("fall frames must be 18..45")
    if (
        hashlib.sha256(a.input.read_bytes()).hexdigest()
        != "7c9904da8061fbfe1b932f3f2317092ee8b027cf78e84945b7ea720460842fc0"
    ):
        raise ValueError("fixed blue Blend source hash mismatch")
    if a.output.exists():
        raise FileExistsError("output must not exist")
    bpy.ops.wm.open_mainfile(filepath=str(a.input.resolve()))
    rig = bpy.data.objects["GuardRig"]
    structure = source_structure()
    original = {
        name: digest(curves(bpy.data.actions[name]))
        for name in ["idle", "walk", "attack"]
    }
    bpy.context.scene.render.fps = 30
    bpy.context.preferences.filepaths.save_version = 0

    def pose(frame, angles):
        for bone in rig.pose.bones:
            bone.rotation_mode = "QUATERNION"
            axis = bone.bone.matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))
            bone.rotation_quaternion = Quaternion(
                axis, math.radians(angles.get(bone.name, 0))
            )
            bone.location = (0, 0, 0)
        bpy.context.view_layer.update()
        low = min(v[2] for _, mesh in points() for v in mesh)
        rig.pose.bones["Root"].location.y = -low
        for bone in rig.pose.bones:
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
            bone.keyframe_insert("location", frame=frame, group=bone.name)

    for name in ["hurt", "death"]:
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        end = 19 if name == "hurt" else a.fall_frames + 7
        for frame in range(1, end + 1):
            bpy.context.scene.frame_set(frame)
            if name == "hurt":
                f = (frame - 1) / 18
                recoil = math.sin(math.pi * f) ** 2
                angles = {
                    "Torso": -22 * recoil,
                    "Head": 10 * recoil,
                    "UpperArm_R": -8 - 18 * recoil,
                    "UpperArm_L": 6 - 18 * recoil,
                    "Thigh_L": 6 * recoil,
                    "Thigh_R": 6 * recoil,
                }
            else:
                f = min((frame - 1) / a.fall_frames, 1)
                f = f * f * (3 - 2 * f)
                angles = {
                    "Root": -90 * f,
                    "Torso": -5 * f,
                    "Head": 10 * f,
                    "UpperArm_R": -8 + 98 * f,
                    "UpperArm_L": 6 + 76 * f,
                    "Forearm_R": -8 * f,
                    "Forearm_L": -12 * f,
                }
            pose(frame, angles)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"
    assert original == {
        name: digest(curves(bpy.data.actions[name])) for name in original
    }
    assert structure == source_structure()
    rig.animation_data.action = bpy.data.actions["idle"]
    bpy.context.scene.frame_set(1)
    a.output.mkdir(parents=True)
    bpy.ops.wm.save_as_mainfile(
        filepath=str((a.output / "blue-reactions.blend").resolve()), compress=True
    )
    bpy.ops.wm.open_mainfile(
        filepath=str((a.output / "blue-reactions.blend").resolve())
    )
    assert original == {
        name: digest(curves(bpy.data.actions[name])) for name in original
    }
    assert structure == source_structure()
    bpy.ops.export_scene.gltf(
        filepath=str((a.output / "blue-reactions.glb").resolve()),
        export_format="GLB",
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_animations=True,
    )
    result = {
        "source_sha256": hashlib.sha256(a.input.read_bytes()).hexdigest(),
        "original_actions": original,
        "original_structure": structure,
        "fall_frames": a.fall_frames,
        "hurt_seconds": 0.6,
        "death_seconds": (a.fall_frames + 6) / 30,
    }
    (a.output / "recipe.json").write_text(json.dumps(result, indent=2) + "\n")
    print("REACTION_SOURCE_SAVED", json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
