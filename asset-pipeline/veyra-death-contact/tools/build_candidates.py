"""Rebuild the Veyra runtime-fallback GLBs with a corrected death root height.

These are the fallback artifacts: the primary deliverable is the editable
source candidate produced by ``tools/build_source_candidates.py``.  This
stdlib-only builder patches the shipped GLBs directly and writes only the
death Root node translation Y samples; every other byte of the baseline GLB
is copied verbatim.

Usage (from the repository root):

    python asset-pipeline/veyra-death-contact/tools/build_candidates.py
    python asset-pipeline/veyra-death-contact/tools/build_candidates.py --check-only
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGE = HERE.parents[1]
REPO = PACKAGE.parents[1]
sys.path.insert(0, str(HERE.parent))

from glb_contact import (  # noqa: E402
    Asset,
    ContactError,
    describe_byte_diff,
    frame_times,
    root_offsets,
    write_patched_glb,
)

def resolve_baseline_dir() -> Path:
    """Shipped baseline, or the pinned copy named by the shared env var.

    Adoption overwrites the heroes export; ``VEYRA_DEATH_BASELINE_DIR`` keeps
    this builder on the shipped ``b489ed38`` GLBs without a code change.
    Relative values resolve from the repository root.
    """
    override = os.environ.get("VEYRA_DEATH_BASELINE_DIR")
    if not override:
        return REPO / "asset-pipeline" / "heroes" / "veyra-release"
    path = Path(override)
    return path if path.is_absolute() else (REPO / path).resolve()


DEFAULT_BASELINE = resolve_baseline_dir()
DEFAULT_OUT = PACKAGE / "runtime-fallback" / "exported"
DEFAULT_REPORTS = PACKAGE / "reports"
TEAMS = ("teal", "rust")
FPS = 30.0


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def display_path(path: Path) -> str:
    """Repository-relative when possible; otherwise keep the caller's path."""
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def load_manifest(baseline_dir: Path):
    path = baseline_dir / "manifest.json"
    if not path.is_file():
        raise ContactError(f"missing baseline manifest: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def build_team(team: str, baseline_dir: Path, out_dir: Path, zero_from_frame: int):
    base_path = baseline_dir / "exported" / f"veyra-{team}.glb"
    baseline = Asset(base_path)
    offsets, details = root_offsets(baseline, clip="death", zero_from_frame=zero_from_frame)
    out_path = out_dir / f"veyra-{team}.glb"
    write_patched_glb(baseline, offsets, out_path, clip="death")
    candidate = Asset(out_path)
    diff = describe_byte_diff(baseline.glb, candidate.glb)
    reference = candidate.contact_series("death", [t for t, _frame in frame_times(candidate, "death")])
    worst = min(reference, key=lambda row: row["bodyMinY"])
    highest = max(reference, key=lambda row: row["bodyMinY"])
    return {
        "id": f"veyra-{team}",
        "team": team,
        "baseline": display_path(base_path),
        "baselineSha256": sha256(base_path),
        "file": display_path(out_path),
        "sha256": sha256(out_path),
        "bytes": out_path.stat().st_size,
        "deathOffsets": details,
        "maxOffsetY": max(offsets),
        "contactAtFrameAndHalf": {
            "samples": len(reference),
            "lowestBodyMinY": worst["bodyMinY"],
            "lowestBodyFrame": worst["time"] * FPS,
            "highestBodyMinY": highest["bodyMinY"],
            "highestBodyFrame": highest["time"] * FPS,
        },
        "byteDiff": {key: value for key, value in diff.items() if key != "diffs"},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--reports-dir", type=Path, default=DEFAULT_REPORTS)
    parser.add_argument("--zero-from-frame", type=int, default=18,
                        help="first death frame whose root offset stays zero (default: 18)")
    parser.add_argument("--check-only", action="store_true",
                        help="recompute and verify without rewriting files")
    args = parser.parse_args(argv)

    # Public CLI paths may be relative or outside the repository; normalise to
    # absolute paths before any relative_to()/existence check so they raise
    # ContactError instead of an uncaught ValueError.
    args.baseline_dir = args.baseline_dir.resolve()
    args.out_dir = args.out_dir.resolve()
    args.reports_dir = args.reports_dir.resolve()
    manifest = load_manifest(args.baseline_dir)
    expected = {row["id"]: row["sha256"] for row in manifest.get("assets", [])}
    if not args.check_only:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        args.reports_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for team in TEAMS:
        asset_id = f"veyra-{team}"
        base_path = args.baseline_dir / "exported" / f"{asset_id}.glb"
        if asset_id not in expected:
            raise ContactError(f"baseline manifest does not list {asset_id}")
        actual = sha256(base_path)
        if actual != expected[asset_id]:
            raise ContactError(
                f"baseline hash mismatch for {asset_id}: {actual} != {expected[asset_id]}"
            )
        if args.check_only:
            candidate_path = args.out_dir / f"{asset_id}.glb"
            if not candidate_path.is_file():
                raise ContactError(f"missing candidate: {candidate_path}")
            baseline = Asset(base_path)
            candidate = Asset(candidate_path)
            diff = describe_byte_diff(baseline.glb, candidate.glb)
            series = candidate.contact_series(
                "death", [t for t, _frame in frame_times(candidate, "death")]
            )
            results.append(
                {
                    "id": asset_id,
                    "candidate": display_path(candidate_path),
                    "sha256": sha256(candidate_path),
                    "byteDiff": {key: value for key, value in diff.items() if key != "diffs"},
                    "lowestBodyMinY": min(row["bodyMinY"] for row in series),
                    "highestBodyMinY": max(row["bodyMinY"] for row in series),
                }
            )
        else:
            results.append(build_team(team, args.baseline_dir, args.out_dir, args.zero_from_frame))

    report = {
        "schemaVersion": 1,
        "kind": "runtime-fallback",
        "basis": {
            "source": display_path(args.baseline_dir),
            "manifestSha256": sha256(args.baseline_dir / "manifest.json"),
            "fps": FPS,
        },
        "editableSource": {
            "status": "superseded",
            "reason": "The primary deliverable is the editable source candidate in "
                      "source/veyra-{teal,rust}.blend, exported by "
                      "tools/build_source_candidates.py. This patched-GLB artifact is "
                      "kept only as fallback evidence.",
        },
        "assets": results,
    }
    if not args.check_only:
        (args.out_dir.parent / "manifest.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        (args.reports_dir / "death-root-offsets.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "fps": FPS,
                    "note": "Offsets are added to the death Root translation Y at each "
                            "exported key; frame 1 and frames >= zeroFromFrame stay at zero.",
                    "zeroFromFrame": args.zero_from_frame,
                    "assets": [
                        {
                            "id": row["id"],
                            "baselineSha256": row["baselineSha256"],
                            "maxOffsetY": row["maxOffsetY"],
                            "keys": row["deathOffsets"],
                        }
                        for row in results
                    ],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContactError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
