import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
