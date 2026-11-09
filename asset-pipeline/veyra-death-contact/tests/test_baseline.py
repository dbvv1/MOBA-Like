"""Immutable baseline identity and offline snapshot preparation regressions."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
sys.path.insert(0, str(PACKAGE / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import build_candidates
import check_contact
from glb_contact import ContactError


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        # Fixtures use committed original bytes, never mutable candidate metadata.
        self.original = check_contact.resolve_baseline_dir()
        baseline.verify_baseline(self.original)

    def copy_original(self):
        target = self.root / "snapshot"
        for row in baseline.lock_rows():
            file = target / row["path"]
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.original / row["path"], file)
        return target

    def git_bytes(self, command, **kwargs):
        self.assertEqual(kwargs["env"]["GIT_NO_LAZY_FETCH"], "1")
        self.assertEqual(kwargs["env"]["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(command[:5], ["git", "--no-lazy-fetch", "-C", str(REPO), "show"])
        prefix = f"{baseline.COMMIT}:{baseline.SOURCE}/"
        self.assertTrue(command[5].startswith(prefix))
        raw = (self.original / command[5][len(prefix):]).read_bytes()
        return subprocess.CompletedProcess(command, 0, stdout=raw)

    def test_prepare_exact_bytes_and_repeat_without_git(self):
        target = self.root / "snapshot"
        with patch.object(baseline.subprocess, "run", side_effect=self.git_bytes) as run:
            baseline.prepare_baseline(target)
            self.assertEqual(run.call_count, 5)
        with patch.object(baseline.subprocess, "run", side_effect=AssertionError("must not call Git")):
            baseline.prepare_baseline(target)
        for row in baseline.lock_rows():
            self.assertEqual((target / row["path"]).read_bytes(), (self.original / row["path"]).read_bytes())

    def test_missing_git_commit_has_no_writes(self):
        target = self.root / "new-parent" / "snapshot"
        with patch.object(baseline.subprocess, "run", side_effect=subprocess.CalledProcessError(128, "git")):
            with self.assertRaisesRegex(ContactError, "no fetch attempted"):
                baseline.prepare_baseline(target)
        self.assertFalse(target.parent.exists())

    def test_corrupt_git_blob_has_no_writes(self):
        target = self.root / "new-parent" / "snapshot"
        with patch.object(baseline.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"wrong")):
            with self.assertRaisesRegex(ContactError, "identity mismatch"):
                baseline.prepare_baseline(target)
        self.assertFalse(target.parent.exists())

    def test_every_missing_or_corrupt_file_is_rejected_without_repair(self):
        target = self.copy_original()
        for row in baseline.lock_rows():
            file = target / row["path"]
            raw = file.read_bytes()
            with self.subTest(path=row["path"], mode="missing"):
                file.unlink()
                with self.assertRaisesRegex(ContactError, "missing/unreadable"):
                    baseline.prepare_baseline(target)
                self.assertFalse(file.exists())
            with self.subTest(path=row["path"], mode="corrupt"):
                file.write_bytes(raw[:-1] + bytes([raw[-1] ^ 1]))
                with self.assertRaisesRegex(ContactError, "identity mismatch"):
                    baseline.prepare_baseline(target)
                self.assertNotEqual(file.read_bytes(), raw)
            file.write_bytes(raw)

    def test_corrected_source_export_and_matching_manifest_cannot_be_baseline(self):
        target = self.copy_original()
        manifest = json.loads((target / "manifest.json").read_text())
        candidate = json.loads((PACKAGE / "manifest.json").read_text())
        for row in candidate["assets"]:
            name = row["id"]
            shutil.copyfile(PACKAGE / "source" / f"{name}.blend", target / "source" / f"{name}.blend")
            shutil.copyfile(PACKAGE / "exported" / f"{name}.glb", target / "exported" / f"{name}.glb")
            next(item for item in manifest["assets"] if item["id"] == name)["sha256"] = row["sha256"]
        (target / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ContactError, "identity mismatch"):
            baseline.verify_baseline(target)
        output = self.root / "out"
        with self.assertRaises(ContactError):
            build_candidates.main(["--baseline-dir", str(target), "--out-dir", str(output), "--reports-dir", str(self.root / "reports")])
        self.assertFalse(output.exists())
        self.assertFalse((self.root / "reports").exists())
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(check_contact.main(["--baseline-dir", str(target)]), 2)

    def test_invalid_parent_fails_cleanly_and_preserves_file(self):
        parent = self.root / "file-parent"
        parent.write_text("keep")
        with patch.object(baseline.subprocess, "run", side_effect=self.git_bytes):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(baseline.main(["--baseline-dir", str(parent / "snapshot")]), 2)
        self.assertIn("cannot publish", err.getvalue())
        self.assertEqual(parent.read_text(), "keep")

    def test_cli_missing_snapshot_fails_cleanly(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(baseline.main(["--check-only", "--baseline-dir", str(self.root / "absent")]), 2)
        self.assertIn("ERROR: missing/unreadable", err.getvalue())


if __name__ == "__main__":
    unittest.main()
