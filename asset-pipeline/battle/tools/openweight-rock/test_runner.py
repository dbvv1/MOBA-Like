"""CPU-only provenance and contract guards; not a model inference success test."""
import struct
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
