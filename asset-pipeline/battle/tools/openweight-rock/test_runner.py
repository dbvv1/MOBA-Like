"""CPU-only provenance guards; not a model inference success test."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import run_triposg as runner


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
        with self.assertRaises(SystemExit):
            runner.verify_imported_source(root, '/other/triposg/pipeline.py')

    def test_source_head_and_clean_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            def replies(head, status):
                return [SimpleNamespace(stdout=tmp), SimpleNamespace(stdout=head),
                        SimpleNamespace(stdout=status)]
            with patch.object(runner.subprocess, 'run', side_effect=replies(runner.SOURCE_COMMIT, '')):
                self.assertEqual(runner.verify_source_commit(tmp)[1], runner.SOURCE_COMMIT)
            with patch.object(runner.subprocess, 'run', side_effect=replies(runner.SOURCE_COMMIT, ' M triposg/pipeline.py')):
                with self.assertRaisesRegex(SystemExit, 'dirty'):
                    runner.verify_source_commit(tmp)
            with patch.object(runner.subprocess, 'run', side_effect=replies('b' * 40, '')):
                with self.assertRaisesRegex(SystemExit, 'expected'):
                    runner.verify_source_commit(tmp)

    def test_weights_require_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                runner.weights_fingerprint(tmp)
            (Path(tmp) / "model_index.json").write_text("{}")
            with self.assertRaisesRegex(FileNotFoundError, "tensor"):
                runner.weights_fingerprint(tmp)


if __name__ == '__main__':
    unittest.main()
