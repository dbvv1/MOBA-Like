"""Contact acceptance for the Veyra death candidates.

Two modes:

* ``--mode reproduce`` samples the shipped baseline GLBs and proves the
  reported death foot penetration is reproducible.  It exits 1 if the defect
  is not present, so a false "reproduction" cannot be mistaken for a fix.
* ``--mode verify`` (default) samples the candidates and checks the contact,
  duration, name-keyed action/mesh/bind/material invariants, and the
  death-Root-only change.  The byte-level diff rule is applied when the
  container is untouched (the runtime fallback); a rebuilt GLB may reorder
  nodes and joints, so it is checked semantically instead.

Usage (from the repository root):

    python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce
    python asset-pipeline/veyra-death-contact/tests/check_contact.py
    python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005

Prepare the pinned original snapshot with ``tools/baseline.py`` first.
The baseline defaults to that snapshot; an explicit environment or CLI override
may select another copy, which must pass the same independent identity checks.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGE = HERE.parents[1]
REPO = PACKAGE.parents[1]
TOOLS = PACKAGE / "tools"
sys.path.insert(0, str(TOOLS))

from glb_contact import (  # noqa: E402
    Asset,
    ContactError,
    describe_byte_diff,
    frame_times,
    root_offsets,
)


from baseline import verify_baseline, resolve_baseline_dir as resolve_pinned_baseline


def resolve_baseline_dir() -> Path:
    """Use the independently pinned original snapshot (or an explicit exact copy)."""
    return resolve_pinned_baseline()


BASELINE_DIR = resolve_baseline_dir()
CANDIDATE_DIR = PACKAGE
TEAMS = ("teal", "rust")
OTHER_CLIPS = ("idle", "walk", "attack", "hurt")
UPPER_CONTACT = 0.02
WEAPON_SLACK = 0.01
MAX_TOLERANCE = 0.02
FIRST_LAST_EPS = 1e-9
STABLE_EPS = 1e-4
ROOT_EPS = 1e-6


def validate_tolerance(value: float) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ContactError("tolerance must be a number")
    if not (0.0 < float(value) <= MAX_TOLERANCE):
        raise ContactError(
            f"invalid tolerance {value!r}: expected 0 < tolerance <= {MAX_TOLERANCE}"
        )
    return float(value)


def death_accessor_layout(asset: Asset):
    animation = asset.find_clip("death")
    node_index = asset.node_names.index("Root")
    for channel in animation["channels"]:
        target = channel["target"]
        if target["node"] == node_index and target["path"] == "translation":
            sampler = animation["samplers"][channel["sampler"]]
            accessor_index = sampler["output"]
            accessor = asset.json["accessors"][accessor_index]
            view = asset.json["bufferViews"][accessor["bufferView"]]
            start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            return start, accessor
    raise ContactError("death has no Root translation channel")


def byte_diff_allowed(baseline: Asset, candidate: Asset):
    diff = describe_byte_diff(baseline.glb, candidate.glb)
    if not diff["jsonEqual"] or not diff["allowed"]:
        return False, diff, "JSON or chunk layout changed"
    start, accessor = death_accessor_layout(baseline)
    if accessor["type"] != "VEC3" or accessor["componentType"] != 5126:
        return False, diff, "unexpected Root translation accessor"
    end = start + accessor["count"] * 12
    for index in diff.get("diffs", []):
        if not (start <= index < end):
            return False, diff, f"byte {index} outside the Root translation accessor"
        if (index - start) % 12 not in (4, 5, 6, 7):
            return False, diff, f"byte {index} is not in a translation Y word"
    return True, diff, ""


def flatten(parts):
    points = []
    for part in parts:
        points.extend(part)
    return points


def max_delta(left, right):
    if len(left) != len(right):
        return float("inf")
    return max(
        (
            abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
            for a, b in zip(left, right)
        ),
        default=0.0,
    )


def channel_map(asset: Asset, clip: str):
    """Decoded channels keyed by (node name, target path).

    Exporters may reorder nodes and joints between Blender versions, so every
    cross-asset comparison is by name, never by index.
    """
    animation = asset.find_clip(clip)
    channels = {}
    for channel in animation["channels"]:
        target = channel["target"]
        key = (asset.node_names[target["node"]], target["path"])
        sampler = animation["samplers"][channel["sampler"]]
        channels[key] = {
            "interpolation": sampler.get("interpolation", "LINEAR"),
            "input": [row[0] for row in asset.glb.accessor(sampler["input"])],
            "output": [tuple(row) for row in asset.glb.accessor(sampler["output"])],
        }
    return channels


def node_parents(asset: Asset):
    parents = {}
    for index, name in enumerate(asset.node_names):
        parent = asset.parent.get(index)
        parents[name] = asset.node_names[parent] if parent is not None else None
    return parents


def joint_inverse_binds(asset: Asset):
    return {
        name: asset.inverse_bind[index]
        for index, name in enumerate(asset.joint_names)
    }


def geometry_by_material(asset: Asset):
    """Vertex data that must not change, grouped by material name."""
    groups = {}
    for primitive in asset.primitives():
        groups.setdefault(primitive["material"], []).append(
            {
                "positions": primitive["positions"],
                "normals": primitive["normals"],
                # Joint array order may change across exporters. Compare the
                # nonzero influences by bone identity, not raw joint indices.
                "boneWeights": [
                    tuple(sorted((asset.joint_names[joint], weight)
                                 for joint, weight in zip(joints, weights)
                                 if weight != 0.0))
                    for joints, weights in zip(primitive["joints"], primitive["weights"])
                ],
                "weights": primitive["weights"],
                "indices": primitive["indices"],
            }
        )
    return groups


def rest_skinned_by_material(asset: Asset):
    groups = {}
    for primitive, positions in zip(asset.primitives(), asset.rest_skinned()):
        groups.setdefault(primitive["material"], []).append(tuple(positions))
    return groups


def expected_root_offsets(baseline: Asset):
    return root_offsets(baseline, clip="death", zero_from_frame=18)[0]


def check_invariants(baseline: Asset, candidate: Asset):
    errors = []
    diff = describe_byte_diff(baseline.glb, candidate.glb)

    # 1. Bone names, parent chain and bind matrices, all by name (a rebuilt
    #    export may legally reorder nodes/joints in the container).
    if set(baseline.node_names) != set(candidate.node_names):
        errors.append("node names changed")
    if node_parents(baseline) != node_parents(candidate):
        errors.append("node parent map changed")
    if set(baseline.joint_names) != set(candidate.joint_names):
        errors.append("skin joint set changed")
    elif joint_inverse_binds(baseline) != joint_inverse_binds(candidate):
        errors.append("inverse bind matrices changed")

    # 2. Mesh positions/normals/bone weights/indices and rest-pose skinning.
    if geometry_by_material(baseline) != geometry_by_material(candidate):
        errors.append("mesh accessor positions/normals/bone weights/indices changed")
    if rest_skinned_by_material(baseline) != rest_skinned_by_material(candidate):
        errors.append("rest-pose skinning changed")
    if baseline.json.get("materials") != candidate.json.get("materials"):
        errors.append("material definitions changed")

    # 3. Other four actions are bit-identical after decoding.
    for clip in OTHER_CLIPS:
        if channel_map(baseline, clip) != channel_map(candidate, clip):
            errors.append(f"clip {clip} changed")

    # 4. Death differs only in the Root translation Y lift.
    base_death = channel_map(baseline, "death")
    cand_death = channel_map(candidate, "death")
    root_key = ("Root", "translation")
    if set(base_death) != set(cand_death):
        errors.append("death channel set changed")
    else:
        offsets = expected_root_offsets(baseline)
        for key in base_death:
            left = base_death[key]
            right = cand_death[key]
            if key != root_key:
                if left != right:
                    errors.append(f"death channel {key} changed")
                continue
            if left["input"] != right["input"]:
                errors.append("death Root translation times changed")
            if left["interpolation"] != right["interpolation"]:
                errors.append("death Root translation interpolation changed")
            if len(left["output"]) != len(right["output"]) or len(offsets) != len(left["output"]):
                errors.append("death Root translation key count changed")
                continue
            for index, (base, built, offset) in enumerate(
                zip(left["output"], right["output"], offsets)
            ):
                expected_y = base[1] + offset
                if (
                    abs(base[0] - built[0]) > ROOT_EPS
                    or abs(expected_y - built[1]) > ROOT_EPS
                    or abs(base[2] - built[2]) > ROOT_EPS
                ):
                    errors.append(
                        f"death Root key {index} is not baseline + offset"
                    )
                    break

    # 5. Death duration.
    if baseline.clip_times("death")[:2] != candidate.clip_times("death")[:2]:
        errors.append("death duration changed")

    # 6. First and last poses.
    start, end, _ = candidate.clip_times("death")
    for tag, t in (("first", start), ("last", end)):
        delta = max_delta(
            flatten(baseline.skinned("death", t)), flatten(candidate.skinned("death", t))
        )
        if delta > FIRST_LAST_EPS:
            errors.append(f"death {tag} pose moved by {delta:.6g} m")

    # 7. Stable last pose (frames 30 and 31).
    delta = max_delta(
        flatten(candidate.skinned("death", end - 1.0 / 30.0)),
        flatten(candidate.skinned("death", end)),
    )
    if delta > STABLE_EPS:
        errors.append(f"last death frames are not stable (delta {delta:.6g} m)")

    # 8. Byte-level rule only applies to the untouched-container runtime
    #    fallback; a source rebuild is allowed to reorder the GLB.
    if diff["jsonEqual"]:
        allowed, _diff, reason = byte_diff_allowed(baseline, candidate)
        if not allowed:
            errors.append(f"byte diff: {reason}")
    return errors, diff


def sample_rows(asset: Asset):
    return frame_times(asset, "death", fps=30.0, half=True)


def verify_team(team: str, baseline_dir: Path, candidate_dir: Path, tolerance: float):
    verify_baseline(baseline_dir)
    baseline_path = baseline_dir / "exported" / f"veyra-{team}.glb"
    candidate_path = candidate_dir / "exported" / f"veyra-{team}.glb"
    baseline = Asset(baseline_path)
    candidate = Asset(candidate_path)
    samples = sample_rows(candidate)
    baseline_rows = [baseline.contact("death", t) for t, _ in samples]
    rows = []
    errors = []
    for (t, frame), base in zip(samples, baseline_rows):
        row = candidate.contact("death", t)
        row["frame"] = frame
        row["baseBodyMinY"] = base["bodyMinY"]
        row["baseWeaponMinY"] = base["weaponMinY"]
        rows.append(row)
        if row["bodyMinY"] < -tolerance:
            errors.append(
                f"frame {frame}: body {row['bodyMinY']:.5f} < -{tolerance:.5f} m"
            )
        if row["bodyMinY"] > UPPER_CONTACT:
            errors.append(
                f"frame {frame}: body {row['bodyMinY']:.5f} > +{UPPER_CONTACT:.5f} m (floating)"
            )
        if row["footMinY"] < -tolerance:
            errors.append(
                f"frame {frame}: foot {row['footMinY']:.5f} < -{tolerance:.5f} m"
            )
        if row["weaponMinY"] < base["weaponMinY"] - WEAPON_SLACK:
            errors.append(
                f"frame {frame}: weapon {row['weaponMinY']:.5f} below baseline "
                f"{base['weaponMinY']:.5f} - {WEAPON_SLACK:.3f} m"
            )
    invariants, diff = check_invariants(baseline, candidate)
    errors.extend(invariants)
    report = {
        "id": f"veyra-{team}",
        "mode": "verify",
        "tolerance": tolerance,
        "samples": len(rows),
        "lowestBodyMinY": min(row["bodyMinY"] for row in rows),
        "lowestBodyFrame": min(rows, key=lambda row: row["bodyMinY"])["frame"],
        "highestBodyMinY": max(row["bodyMinY"] for row in rows),
        "highestBodyFrame": max(rows, key=lambda row: row["bodyMinY"])["frame"],
        "lowestFootMinY": min(row["footMinY"] for row in rows),
        "lowestWeaponMinY": min(row["weaponMinY"] for row in rows),
        "byteDiff": {key: value for key, value in diff.items() if key != "diffs"},
        "errors": errors,
        "passed": not errors,
    }
    return report, rows


def reproduce_team(team: str, baseline_dir: Path, penetration: float):
    verify_baseline(baseline_dir)
    baseline = Asset(baseline_dir / "exported" / f"veyra-{team}.glb")
    samples = sample_rows(baseline)
    rows = []
    for t, frame in samples:
        row = baseline.contact("death", t)
        row["frame"] = frame
        rows.append(row)
    worst_body = min(rows, key=lambda row: row["bodyMinY"])
    worst_foot = min(rows, key=lambda row: row["footMinY"])
    reproduced = worst_foot["footMinY"] <= -penetration
    report = {
        "id": f"veyra-{team}",
        "mode": "reproduce",
        "threshold": penetration,
        "samples": len(rows),
        "worstFootMinY": worst_foot["footMinY"],
        "worstFootFrame": worst_foot["frame"],
        "worstFootBone": worst_foot["footMinBone"],
        "worstBodyMinY": worst_body["bodyMinY"],
        "worstBodyFrame": worst_body["frame"],
        "worstBodyBone": worst_body["bodyMinBone"],
        "reproduced": reproduced,
        "errors": [] if reproduced else [
            f"foot contact never reached -{penetration:.3f} m; the reported defect "
            "was not reproduced, so no source change is justified"
        ],
    }
    return report, rows


def main(argv=None):
    parser = argparse.ArgumentParser(description="Veyra death contact acceptance")
    parser.add_argument("--mode", choices=("verify", "reproduce"), default="verify")
    parser.add_argument("--tolerance", type=float, default=0.01,
                        help="maximum penetration below Y=0 (default 0.01 m)")
    parser.add_argument("--penetration", type=float, default=0.01,
                        help="reproduce mode: required penetration threshold")
    parser.add_argument("--baseline-dir", type=Path, default=BASELINE_DIR)
    parser.add_argument("--candidate-dir", type=Path, default=CANDIDATE_DIR)
    parser.add_argument("--team", choices=TEAMS, default=None)
    parser.add_argument("--rows", action="store_true", help="include every sample in the output")
    parser.add_argument("--json", type=Path, default=None, help="write the report here")
    args = parser.parse_args(argv)

    teams = (args.team,) if args.team else TEAMS
    reports = []
    row_sets = {}
    try:
        tolerance = validate_tolerance(args.tolerance)
        if not (0.0 < args.penetration <= MAX_TOLERANCE):
            raise ContactError("penetration threshold must be in (0, 0.02]")
        for team in teams:
            if args.mode == "reproduce":
                report, rows = reproduce_team(team, args.baseline_dir, args.penetration)
            else:
                report, rows = verify_team(team, args.baseline_dir, args.candidate_dir, tolerance)
            reports.append(report)
            row_sets[team] = rows
    except ContactError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    payload = {
        "mode": args.mode,
        "tolerance": tolerance,
        "upperContact": UPPER_CONTACT,
        "teams": reports,
        "passed": all(report.get("passed", report.get("reproduced", False)) for report in reports),
    }
    if args.rows:
        payload["rows"] = row_sets
    text = json.dumps(payload, indent=2)
    if args.json:
        args.json.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
