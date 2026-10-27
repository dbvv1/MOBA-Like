"""CPU-only provenance and contract guards; not a model inference success test."""
import struct
import builtins
import hashlib
import os
import sys
import subprocess
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import run_triposg as runner
import run_triposr as triposr
import postprocess

try:  # The GLB contract checks read real exports; they need the task venv.
    import trimesh  # noqa: F401
    from PIL import Image  # noqa: F401
    TASK_VENV_DEPS = True
except ModuleNotFoundError:
    TASK_VENV_DEPS = False

requires_task_venv = unittest.skipUnless(
    TASK_VENV_DEPS,
    "needs the task venv (trimesh/Pillow); system Python cannot read exported GLBs",
)


def synthetic_rgba(width, height, alpha_fn):
    pixels = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            pixels[i:i + 3] = b"\x80\x60\x40"
            pixels[i + 3] = alpha_fn(x, y)
    return pixels


class RunnerGuards(unittest.TestCase):
    def test_revision_requires_exact_commit(self):
        for bad in ('', 'main', 'abc', 'g' * 40):
            with self.assertRaises(ValueError):
                runner.validate_revision(bad)
        runner.validate_revision('a' * 40)

    def test_output_preserves_previous_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = runner.create_output(Path(tmp) / 'out')
            (out / 'raw.glb').write_bytes(b'previous')
            with self.assertRaises(FileExistsError):
                runner.create_output(out)
            self.assertEqual((out / 'raw.glb').read_bytes(), b'previous')

    def test_import_must_come_from_verified_checkout(self):
        root = Path('/verified').resolve()
        runner.verify_imported_source(root, root / 'triposg/pipelines/pipeline_triposg.py')
        runner.verify_imported_source(root, root / 'tsr/system.py', package_dir='tsr')
        with self.assertRaises(SystemExit):
            runner.verify_imported_source(root, '/other/triposg/pipeline.py')
        with self.assertRaises(SystemExit):
            runner.verify_imported_source(root, root / 'triposg/system.py', package_dir='tsr')

    def test_source_head_and_clean_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            def replies(head, status):
                return [tmp.encode(), head.encode(), status.encode()]
            with patch.object(runner, '_git', side_effect=replies(runner.SOURCE_COMMIT, '')):
                self.assertEqual(runner.verify_source_commit(tmp)[1], runner.SOURCE_COMMIT)
            with patch.object(runner, '_git', side_effect=replies(runner.SOURCE_COMMIT, ' M triposg/pipeline.py')):
                with self.assertRaisesRegex(SystemExit, 'dirty'):
                    runner.verify_source_commit(tmp)
            with patch.object(runner, '_git', side_effect=replies('b' * 40, '')):
                with self.assertRaisesRegex(SystemExit, 'expected'):
                    runner.verify_source_commit(tmp)

    def test_weights_require_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                runner.weights_fingerprint(tmp)
            (Path(tmp) / "model_index.json").write_text("{}")
            with self.assertRaisesRegex(FileNotFoundError, "tensor"):
                runner.weights_fingerprint(tmp)

    def test_weights_fingerprint_includes_nested_configs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "model_index.json").write_text("{}")
            (root / "transformer").mkdir()
            (root / "transformer" / "config.json").write_text('{"depth": 1}')
            (root / "transformer" / "model.safetensors").write_bytes(b"tensors")
            (root / "vae").mkdir()
            (root / "vae" / "config.json").write_text('{"depth": 2}')
            files = runner.weights_fingerprint(root)["files"]
            paths = [row["path"] for row in files]
            self.assertIn("model_index.json", paths)
            self.assertIn("transformer/config.json", paths)
            self.assertIn("vae/config.json", paths)
            self.assertIn("transformer/model.safetensors", paths)
            self.assertEqual(len(files), 4)

    def test_package_versions_mark_missing(self):
        versions = runner.package_versions(("not-a-real-distribution-xyz",))
        self.assertEqual(versions, {"not-a-real-distribution-xyz": None})


