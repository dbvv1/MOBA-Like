"""Offline rights/identity/embedded-texture checks, not visual quality tests."""
import hashlib
import json
from pathlib import Path
import sys
import unittest
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
from normalize import geometry_summary, read_glb


def digest(data):
    return hashlib.sha256(data).hexdigest()


class SiegeSource(unittest.TestCase):
    def test_source_locks_and_license_wording(self):
        p = json.loads((HERE / 'source/provenance.json').read_text())
        for row in p['kenney']['files']:
            self.assertEqual(digest((HERE / 'source' / row['path']).read_bytes()), row['sha256'])
        for row in p['kaykit']['files']:
            self.assertEqual(digest((REPO / row['path']).read_bytes()), row['sha256'])
        raw = zipfile.ZipFile(HERE / 'source/original-license-bytes.zip').read('License.txt')
        record = next(x for x in p['kenney']['files'] if x['archiveMember'] == 'License.txt')
        self.assertEqual(digest(raw), record['originalSha256'])
        self.assertEqual(raw.decode().split(), (HERE / 'source/LICENSE-Kenney.txt').read_text().split())
        self.assertIn('CC0', raw.decode())

    def test_actual_kaykit_nodes_not_whole_tower(self):
        for team in ('green', 'red'):
            p = REPO / f'asset-pipeline/battle/source/kaykit/buildings/{team}/building_tower_catapult_{team}.gltf'
            j = json.loads(p.read_text())
            self.assertEqual({n['name'] for n in j['nodes']},
                             {f'building_tower_catapult_{team}', f'catapult_turret_{team}', f'catapult_arm_{team}'})
            self.assertIn('children', next(n for n in j['nodes'] if n['name'] == f'catapult_turret_{team}'))

    def test_runtime_cost_and_exact_embedded_atlases(self):
        expected_images = {digest((HERE / 'source/kenney/Textures/colormap.png').read_bytes()),
                           digest((REPO / 'asset-pipeline/battle/source/kaykit/buildings/red/hexagons_medieval.png').read_bytes())}
        m = json.loads((HERE / 'manifest.json').read_text())
        for a in m['assets']:
            data = (HERE / a['file']).read_bytes()
            self.assertEqual(digest(data), a['sha256'])
            summary = geometry_summary(data)
            self.assertEqual(summary['triangles'], 1884)
            self.assertLessEqual(a['staticChassisHorizontalRadius'], .701)
            bounds = a['staticChassisBoundsBlender']
            self.assertLessEqual(bounds['max'][1] - bounds['min'][1], 1.002)
            self.assertEqual(summary['skinJointCounts'], [6])
            self.assertEqual(summary['materials'], 3)
            self.assertLess(len(data), 250000)
            j, binary = read_glb(data)
            embedded = set()
            for image in j['images']:
                self.assertNotIn('uri', image)
                view = j['bufferViews'][image['bufferView']]
                start = view.get('byteOffset', 0)
                embedded.add(digest(binary[start:start + view['byteLength']]))
            self.assertEqual(embedded, expected_images)
            self.assertEqual(len(summary['clipsSeconds']), 9)


if __name__ == '__main__':
    unittest.main()
