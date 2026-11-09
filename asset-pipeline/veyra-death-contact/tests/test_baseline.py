"""Immutable baseline identity and offline snapshot preparation regressions."""
import ast
import os
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


class DefaultRecipeTests(unittest.TestCase):
    def test_all_consumers_select_snapshot_without_importing_bpy(self):
        # Execute the actual resolver bodies from both bpy and CPU consumers,
        # without importing Blender or running its module-level build code.
        with patch.dict(os.environ, {}, clear=True):
            for relative, name in (
                ("tools/build_candidates.py", "resolve_baseline_dir"),
                ("tools/build_source_candidates.py", "resolve_baseline_root"),
                ("tests/check_contact.py", "resolve_baseline_dir"),
                ("tests/check_source_bpy.py", "resolve_baseline_root"),
            ):
                tree = ast.parse((PACKAGE / relative).read_text())
                imports = [node for node in tree.body if isinstance(node, ast.ImportFrom)
                           and node.module == "baseline"]
                resolver = next(node for node in tree.body
                                if isinstance(node, ast.FunctionDef) and node.name == name)
                namespace = {"Path": Path}
                exec(compile(ast.Module(body=imports + [resolver], type_ignores=[]),
                             relative, "exec"), namespace)
                self.assertEqual(namespace[name](), PACKAGE / "baseline", relative)
            os.environ["VEYRA_DEATH_BASELINE_DIR"] = "another/snapshot"
            self.assertEqual(baseline.resolve_baseline_dir(), (REPO / "another/snapshot").resolve())
            os.environ["VEYRA_DEATH_BASELINE_DIR"] = str(PACKAGE / "baseline")
            self.assertEqual(baseline.resolve_baseline_dir(), PACKAGE / "baseline")

    def test_default_checks_ignore_replaced_heroes_and_missing_snapshot_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "asset-pipeline/veyra-death-contact"
            shutil.copytree(PACKAGE, package, ignore=shutil.ignore_patterns("__pycache__"))
            # Simulate adoption: mutable heroes now contains corrected files.
            heroes = root / "asset-pipeline/heroes/veyra-release"
            for folder in ("source", "exported"):
                shutil.copytree(package / folder, heroes / folder)
            shutil.copyfile(package / "manifest.json", heroes / "manifest.json")
            env = {k: v for k, v in os.environ.items() if k != "VEYRA_DEATH_BASELINE_DIR"}
            command = [sys.executable, str(package / "tests/check_contact.py"), "--mode", "reproduce"]
            result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            shutil.rmtree(package / "baseline")
            # Even with a heroes directory present, no fallback or auto-preparation.
            result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("missing/unreadable baseline", result.stderr)
            self.assertFalse((package / "baseline").exists())
            output = root / "new-outputs"
            result = subprocess.run(
                [sys.executable, str(package / "tools/build_candidates.py"),
                 "--out-dir", str(output), "--reports-dir", str(root / "new-reports")],
                cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertFalse(output.exists())
            self.assertFalse((root / "new-reports").exists())

    def test_provenance_uses_independent_snapshot_and_unchanged_original_hashes(self):
        pins = {row["path"]: row for row in baseline.lock_rows()}
        prefix = "asset-pipeline/veyra-death-contact/baseline"
        for name in ("manifest.json", "runtime-fallback/manifest.json"):
            manifest = json.loads((PACKAGE / name).read_text())
            self.assertEqual(manifest["basis"]["source"], prefix)
            self.assertEqual(manifest["basis"]["manifestSha256"], pins["manifest.json"]["sha256"])
            for row in manifest["assets"]:
                export = f"exported/{row['id']}.glb"
                self.assertEqual(row["baseline"], f"{prefix}/{export}")
                self.assertEqual(row["baselineSha256"], pins[export]["sha256"])
                if "upstreamSource" in row:
                    source = f"source/{row['id']}.blend"
                    self.assertEqual(row["upstreamSource"], f"{prefix}/{source}")
                    self.assertEqual(row["upstreamSourceSha256"], pins[source]["sha256"])


if __name__ == "__main__":
    unittest.main()