class NonFlashGuards(unittest.TestCase):
    def test_reviewed_patch_hash(self):
        self.assertEqual(
            runner.read_recorded_patch(runner.NONFLASH_PATCH),
            runner.NONFLASH_PATCH_SHA256,
        )

    def test_rejects_unreviewed_patch(self):
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'other.patch'
            other.write_bytes(b'not the reviewed change')
            with self.assertRaisesRegex(SystemExit, 'SHA-256'):
                runner.read_recorded_patch(other)

    def test_no_diso_guard(self):
        runner.assert_no_diso_import({})
        with self.assertRaisesRegex(SystemExit, 'diso'):
            runner.assert_no_diso_import({"diso": object()})

    def _replies(self, tmp, head, status, diff):
        def side_effect(top, *args):
            if args[:2] == ("rev-parse", "--show-toplevel"):
                return tmp.encode()
            if args[:2] == ("rev-parse", "HEAD"):
                return head.encode()
            if args and args[0] == "status":
                return status
            if args and args[0] == "diff":
                return diff
            raise AssertionError(args)
        return side_effect

    def test_patched_tree_must_equal_reviewed_patch(self):
        patch_bytes = runner.NONFLASH_PATCH.read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            side_effect = self._replies(tmp, runner.SOURCE_COMMIT,
                                        b" M triposg/inference_utils.py\n", patch_bytes)
            with patch.object(runner, '_git', side_effect=side_effect):
                root, head, digest = runner.verify_source_commit(
                    tmp, runner.SOURCE_COMMIT, runner.NONFLASH_PATCH)
                self.assertEqual(digest, runner.NONFLASH_PATCH_SHA256)
            side_effect = self._replies(tmp, runner.SOURCE_COMMIT,
                                        b" M triposg/inference_utils.py\n",
                                        b"different diff")
            with patch.object(runner, '_git', side_effect=side_effect):
                with self.assertRaisesRegex(SystemExit, 'does not match'):
                    runner.verify_source_commit(tmp, runner.SOURCE_COMMIT, runner.NONFLASH_PATCH)
            side_effect = self._replies(tmp, runner.SOURCE_COMMIT,
                                        b"?? notes.txt\n", patch_bytes)
            with patch.object(runner, '_git', side_effect=side_effect):
                with self.assertRaisesRegex(SystemExit, 'untracked'):
                    runner.verify_source_commit(tmp, runner.SOURCE_COMMIT, runner.NONFLASH_PATCH)


