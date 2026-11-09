"""Rebuild the editable Veyra death-contact source candidates and their GLBs.

This script runs inside Blender's Python (`bpy`).  For each team it:

1. opens the pinned original editable source under this package's
   ``baseline/source/`` read-only,
2. computes the per-key death ``Root`` Y lift with the dependency-free
   :mod:`glb_contact` sampler (the same values ``tools/build_candidates.py``
   writes into the runtime fallback),
3. adds those offsets to the 31 death ``Root`` location Y keyframes through
   the Blender 5.x layered-action channelbag API (``Action.fcurves`` no longer
   exists),
4. saves the result as this package's ``source/veyra-<team>.blend`` and
   re-exports ``exported/veyra-<team>.glb`` with the recipe's original export
   settings (``export_yup``, ``ACTIONS``, ``export_force_sampling``).

The upstream ``asset-pipeline/heroes/`` tree is never written.  Rebuilding is
deterministic at the GLB level: reopening a saved ``source/*.blend`` and
exporting reproduces ``exported/*.glb`` byte-for-byte (``--check-only`` proves
it).  The compressed ``.blend`` bytes themselves can differ between Blender
builds, so the manifest records the exact source hashes that were delivered.

Prepare the original snapshot with ``tools/baseline.py`` before running this
builder. It defaults to that snapshot; ``VEYRA_DEATH_BASELINE_DIR`` may select
another exact copy, verified against the same independent lock.

Usage:
    <python with the Blender bpy module> \
        asset-pipeline/veyra-death-contact/tools/build_source_candidates.py
    <same> .../build_source_candidates.py --check-only
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGE = HERE.parents[1]
REPO = PACKAGE.parents[1]
sys.path.insert(0, str(HERE.parent))

from glb_contact import ContactError  # noqa: E402
from baseline import verify_baseline, resolve_baseline_dir as resolve_pinned_baseline

try:
    import bpy  # noqa: E402
except ImportError as exc:  # pragma: no cover - exercised only without bpy
    raise SystemExit(
        "ERROR: this tool needs the Blender `bpy` Python module in a background "
        "interpreter (no GUI). Install/point PYTHONPATH at a bpy environment, "
        "then rerun."
    ) from exc

def resolve_baseline_root() -> Path:
    """Use the independently pinned original snapshot (or an explicit exact copy)."""
    return resolve_pinned_baseline()


BASELINE_ROOT = resolve_baseline_root()
SOURCE_DIR = PACKAGE / "source"
EXPORT_DIR = PACKAGE / "exported"
REPORTS_DIR = PACKAGE / "reports"
MANIFEST = PACKAGE / "manifest.json"
TEAMS = ("teal", "rust")
FPS = 30.0
ZERO_FROM_FRAME = 18
FPS_EXPORT = 30
EXPORT_KWARGS = {
    "export_format": "GLB",
    "export_animations": True,
    "export_animation_mode": "ACTIONS",
    "export_force_sampling": True,
    "export_yup": True,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def baseline_path(team: str) -> Path:
    return BASELINE_ROOT / "exported" / f"veyra-{team}.glb"


def baseline_source(team: str) -> Path:
    return BASELINE_ROOT / "source" / f"veyra-{team}.blend"


def load_upstream_manifest():
    verify_baseline(BASELINE_ROOT)
    path = BASELINE_ROOT / "manifest.json"
    if not path.is_file():
        raise ContactError(f"missing upstream manifest: {display_path(path)}")
    return json.loads(path.read_text(encoding="utf-8"))


def expected_hashes(manifest):
    return {row["id"]: row["sha256"] for row in manifest.get("assets", [])}


def death_offsets(team: str):
    from glb_contact import Asset, root_offsets

    offsets, details = root_offsets(
        Asset(baseline_path(team)), clip="death", zero_from_frame=ZERO_FROM_FRAME
    )
    return offsets, details


def channelbags(action):
    """Yield every layered-action channelbag, across slots, strips and layers."""
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag = strip.channelbag(slot)
                if bag is not None:
                    yield bag


def find_root_y_curve(action):
    for bag in channelbags(action):
        for curve in bag.fcurves:
            if curve.data_path == 'pose.bones["Root"].location' and curve.array_index == 1:
                return curve
    raise ContactError(f'action {action.name!r} has no Root location Y curve')


def assert_upstream_hashes(manifest, team: str):
    asset_id = f"veyra-{team}"
    expected = expected_hashes(manifest)
    if asset_id not in expected:
        raise ContactError(f"upstream manifest does not list {asset_id}")
    for path in (baseline_path(team), baseline_source(team)):
        if not path.is_file():
            raise ContactError(f"missing upstream file: {display_path(path)}")
    actual = sha256(baseline_path(team))
    if actual != expected[asset_id]:
        raise ContactError(
            f"baseline hash mismatch for {asset_id}: {actual} != {expected[asset_id]}"
        )


def open_blend(path: Path):
    if not path.is_file():
        raise ContactError(f"missing .blend source: {display_path(path)}")
    bpy.ops.wm.open_mainfile(filepath=str(path), use_scripts=False)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.render.fps = FPS_EXPORT


def apply_offsets(offsets):
    action = bpy.data.actions.get("death")
    if action is None:
        raise ContactError("source .blend has no 'death' action")
    curve = find_root_y_curve(action)
    points = curve.keyframe_points
    if len(points) != len(offsets):
        raise ContactError(
            f"death Root Y has {len(points)} keys, expected {len(offsets)}"
        )
    for point, offset in zip(points, offsets):
        point.co[1] = point.co[1] + offset
        point.handle_left[1] = point.co[1]
        point.handle_right[1] = point.co[1]
    curve.update()
    return action


def preserve_orphans():
    """Keep zero-user datablocks that Blender would otherwise drop on save.

    The shipped sources carry two unused legacy materials (``M_Joints``,
    ``M_Main``) with no users.  A plain resave silently omits them; marking
    them fake-user preserves the original source content.
    """
    for material in bpy.data.materials:
        if material.users == 0:
            material.use_fake_user = True


def save_blend(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)


def export_glb(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    rig = bpy.data.objects.get("GuardRig")
    idle = bpy.data.actions.get("idle")
    if rig is None or idle is None:
        raise ContactError("source .blend lost its rig or idle action")
    rig.animation_data.action = idle
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(filepath=str(path), **EXPORT_KWARGS)


def contact_summary(candidate: Path):
    from glb_contact import Asset, frame_times

    asset = Asset(candidate)
    rows = asset.contact_series(
        "death", [time for time, _frame in frame_times(asset, "death")]
    )
    worst = min(rows, key=lambda row: row["bodyMinY"])
    highest = max(rows, key=lambda row: row["bodyMinY"])
    return {
        "samples": len(rows),
        "lowestBodyMinY": worst["bodyMinY"],
        "lowestBodyFrame": worst["time"] * FPS,
        "highestBodyMinY": highest["bodyMinY"],
        "highestBodyFrame": highest["time"] * FPS,
    }


def verify_candidate(team: str, tolerance: float):
    sys.path.insert(0, str(PACKAGE / "tests"))
    import check_contact

    report, _rows = check_contact.verify_team(
        team, BASELINE_ROOT, PACKAGE, tolerance
    )
    if not report["passed"]:
        raise ContactError(
            f"rebuilt {team} candidate failed at {tolerance} m: {report['errors']}"
        )
    return report


def build_team(team: str, upstream_manifest):
    assert_upstream_hashes(upstream_manifest, team)
    source_out = SOURCE_DIR / f"veyra-{team}.blend"
    glb_out = EXPORT_DIR / f"veyra-{team}.glb"
    baseline_glb = baseline_path(team)

    offsets, details = death_offsets(team)
    open_blend(baseline_source(team))
    preserve_orphans()
    apply_offsets(offsets)
    save_blend(source_out)
    export_glb(glb_out)

    # Reopen the delivered source and re-export it: the editable source, not
    # this process's in-memory state, must reproduce the delivered GLB.
    open_blend(source_out)
    with tempfile.TemporaryDirectory() as tmp:
        rebuilt = Path(tmp) / glb_out.name
        export_glb(rebuilt)
        if sha256(rebuilt) != sha256(glb_out):
            raise ContactError(
                f"reopened source does not reproduce {display_path(glb_out)}"
            )

    verify_candidate(team, 0.01)
    verify_candidate(team, 0.005)
    return {
        "id": f"veyra-{team}",
        "team": team,
        "baseline": display_path(baseline_glb),
        "baselineSha256": sha256(baseline_glb),
        "upstreamSource": display_path(baseline_source(team)),
        "upstreamSourceSha256": sha256(baseline_source(team)),
        "source": display_path(source_out),
        "sourceSha256": sha256(source_out),
        "sourceBytes": source_out.stat().st_size,
        "file": display_path(glb_out),
        "sha256": sha256(glb_out),
        "bytes": glb_out.stat().st_size,
        "deathOffsets": details,
        "maxOffsetY": max(offsets),
        "contactAtFrameAndHalf": contact_summary(glb_out),
    }


def write_reports(results):
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "schemaVersion": 1,
        "fps": FPS,
        "note": "Offsets are added to the death Root translation Y at each "
                "exported key; frame 1 and frames >= zeroFromFrame stay at zero.",
        "zeroFromFrame": ZERO_FROM_FRAME,
        "assets": [
            {
                "id": row["id"],
                "baselineSha256": row["baselineSha256"],
                "maxOffsetY": row["maxOffsetY"],
                "keys": row["deathOffsets"],
            }
            for row in results
        ],
    }
    (REPORTS_DIR / "death-root-offsets.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    manifest = {
        "schemaVersion": 2,
        "kind": "source-rebuilt-candidate",
        "license": "CC0-1.0",
        "basis": {
            "source": display_path(BASELINE_ROOT),
            "manifestSha256": sha256(BASELINE_ROOT / "manifest.json"),
            "fps": FPS,
        },
        "editableSource": {
            "status": "produced",
            "files": [row["source"] for row in results],
            "tool": "tools/build_source_candidates.py",
            "derivedFrom": "source/veyra-{teal,rust}.blend under the verified original baseline",
            "change": "death Root location Y keys offset by reports/death-root-offsets.json; "
                      "no other pose, geometry or action data changed (the two zero-user "
                      "legacy materials keep fake users so the resave does not drop them)",
            "blender": {
                "module": "bpy",
                "version": bpy.app.version_string,
                "export": dict(EXPORT_KWARGS),
            },
            "reproducible": "reopening source/*.blend and re-exporting reproduces exported/*.glb byte-for-byte",
        },
        "runtimeFallback": {
            "dir": "runtime-fallback",
            "manifest": "runtime-fallback/manifest.json",
            "note": "binary patch of the shipped GLBs, kept only as fallback evidence",
        },
        "assets": results,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def check_only():
    manifest = load_upstream_manifest()
    results = []
    for team in TEAMS:
        assert_upstream_hashes(manifest, team)
        source = SOURCE_DIR / f"veyra-{team}.blend"
        glb = EXPORT_DIR / f"veyra-{team}.glb"
        if not source.is_file():
            raise ContactError(f"missing source candidate: {display_path(source)}")
        if not glb.is_file():
            raise ContactError(f"missing exported candidate: {display_path(glb)}")
        open_blend(source)
        with tempfile.TemporaryDirectory() as tmp:
            rebuilt = Path(tmp) / glb.name
            export_glb(rebuilt)
            if sha256(rebuilt) != sha256(glb):
                raise ContactError(
                    f"source {display_path(source)} does not reproduce {display_path(glb)}"
                )
        verify_candidate(team, 0.01)
        verify_candidate(team, 0.005)
        results.append(
            {
                "id": f"veyra-{team}",
                "source": display_path(source),
                "sourceSha256": sha256(source),
                "file": display_path(glb),
                "sha256": sha256(glb),
                "reproduced": True,
            }
        )
    print(json.dumps({"mode": "check", "blender": bpy.app.version_string,
                      "assets": results}, indent=2))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true",
                        help="reopen the delivered sources, re-export and compare without writing")
    args = parser.parse_args(argv)

    try:
        if args.check_only:
            return check_only()
        upstream_manifest = load_upstream_manifest()
        results = [build_team(team, upstream_manifest) for team in TEAMS]
        write_reports(results)
        print(json.dumps({"mode": "build", "blender": bpy.app.version_string,
                          "assets": [{key: row[key] for key in
                                     ("id", "source", "sourceSha256", "file", "sha256")}
                                     for row in results]}, indent=2))
        return 0
    except ContactError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
