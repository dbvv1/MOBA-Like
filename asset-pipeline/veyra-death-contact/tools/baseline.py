"""Verify the original Veyra bytes or prepare a snapshot from local Git only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from glb_contact import ContactError

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
COMMIT = "b489ed38592dc184fffe2ab9b3b186441c7dc9bb"
SOURCE = "asset-pipeline/heroes/veyra-release"
FILES = {"manifest.json"} | {
    f"{folder}/veyra-{team}.{ext}"
    for folder, ext in (("source", "blend"), ("exported", "glb"))
    for team in ("teal", "rust")
}


def resolve_baseline_dir() -> Path:
    """Select the prepared snapshot, never the mutable heroes release.

    Selection does not prepare or fetch files. Consumers verify all five pins
    before use. An explicit environment override may select another exact copy;
    relative values resolve from the repository root.
    """
    override = os.environ.get("VEYRA_DEATH_BASELINE_DIR")
    if not override:
        return PACKAGE / "baseline"
    path = Path(override)
    return path if path.is_absolute() else (REPO / path).resolve()


def lock_rows():
    try:
        lock = json.loads((PACKAGE / "baseline-lock.json").read_text(encoding="utf-8"))
        rows = lock["files"]
        if (lock["schemaVersion"] != 1 or lock["commit"] != COMMIT
                or lock["source"] != SOURCE or len(rows) != len(FILES)
                or {row["path"] for row in rows} != FILES):
            raise ValueError("unexpected baseline identity or file set")
        for row in rows:
            if (len(row["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in row["sha256"])
                    or type(row["bytes"]) is not int or row["bytes"] <= 0):
                raise ValueError("invalid baseline hash or size")
        return rows
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ContactError(f"invalid baseline-lock.json: {exc}") from exc


def verify_bytes(raw, row):
    if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
        raise ContactError(f"baseline identity mismatch: {row['path']} (requires {COMMIT})")


def verify_baseline(root: Path):
    """Check all five files, including source and manifest, against a separate lock."""
    for row in lock_rows():
        try:
            raw = (root / row["path"]).read_bytes()
        except OSError as exc:
            raise ContactError(f"missing/unreadable baseline file: {row['path']}") from exc
        verify_bytes(raw, row)
    return root


def prepare_baseline(destination: Path, repo: Path = REPO):
    """Never fetch or overwrite. Validate all Git bytes before publishing a directory."""
    if destination.exists() or destination.is_symlink():
        return verify_baseline(destination)
    payload = []
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_NO_LAZY_FETCH="1", GIT_NO_REPLACE_OBJECTS="1", GIT_TERMINAL_PROMPT="0")
    for row in lock_rows():
        try:
            result = subprocess.run(
                ["git", "--no-lazy-fetch", "-C", str(repo), "show", f"{COMMIT}:{SOURCE}/{row['path']}"],
                env=env, capture_output=True, check=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ContactError(f"original baseline unavailable in local Git: {COMMIT}; no fetch attempted") from exc
        verify_bytes(result.stdout, row)
        payload.append((row["path"], result.stdout))
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".veyra-baseline-", dir=destination.parent) as tmp:
            stage = Path(tmp) / "snapshot"
            stage.mkdir()
            for name, raw in payload:
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            verify_baseline(stage)
            if destination.exists() or destination.is_symlink():
                raise ContactError("baseline destination appeared during preparation; refusing overwrite")
            stage.rename(destination)
    except OSError as exc:
        raise ContactError("cannot publish baseline snapshot; destination was not replaced") from exc
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, default=PACKAGE / "baseline")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args(argv)
    root = args.baseline_dir
    if not root.is_absolute():
        root = REPO / root
    try:
        (verify_baseline if args.check_only else prepare_baseline)(root)
    except ContactError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Verified original Veyra baseline {COMMIT}: 5 files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
