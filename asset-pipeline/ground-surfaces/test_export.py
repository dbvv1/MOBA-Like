import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from export import ROOT, export


class ExportTests(unittest.TestCase):
    def test_repeatable_and_source_shape(self):
        before = hashlib.sha256((ROOT/'exported/grass-geometries.json').read_bytes()).hexdigest()
        export()
        self.assertEqual(before, hashlib.sha256((ROOT/'exported/grass-geometries.json').read_bytes()).hexdigest())
        data = json.loads((ROOT/'exported/grass-geometries.json').read_text())
        self.assertEqual([data[k]['triangles'] for k in ['blade','leaf']], [224,144])
        for mesh in data.values():
            self.assertEqual(len(mesh['positions']), len(mesh['normals']))
            self.assertGreater(max(mesh['positions'][1::3]), 0)

    def test_changed_or_missing_source_rejected_before_write(self):
        for mode in ['changed','missing']:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)/'input';shutil.copytree(ROOT,root)
                output = (root/'exported/grass-geometries.json').read_bytes()
                source = root/'source/grass_large.obj'
                if mode == 'changed': source.write_text(source.read_text()+'\n# changed\n')
                else: source.unlink()
                with self.assertRaises((ValueError,FileNotFoundError)): export(root)
                self.assertEqual(output,(root/'exported/grass-geometries.json').read_bytes())


if __name__ == '__main__': unittest.main()
