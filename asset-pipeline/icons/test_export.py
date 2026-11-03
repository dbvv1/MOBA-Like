import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
import export


class ExportTest(unittest.TestCase):
    def test_render_and_reproduce(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'out'
            export.export(export.ROOT / 'recipe.json', out)
            second = Path(temp) / 'second'
            export.export(export.ROOT / 'recipe.json', second)
            self.assertEqual(len(list(out.rglob('*.svg'))), 12)
            self.assertEqual(len(list(out.rglob('*.png'))), 25)
            for path in out.rglob('*'):
                if path.is_file():
                    self.assertEqual(path.read_bytes(), (second / path.relative_to(out)).read_bytes())
                    if path.name != 'preview.png':
                        self.assertEqual(path.read_bytes(), (export.ROOT / 'exported' / path.relative_to(out)).read_bytes())
                    else:
                        with Image.open(path) as preview:
                            self.assertEqual(preview.size, (960, 400))
                if path.suffix == '.svg':
                    root = ET.fromstring(path.read_text())
                    self.assertEqual(root.attrib['viewBox'], '0 0 64 64')
                    self.assertEqual((root.attrib['width'], root.attrib['height']), ('64', '64'))
                    self.assertNotIn('<text', path.read_text())
                if path.suffix == '.png' and path.name != 'preview.png':
                    size = int(path.stem.rsplit('-', 1)[1])
                    im = Image.open(path)
                    self.assertEqual(im.size, (size, size))
                    alpha = im.getchannel('A')
                    box = alpha.getbbox()
                    self.assertIsNotNone(box)
                    self.assertGreaterEqual(min(box[:2]), 2)
                    self.assertLessEqual(max(box[2:]), size - 2)
                    self.assertEqual(alpha.getpixel((0, 0)), 0)

    def test_upstream_shield_identity_and_runtime_notice(self):
        source = export.ROOT / 'source' / 'tabler'
        provenance = json.loads((source / 'provenance.json').read_text())
        for name, digest in provenance['files'].items():
            self.assertEqual(hashlib.sha256((source / name).read_bytes()).hexdigest(), digest)
        notice = (source / 'LICENSE.txt').read_text().strip()
        for theme in ['bright', 'dark']:
            self.assertIn(notice, (export.ROOT / 'exported' / theme / 'self-shield.svg').read_text())

    def test_invalid_parameters(self):
        good = json.loads((export.ROOT / 'recipe.json').read_text())
        for key, value in [('stroke_width', 12), ('stroke_width', True), ('ink', 'url(external)'), ('accent', '#xx0000')]:
            bad = copy.deepcopy(good)
            bad['variants']['dark'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                export.validate(bad)
        for bad in ({}, {'sizes': [0], 'variants': {}}, {'sizes': [32, 48], 'variants': {}}):
            with self.assertRaises(ValueError):
                export.validate(bad)

    def test_cli_missing_and_bad_input(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            invalid = temp / 'invalid.json'
            invalid.write_text('{"sizes":[0],"variants":{}}')
            for recipe in (temp / 'missing.json', invalid):
                out = temp / 'not-created'
                result = subprocess.run([sys.executable, str(export.ROOT / 'export.py'), '--recipe', str(recipe), '--output', str(out)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn('export failed:', result.stderr)
                self.assertFalse(out.exists())


class BatchExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.author = self.root / 'authoring'
        shutil.copytree(export.ROOT / 'source', self.author / 'source')
        self.recipe = self.author / 'recipe.json'
        self.recipe.write_bytes((export.ROOT / 'recipe.json').read_bytes())
        patcher = patch.object(export, 'ROOT', self.author)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.out = self.root / 'out'
        export.export(self.recipe, self.out)
        (self.out / 'keep.txt').write_text('consumer note')
        self.before = self.snapshot(self.out)
        self.config = json.loads(self.recipe.read_text())
        self.config['variants']['bright']['accent'] = '#E07B13'
        self.recipe.write_text(json.dumps(self.config))

    @staticmethod
    def snapshot(root):
        return {p.relative_to(root).as_posix(): p.read_bytes()
                for p in root.rglob('*') if p.is_file()}

    def assert_preserved(self):
        self.assertEqual(self.snapshot(self.out), self.before)
        self.assertFalse(list(self.root.glob('.out.export-*')))

    def test_second_edit_replaces_whole_family_and_preserves_notes(self):
        export.export(self.recipe, self.out)
        after = self.snapshot(self.out)
        for name in export.NAMES:
            self.assertNotEqual(after[f'bright/{name}.svg'], self.before[f'bright/{name}.svg'])
            self.assertEqual(after[f'dark/{name}.svg'], self.before[f'dark/{name}.svg'])
        self.assertEqual(after['keep.txt'], self.before['keep.txt'])
        export.export(self.recipe, self.out)
        self.assertEqual(self.snapshot(self.out), after)
        self.assertFalse(list(self.root.glob('.out.export-*')))

    def test_late_missing_and_invalid_source_preserve_previous_family(self):
        last = self.author / 'source' / f'{export.NAMES[-1]}.svg'
        last.unlink()
        with self.assertRaises(FileNotFoundError):
            export.export(self.recipe, self.out)
        self.assert_preserved()
        last.write_text('<svg broken')
        with self.assertRaises(ET.ParseError):
            export.export(self.recipe, self.out)
        self.assert_preserved()

    def test_renderer_failure_and_keyboard_interrupt_preserve_previous_family(self):
        import cairosvg
        original = cairosvg.svg2png
        for error in (OSError('injected render failure'), KeyboardInterrupt()):
            calls = 0
            def render(**kwargs):
                nonlocal calls
                calls += 1
                if calls == 5:
                    raise error
                return original(**kwargs)
            with patch('cairosvg.svg2png', side_effect=render):
                with self.assertRaises(type(error)):
                    export.export(self.recipe, self.out)
            self.assertEqual(calls, 5)
            self.assert_preserved()

    def test_final_preview_failure_preserves_previous_family(self):
        original = Image.Image.save
        def fail_preview(image, fp, *args, **kwargs):
            if isinstance(fp, Path) and fp.name == 'preview.png':
                raise OSError('injected preview failure')
            return original(image, fp, *args, **kwargs)
        with patch.object(Image.Image, 'save', fail_preview):
            with self.assertRaisesRegex(OSError, 'preview failure'):
                export.export(self.recipe, self.out)
        self.assert_preserved()

    def test_first_failure_leaves_no_final_directory(self):
        fresh = self.root / 'fresh'
        (self.author / 'source' / f'{export.NAMES[-1]}.svg').unlink()
        with self.assertRaises(FileNotFoundError):
            export.export(self.recipe, fresh)
        self.assertFalse(fresh.exists())
        self.assertFalse(list(self.root.glob('.fresh.export-*')))

    def test_missing_output_cannot_reuse_previous_file(self):
        real_render = export.render
        def omit_one(config, output):
            real_render(config, output)
            (output / 'dark/control.svg').unlink()
        with patch.object(export, 'render', side_effect=omit_one):
            with self.assertRaisesRegex(RuntimeError, 'missing generated output'):
                export.export(self.recipe, self.out)
        self.assert_preserved()

    def test_failed_directory_publication_restores_old_batch(self):
        original = os.replace
        calls = 0
        def rename(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('injected rename failure')
            return original(source, target)
        with patch('export.os.replace', side_effect=rename):
            with self.assertRaisesRegex(OSError, 'rename failure'):
                export.export(self.recipe, self.out)
        self.assertEqual(calls, 3)
        self.assert_preserved()

    def test_failed_rollback_retains_recovery_and_blocks_retry(self):
        original = os.replace
        calls = 0
        def rename(source, target):
            nonlocal calls
            calls += 1
            if calls >= 2:
                raise OSError('injected rename failure')
            return original(source, target)
        with patch('export.os.replace', side_effect=rename):
            with self.assertRaisesRegex(RuntimeError, 'publication and rollback failed'):
                export.export(self.recipe, self.out)
        self.assertFalse(self.out.exists())
        self.assertEqual(self.snapshot(self.root / '.out.export-backup'), self.before)
        self.assertTrue((self.root / '.out.export-lock').is_dir())
        stages = [p for p in self.root.glob('.out.export-*') if p.name not in
                  ('.out.export-lock', '.out.export-backup')]
        self.assertEqual(len(stages), 1)
        self.assertEqual(len(list(stages[0].rglob('*.svg'))), 12)
        with self.assertRaisesRegex(RuntimeError, 'backup exists'):
            export.export(self.recipe, self.out)

    def test_cleanup_failure_reports_committed_batch_and_preserves_backup(self):
        original = shutil.rmtree
        def remove(path, *args, **kwargs):
            if Path(path).name == '.out.export-backup':
                raise OSError('injected cleanup failure')
            return original(path, *args, **kwargs)
        with patch('export.shutil.rmtree', side_effect=remove):
            with self.assertRaisesRegex(RuntimeError, 'new batch committed.*cleanup failed'):
                export.export(self.recipe, self.out)
        self.assertNotEqual(self.snapshot(self.out)['bright/control.svg'], self.before['bright/control.svg'])
        self.assertEqual(self.snapshot(self.root / '.out.export-backup'), self.before)
        self.assertTrue((self.root / '.out.export-lock').is_dir())

    def test_lock_blocks_second_writer_without_removing_owner_lock(self):
        with export.output_batch(self.out, self.recipe) as stage:
            with self.assertRaisesRegex(RuntimeError, 'export lock exists'):
                export.export(self.recipe, self.out)
            self.assertTrue((self.root / '.out.export-lock').is_dir())
            export.render(self.config, stage)
        self.assertFalse(list(self.root.glob('.out.export-*')))
        (self.root / '.out.export-lock').mkdir()
        with self.assertRaisesRegex(RuntimeError, 'export lock exists'):
            export.export(self.recipe, self.out)
        self.assertTrue((self.root / '.out.export-lock').is_dir())

    def test_authoring_inputs_and_unsafe_targets_are_rejected(self):
        (self.root / 'file').write_text('not an output directory')
        for target in [self.root, self.author, self.author / 'source',
                       self.author / 'source/nested', self.root / 'file',
                       self.root / 'missing/nested']:
            with self.subTest(target=target.name), self.assertRaises(ValueError):
                export.export(self.recipe, target)
        self.assert_preserved()
        link = self.root / 'link'
        link.symlink_to(self.out, target_is_directory=True)
        for target in (link, link / 'nested'):
            with self.assertRaisesRegex(ValueError, 'symlink'):
                export.export(self.recipe, target)
        (self.out / 'link').symlink_to(self.author)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            export.export(self.recipe, self.out)
        self.assertFalse(list(self.root.glob('.out.export-*')))


if __name__ == '__main__':
    unittest.main()