class TripoSRGuards(unittest.TestCase):
    def test_gray_background_contract(self):
        width = height = 64
        rgba = synthetic_rgba(width, height, lambda x, y: 255 if 16 <= x < 48 and 16 <= y < 48 else 0)
        out_w, out_h, rgb = triposr.gray_background_rgb(width, height, rgba, (16, 16, 47, 47))
        self.assertEqual(len(rgb), out_w * out_h * 3)
        self.assertGreater(out_w, 32)
        # Foreground is centred and padded to the upstream 0.85 ratio.
        core = (out_h // 2 * out_w + out_w // 2) * 3
        self.assertNotEqual(tuple(rgb[core:core + 3]), (128, 128, 128))
        for corner in (0, (out_w - 1) * 3, (out_h - 1) * out_w * 3,
                       (out_w * out_h - 1) * 3):
            self.assertEqual(tuple(rgb[corner:corner + 3]), (128, 128, 128))

    def test_gray_png_has_no_alpha_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "gray.png"
            width = height = 32
            rgba = synthetic_rgba(width, height, lambda x, y: 255 if 8 <= x < 24 and 8 <= y < 24 else 0)
            from png_rgba import write_rgb_png
            write_rgb_png(out, 4, 3, bytes([128]) * (4 * 3 * 3))
            data = out.read_bytes()
            self.assertEqual(data[12:16], b"IHDR")
            depth, colour = data[24], data[25]
            self.assertEqual((depth, colour), (8, 2))
            from png_rgba import _chunks
            self.assertEqual([kind for kind, _ in _chunks(data)], [b"IHDR", b"IDAT", b"IEND"])

    def test_rembg_guard(self):
        triposr.assert_no_rembg_import({})
        with self.assertRaisesRegex(SystemExit, 'rembg'):
            triposr.assert_no_rembg_import({"rembg": object()})
        with self.assertRaisesRegex(SystemExit, 'xatlas'):
            triposr.assert_no_rembg_import({"tsr.bake_texture": object()})

    def test_weights_require_config_and_ckpt(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                triposr.weights_fingerprint(tmp, index_name="config.yaml",
                                            tensor_suffixes=(".ckpt",))
            (Path(tmp) / "config.yaml").write_text("{}")
            with self.assertRaisesRegex(FileNotFoundError, "tensor"):
                triposr.weights_fingerprint(tmp, index_name="config.yaml",
                                            tensor_suffixes=(".ckpt",))
            (Path(tmp) / "model.ckpt").write_bytes(b"weights")
            fp = triposr.weights_fingerprint(tmp, index_name="config.yaml",
                                             tensor_suffixes=(".ckpt",))
            self.assertEqual([row["path"] for row in fp["files"]],
                             ["config.yaml", "model.ckpt"])


class TripoSROfflineGuards(unittest.TestCase):
    """Local-file and real-Git contracts only; never import TSR or fake a model."""

    def test_bundled_dino_identity(self):
        path, identity = triposr.verify_dino_config(triposr.DINO_CONFIG)
        self.assertEqual(path.stat().st_size, 454)
        self.assertEqual(identity["revision"], triposr.DINO_REVISION)
        self.assertEqual(identity["sha256"], triposr.DINO_CONFIG_SHA256)
        self.assertEqual(identity["license"], "Apache-2.0")
        self.assertNotIn(str(path.parent), str(identity))

    def test_missing_or_changed_dino_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            with self.assertRaisesRegex(SystemExit, "missing"):
                triposr.verify_dino_config(path)
            path.write_bytes(triposr.DINO_CONFIG.read_bytes().replace(b'768', b'769'))
            with self.assertRaisesRegex(SystemExit, "SHA-256"):
                triposr.verify_dino_config(path)
            path.write_text('{}')
            with self.assertRaisesRegex(SystemExit, "size/SHA-256"):
                triposr.verify_dino_config(path)

    def test_missing_dino_fails_before_imports_output_or_source_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "output"
            def no_import(name, *args, **kwargs):
                if name in ("torch", "numpy", "PIL", "tsr.system"):
                    raise AssertionError("heavy import before input guards")
                return original_import(name, *args, **kwargs)
            original_import = builtins.__import__
            with patch.object(builtins, '__import__', side_effect=no_import):
                with patch.object(triposr, '_source_git', side_effect=AssertionError("source touched")):
                    with self.assertRaisesRegex(SystemExit, "DINO config is missing"):
                        triposr.main(["--weights", tmp, "--revision", triposr.WEIGHTS_REVISION,
                                      "--source-dir", tmp, "--image", "unused.png",
                                      "--dino-config", str(Path(tmp) / "missing.json"),
                                      "--out-dir", str(out)])
            self.assertFalse(out.exists())

    def test_reviewed_patch_digest_and_only_two_paths(self):
        data = triposr.OFFLINE_PATCH.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), triposr.OFFLINE_PATCH_SHA256)
        paths = [line.split()[2][2:] for line in data.decode().splitlines()
                 if line.startswith('diff --git ')]
        self.assertEqual(set(paths), set(triposr.PATCHED_FILES))
        self.assertEqual(len(paths), 2)
        added = '\n'.join(line[1:] for line in data.decode().splitlines()
                          if line.startswith('+') and not line.startswith('+++'))
        self.assertNotIn('hf_hub_download', added)
        self.assertIn('from_json_file(os.environ["TRIPOSR_DINO_CONFIG"])', added)
        self.assertIn('        import rembg', added)

    def test_module_paths_and_namespace_are_bound_to_checkout(self):
        # Path/hash contract on simple metadata objects, not a TSR import.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'tsr').mkdir()
            utils = root / 'tsr/utils.py'
            utils.write_text('# synthetic metadata fixture\n')
            modules = {
                'tsr': SimpleNamespace(__path__=[str(root / 'tsr')]),
                'tsr.system': SimpleNamespace(__file__=str(root / 'tsr/system.py')),
                'tsr.utils': SimpleNamespace(__file__=str(utils)),
            }
            hashes = {'tsr/utils.py': {'sha256': hashlib.sha256(utils.read_bytes()).hexdigest()}}
            with patch.object(triposr, 'PATCHED_FILES', hashes):
                triposr.verify_triposr_imports(root, modules)
                modules['tsr'].__path__.append(str(root / 'other'))
                with self.assertRaisesRegex(SystemExit, 'outside'):
                    triposr.verify_triposr_imports(root, modules)
                modules['tsr'].__path__.pop()
                modules['tsr.system'].__file__ = str(root / 'tsr/not-system.py')
                with self.assertRaisesRegex(SystemExit, 'identity mismatch'):
                    triposr.verify_triposr_imports(root, modules)

    def test_optional_library_submodule_is_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'rembg'):
            triposr.assert_no_rembg_import({'rembg.sessions': object()})

    @patch.object(triposr, 'WEIGHTS_CONFIG_BYTES', 2)
    @patch.object(triposr, 'WEIGHTS_CONFIG_SHA256', hashlib.sha256(b'{}').hexdigest())
    def test_weight_identity_requires_pinned_revision_and_exact_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(SystemExit, 'revision must be'):
                triposr.verify_triposr_weights(root, 'b' * 40)
            with self.assertRaisesRegex(SystemExit, 'config.yaml missing'):
                triposr.verify_triposr_weights(root, triposr.WEIGHTS_REVISION)
            (root / 'config.yaml').write_text('{}')
            (root / 'other.ckpt').write_bytes(b'not a model')
            with self.assertRaisesRegex(SystemExit, 'model.ckpt missing'):
                triposr.verify_triposr_weights(root, triposr.WEIGHTS_REVISION)
            (root / 'model.ckpt').write_bytes(b'not a model')
            with self.assertRaisesRegex(SystemExit, 'size does not match'):
                triposr.verify_triposr_weights(root, triposr.WEIGHTS_REVISION)

    def test_triposr_config_hash_rejected_before_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'config.yaml'
            config.write_bytes(b'x' * triposr.WEIGHTS_CONFIG_BYTES)
            with self.assertRaisesRegex(SystemExit, 'config.yaml size/SHA-256'):
                triposr.verify_triposr_weights(tmp, triposr.WEIGHTS_REVISION)

    @patch.object(triposr, 'WEIGHTS_CONFIG_BYTES', 2)
    @patch.object(triposr, 'WEIGHTS_CONFIG_SHA256', hashlib.sha256(b'{}').hexdigest())
    def test_checkpoint_hash_guard_with_small_file_not_model_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'config.yaml').write_text('{}')
            (root / 'model.ckpt').write_bytes(b'small synthetic fixture')
            with patch.object(triposr, 'CHECKPOINT_BYTES', len(b'small synthetic fixture')):
                with self.assertRaisesRegex(SystemExit, 'SHA-256 does not match'):
                    triposr.verify_triposr_weights(root, triposr.WEIGHTS_REVISION)


