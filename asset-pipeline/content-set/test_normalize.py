import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest

import normalize as n


class ContentSet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipe = json.loads((n.HERE / "standard-set.json").read_text())

    def test_real_sources_and_determinism(self):
        first = n.build(self.recipe)
        self.assertEqual(first, n.build(self.recipe))
        self.assertEqual(len(first["standards"]), 5)
        self.assertEqual(first["totalReferencedBytes"], 680900)
        self.assertFalse(first["runtimeMutated"])

    def test_actual_clips_and_costs(self):
        files = {x["id"]: x for x in n.build(self.recipe)["files"]}
        self.assertEqual(files["veyra-teal"]["triangles"], 1189)
        self.assertEqual(files["melee-rust"]["skinJointCounts"], [15])
        self.assertAlmostEqual(files["veyra-teal"]["clipsSeconds"]["attack"], 35 / 30, places=5)
        self.assertAlmostEqual(files["melee-rust"]["clipsSeconds"]["death"], 1.0, places=5)

    def test_reject_changed_source(self):
        bad = copy.deepcopy(self.recipe)
        bad["files"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Source changed"):
            n.build(bad)

    def test_reject_budget_and_missing_clip(self):
        for mutation in (lambda r: r["files"][0]["budget"].update(triangles=1),
                         lambda r: r["files"][0]["clips"].append("invented")):
            bad = copy.deepcopy(self.recipe)
            mutation(bad)
            with self.assertRaises(ValueError):
                n.build(bad)

    def test_uniform_second_edit_does_not_rebind(self):
        old = copy.deepcopy(self.recipe["files"][0]["normalization"])
        edited = dict(old, targetNominalHeight=old["sourceNominalHeight"] * 1.08, sourceGroundY=.1)
        self.assertEqual(n.placement(edited)["scale"], [1.08] * 3)
        self.assertAlmostEqual(n.placement(edited)["position"][1], -.108)
        self.assertEqual(self.recipe["files"][0]["normalization"], old)
        with self.assertRaises(ValueError):
            n.placement(dict(old, up="+Z"))

    def test_reject_outside_input_and_bad_container(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                n.checked_path(Path(directory), "../outside")
        for data in (b"", b"not a GLB" * 8, struct.pack("<4sII", b"glTF", 2, 20) + struct.pack("<I4s", 400, b"JSON")):
            with self.assertRaises(ValueError):
                n.read_glb(data)

    def test_all_standard_references_resolve(self):
        ids = {f["id"] for f in self.recipe["files"]}
        for standard in self.recipe["standards"]:
            self.assertLessEqual(set(standard["files"]), ids)


if __name__ == "__main__":
    unittest.main()
