"""Compare the delivered editable sources with the shipped upstream sources.

Runs inside Blender's Python (`bpy`): no browser, GPU, network or GUI.  For
each team it checks that the only difference in the ``.blend`` data is the
death ``Root`` location Y channel, and that every new key equals the upstream
value plus the offset recorded in ``reports/death-root-offsets.json``.

Usage (from the repository root, with a Python that provides ``bpy``):

    <bpy python> asset-pipeline/veyra-death-contact/tests/check_source_bpy.py
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGE = HERE.parents[1]
REPO = PACKAGE.parents[1]
sys.path.insert(0, str(PACKAGE / "tools"))
from baseline import verify_baseline
from glb_contact import ContactError


def resolve_baseline_root() -> Path:
    """Shipped baseline, or the pinned copy named by the shared env var.

    Adoption replaces the heroes source and export; point
    ``VEYRA_DEATH_BASELINE_DIR`` at the pinned ``b489ed38`` snapshot so this
    diff still compares the candidates with the original editable source.
    Relative values resolve from the repository root.
    """
    override = os.environ.get("VEYRA_DEATH_BASELINE_DIR")
    if not override:
        return REPO / "asset-pipeline" / "heroes" / "veyra-release"
    path = Path(override)
    return path if path.is_absolute() else (REPO / path).resolve()


UPSTREAM = resolve_baseline_root() / "source"
SOURCE = PACKAGE / "source"
REPORTS = PACKAGE / "reports" / "death-root-offsets.json"
TEAMS = ("teal", "rust")
ROOT_Y = ('pose.bones["Root"].location', 1)


def snapshot(path: Path):
    import bpy

    bpy.ops.wm.open_mainfile(filepath=str(path), use_scripts=False)
    data = {
        "objects": {},
        "bones": {},
        "mesh": {},
        "materials": {
            material.name: {
                "diffuse": tuple(round(value, 8) for value in material.diffuse_color),
            }
            for material in bpy.data.materials
        },
        "actions": {},
    }
    for obj in bpy.context.scene.objects:
        data["objects"][obj.name] = {
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "location": tuple(round(value, 8) for value in obj.location),
            "rotation": tuple(round(value, 8) for value in obj.rotation_quaternion),
            "scale": tuple(round(value, 8) for value in obj.scale),
        }
        if obj.type == "ARMATURE":
            data["bones"] = {
                bone.name: {
                    "parent": bone.parent.name if bone.parent else None,
                    "head": tuple(round(value, 8) for value in bone.head_local),
                    "tail": tuple(round(value, 8) for value in bone.tail_local),
                    "matrix": tuple(
                        round(value, 8) for row in bone.matrix_local for value in row
                    ),
                }
                for bone in obj.data.bones
            }
        if obj.type == "MESH":
            data["mesh"] = {
                "vertices": [
                    tuple(round(value, 8) for value in vertex.co)
                    for vertex in obj.data.vertices
                ],
                "groups": [group.name for group in obj.vertex_groups],
                "weights": [
                    [(group.group, round(group.weight, 8)) for group in vertex.groups]
                    for vertex in obj.data.vertices
                ],
                "polygons": [
                    tuple(polygon.vertices) for polygon in obj.data.polygons
                ],
                "materials": [
                    material.name if material else None
                    for material in obj.data.materials
                ],
            }
    for action in bpy.data.actions:
        channels = {}
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    bag = strip.channelbag(slot)
                    if bag is None:
                        continue
                    for curve in bag.fcurves:
                        channels[(curve.data_path, curve.array_index)] = [
                            [round(point.co[0], 8), round(point.co[1], 8),
                             point.interpolation]
                            for point in curve.keyframe_points
                        ]
        data["actions"][action.name] = {
            "range": tuple(round(value, 8) for value in action.frame_range),
            "channels": channels,
        }
    return data


def death_root_keys(snapshot_data):
    return snapshot_data["actions"]["death"]["channels"][ROOT_Y]


def without_death_root(snapshot_data):
    data = copy.deepcopy(snapshot_data)
    del data["actions"]["death"]["channels"][ROOT_Y]
    return data


def check_root_keys(base_keys, built_keys, offsets):
    """Check source curve timing/interpolation as well as the intended Y lift."""
    errors = []
    if len(base_keys) != 31 or len(built_keys) != 31 or len(offsets) != 31:
        return [f"death Root Y key counts are {len(base_keys)}/{len(built_keys)}/{len(offsets)}, expected 31 each"]
    for index, (report_key, base, built) in enumerate(zip(offsets, base_keys, built_keys)):
        if report_key["key"] != index or report_key["frame"] != index + 1:
            errors.append(f"report key {index} is not frame {index + 1}")
        if base[0] != index + 1 or built[0] != base[0]:
            errors.append(f"death Root Y key {index} frame changed")
        if built[2] != base[2]:
            errors.append(f"death Root Y key {index} interpolation changed")
        expected = base[1] + report_key["offsetY"]
        if abs(built[1] - expected) > 1e-6:
            errors.append(f"death Root Y key {index} is {built[1]}, expected {expected}")
        if report_key["offsetY"] == 0.0 and built[1] != base[1]:
            errors.append(f"death Root Y key {index} should be unchanged")
    return errors


def check_team(team: str, report_asset):
    verify_baseline(UPSTREAM.parent)
    upstream = snapshot(UPSTREAM / f"veyra-{team}.blend")
    candidate = snapshot(SOURCE / f"veyra-{team}.blend")

    errors = []
    if without_death_root(upstream) != without_death_root(candidate):
        errors.append("source data outside death Root location Y changed")

    base_keys = death_root_keys(upstream)
    built_keys = death_root_keys(candidate)
    offsets = report_asset["keys"]
    errors.extend(check_root_keys(base_keys, built_keys, offsets))
    return {
        "id": f"veyra-{team}",
        "keys": len(built_keys),
        "changedKeys": sum(1 for row in offsets if row["offsetY"] != 0.0),
        "errors": errors,
        "passed": not errors,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    report = json.loads(REPORTS.read_text(encoding="utf-8"))
    assets = {row["id"]: row for row in report["assets"]}
    results = [check_team(team, assets[f"veyra-{team}"]) for team in TEAMS]
    payload = {"mode": "source-check", "assets": results,
               "passed": all(row["passed"] for row in results)}
    print(json.dumps(payload, indent=2))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContactError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