class TripoSRRealGitGuards(unittest.TestCase):
    """Synthetic Git repository, not a clone and not an import/inference test."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.files = {}
        self.git('init', '-q')
        self.git('config', 'core.autocrlf', 'false')
        for i, name in enumerate(triposr.PATCHED_FILES):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            before, after = f'old_{i}\n'.encode(), f'reviewed_{i}\n'.encode()
            path.write_bytes(before)
            self.files[name] = {
                'baseSha256': hashlib.sha256(before).hexdigest(),
                'sha256': hashlib.sha256(after).hexdigest(),
            }
        (self.root / 'untouched.py').write_text('keep = True\n')
        (self.root / '_offline_probe.py').write_text('value = 42\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=noreply@example.com',
                 'commit', '-qm', 'Small synthetic source fixture')
        self.head = self.git('rev-parse', 'HEAD').decode().strip()
        for i, name in enumerate(self.files):
            (self.root / name).write_bytes(f'reviewed_{i}\n'.encode())

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args],
                              check=True, capture_output=True).stdout

    def verify(self):
        return triposr._verify_patched_tree(self.root, self.head, self.files)

    def test_exact_two_file_patch_accepted_and_identity_returned(self):
        self.assertEqual(self.verify(), (self.root.resolve(), self.head))

    def test_two_fresh_process_imports_do_not_dirty_source(self):
        # A real tiny module, not a TSR stub. Fresh processes prevent an
        # in-memory import cache from hiding a second-run bytecode regression.
        script = """
import importlib
import sys
from pathlib import Path
# Avoid unrelated runner bytecode during this test's setup; reset before the
# production helper so -B / ambient environment cannot make it pass by itself.
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import run_triposr as runner
sys.dont_write_bytecode = False
assert sys.pycache_prefix is None
runner.configure_offline_runtime(Path(sys.argv[2]), runner.DINO_CONFIG)
assert sys.dont_write_bytecode is True
assert importlib.import_module('_offline_probe').value == 42
"""
        env = os.environ.copy()
        env.pop('PYTHONDONTWRITEBYTECODE', None)
        env.pop('PYTHONPYCACHEPREFIX', None)
        for attempt in range(2):
            with self.subTest(attempt=attempt + 1):
                subprocess.run([sys.executable, '-c', script,
                                str(Path(triposr.__file__).parent), str(self.root)],
                               check=True, capture_output=True, env=env)
                self.assertEqual(self.verify(), (self.root.resolve(), self.head))
                self.assertFalse(list(self.root.rglob('__pycache__')))
                self.assertFalse(list(self.root.rglob('*.pyc')))

    def test_wrong_source_commit_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'expected'):
            triposr._verify_patched_tree(self.root, 'a' * 40, self.files)
        # The production entry point cannot accept this synthetic HEAD.
        with self.assertRaisesRegex(SystemExit, 'expected'):
            triposr.verify_triposr_source(self.root)

    def test_missing_one_patch_rejected(self):
        self.git('checkout', '--', 'tsr/utils.py')
        with self.assertRaisesRegex(SystemExit, 'dirty paths'):
            self.verify()

    def test_same_paths_different_bytes_rejected(self):
        (self.root / 'tsr/utils.py').write_text('unreviewed = True\n')
        with self.assertRaisesRegex(SystemExit, 'patched source SHA-256'):
            self.verify()

    def test_unrelated_tracked_dirty_rejected(self):
        (self.root / 'untouched.py').write_text('changed = True\n')
        with self.assertRaisesRegex(SystemExit, 'dirty paths'):
            self.verify()

    def test_untracked_file_rejected(self):
        (self.root / 'extra.py').write_text('unexpected = True\n')
        with self.assertRaisesRegex(SystemExit, 'untracked'):
            self.verify()

    def test_ignored_source_addition_rejected(self):
        for name in ('tsr/extra.py', 'tsr/extra.pyc', 'torch.py'):
            with self.subTest(name=name):
                (self.root / '.git/info/exclude').write_text(name + '\n')
                path = self.root / name
                path.write_bytes(b'hidden fixture; never imported')
                with self.assertRaisesRegex(SystemExit, 'untracked/ignored'):
                    self.verify()
                path.unlink()

    def test_staged_patch_rejected(self):
        self.git('add', 'tsr/utils.py')
        with self.assertRaisesRegex(SystemExit, 'staged changes'):
            self.verify()

    def test_skip_worktree_or_assume_unchanged_rejected(self):
        for flag in ('--skip-worktree', '--assume-unchanged'):
            self.git('update-index', flag, 'untouched.py')
            with self.assertRaisesRegex(SystemExit, 'unsupported'):
                self.verify()
            self.git('update-index', flag.replace('--', '--no-', 1), 'untouched.py')

    def test_changed_base_bytes_rejected(self):
        self.files['tsr/utils.py']['baseSha256'] = '0' * 64
        with self.assertRaisesRegex(SystemExit, 'base SHA-256'):
            self.verify()

    def test_linked_patch_file_rejected(self):
        target = self.root / 'tsr/utils.py'
        target.unlink()
        target.symlink_to(self.root / 'untouched.py')
        with self.assertRaisesRegex(SystemExit, 'missing or linked|dirty paths'):
            self.verify()

    def test_wrong_source_fails_main_before_heavy_imports_or_output(self):
        out = self.root / 'output'
        original_import = builtins.__import__
        def no_import(name, *args, **kwargs):
            if name in ('torch', 'numpy', 'PIL', 'tsr.system'):
                raise AssertionError('heavy import before source guard')
            return original_import(name, *args, **kwargs)
        with patch.object(builtins, '__import__', side_effect=no_import):
            with self.assertRaisesRegex(SystemExit, 'expected'):
                triposr.main(['--weights', str(self.root), '--revision', triposr.WEIGHTS_REVISION,
                              '--source-dir', str(self.root), '--image', 'unused.png',
                              '--out-dir', str(out)])
        self.assertFalse(out.exists())


class PostprocessContract(unittest.TestCase):
    def test_ground_scale_and_all_vertex_radius(self):
        # Lowest point at y=-2, 4 m tall, 3 m wide in x and 1 m in z.
        verts = [(-1.5, -2.0, -0.5), (1.5, -2.0, 0.5), (0.0, 2.0, 0.0)]
        moved, scale = postprocess.ground_and_scale(verts, 1.1)
        self.assertAlmostEqual(scale, 1.1 / 4.0)
        metrics = postprocess.mesh_metrics(moved)
        self.assertAlmostEqual(metrics["min"][1], 0.0)
        self.assertAlmostEqual(metrics["height"], 1.1)
        self.assertAlmostEqual(metrics["maxRadius"], (1.5 ** 2 + 0.5 ** 2) ** 0.5 * 1.1 / 4.0)
        postprocess.validate_contract(metrics, 1200, 1)

    def test_contract_rejects_radius_budget(self):
        verts = [(-2.5, 0.0, 0.0), (2.5, 2.0, 0.0), (0.0, 2.0, 0.0)]
        moved, _ = postprocess.ground_and_scale(verts, 1.1)
        metrics = postprocess.mesh_metrics(moved)
        with self.assertRaisesRegex(ValueError, 'max radius'):
            postprocess.validate_contract(metrics, 100, 1)

    def test_contract_rejects_triangle_and_size_budget(self):
        verts = [(-0.5, 0.0, -0.5), (0.5, 0.0, 0.5), (0.0, 1.0, 0.0)]
        moved, _ = postprocess.ground_and_scale(verts, 1.1)
        metrics = postprocess.mesh_metrics(moved)
        with self.assertRaisesRegex(ValueError, 'triangles'):
            postprocess.validate_contract(metrics, 2001, 1)
        with self.assertRaisesRegex(ValueError, 'GLB'):
            postprocess.validate_contract(metrics, 100, 1, glb_bytes=600 * 1024)

    @requires_task_venv
    def test_exported_texture_is_rejected_by_measured_glb(self):
        import numpy as np
        import trimesh
        from PIL import Image
        from trimesh.visual.texture import TextureVisuals

        metrics = {"min": [0.0, 0.0, 0.0], "max": [1.0, 1.1, 1.0],
                   "height": 1.1, "maxRadius": 0.5}
        with tempfile.TemporaryDirectory() as tmp:
            mesh = trimesh.creation.box()
            mesh.visual = TextureVisuals(
                uv=np.zeros((len(mesh.vertices), 2)),
                image=Image.new("RGB", (4, 4), (255, 0, 0)),
            )
            path = Path(tmp) / "textured.glb"
            mesh.export(path)
            state = postprocess.inspect_glb(path)
            self.assertEqual(state["materials"], 1)
            self.assertGreater(state["textures"], 0)
            self.assertGreater(state["images"], 0)
            with self.assertRaisesRegex(ValueError, 'texture'):
                postprocess.validate_contract(
                    metrics, 100, state["materials"],
                    textures=state["textures"], images=state["images"],
                    alpha_modes=state["alphaModes"],
                )

    @requires_task_venv
    def test_exported_material_count_comes_from_glb(self):
        import trimesh
        from trimesh.visual.material import PBRMaterial
        from trimesh.visual.texture import TextureVisuals

        metrics = {"min": [0.0, 0.0, 0.0], "max": [1.0, 1.1, 1.0],
                   "height": 1.1, "maxRadius": 0.5}
        with tempfile.TemporaryDirectory() as tmp:
            scene = trimesh.Scene()
            for index in range(3):
                box = trimesh.creation.box()
                box.visual = TextureVisuals(material=PBRMaterial(
                    name=f"material-{index}", baseColorFactor=[1.0, 0.0, 0.0, 1.0]))
                scene.add_geometry(box)
            path = Path(tmp) / "three-materials.glb"
            scene.export(path)
            state = postprocess.inspect_glb(path)
            self.assertEqual(state["materials"], 3)
            with self.assertRaisesRegex(ValueError, 'materials'):
                postprocess.validate_contract(
                    metrics, 100, state["materials"],
                    textures=state["textures"], images=state["images"],
                    alpha_modes=state["alphaModes"],
                )
        with self.assertRaisesRegex(ValueError, 'alphaMode'):
            postprocess.validate_contract(metrics, 100, 1, alpha_modes=["BLEND"])


if __name__ == '__main__':
    unittest.main()
