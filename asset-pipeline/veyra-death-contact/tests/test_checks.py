"""CPU checks for the Veyra death contact candidates.

Run from the repository root:

    python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
PACKAGE = HERE.parents[1]
REPO = PACKAGE.parents[1]
sys.path.insert(0, str(PACKAGE / "tools"))
sys.path.insert(0, str(HERE.parent))

import check_contact  # noqa: E402
from check_source_bpy import check_root_keys  # noqa: E402
from glb_contact import (  # noqa: E402
    Asset,
    ContactError,
    root_offsets,
    write_patched_glb,
)

TEAMS = ("teal", "rust")


class BaselineResolutionTests(unittest.TestCase):
    def test_env_override_is_repo_relative_and_optional(self):
        old = os.environ.get("VEYRA_DEATH_BASELINE_DIR")
        try:
            os.environ["VEYRA_DEATH_BASELINE_DIR"] = (
                "asset-pipeline/veyra-death-contact/baseline"
            )
            self.assertEqual(
                check_contact.resolve_baseline_dir(),
                (REPO / "asset-pipeline" / "veyra-death-contact" / "baseline").resolve(),
            )
            os.environ.pop("VEYRA_DEATH_BASELINE_DIR")
            self.assertEqual(
                check_contact.resolve_baseline_dir(),
                PACKAGE / "baseline",
            )
        finally:
            if old is None:
                os.environ.pop("VEYRA_DEATH_BASELINE_DIR", None)
            else:
                os.environ["VEYRA_DEATH_BASELINE_DIR"] = old


class ReproductionTests(unittest.TestCase):
    def test_reported_foot_penetration_is_reproduced(self):
        for team in TEAMS:
            report, _rows = check_contact.reproduce_team(
                team, check_contact.BASELINE_DIR, 0.01
            )
            self.assertTrue(report["reproduced"], report)
            self.assertLessEqual(report["worstFootMinY"], -0.01)
            self.assertEqual(report["worstFootBone"], "Foot_L")
            self.assertEqual(report["samples"], 61)

    def test_missing_baseline_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ContactError):
                Asset(Path(tmp) / "veyra-missing.glb")

    def test_missing_clip_is_an_error(self):
        asset = Asset(
            check_contact.BASELINE_DIR / "exported" / "veyra-teal.glb"
        )
        with self.assertRaises(ContactError):
            asset.find_clip("not-a-clip")


class ThresholdTests(unittest.TestCase):
    def test_invalid_tolerances_are_rejected(self):
        for value in (0.0, -0.001, 0.0200001, 1.0, float("nan"), True):
            with self.assertRaises(ContactError):
                check_contact.validate_tolerance(value)

    def test_zero_penetration_threshold_is_rejected_by_cli(self):
        code = check_contact.main(["--mode", "reproduce", "--penetration", "0"])
        self.assertEqual(code, 2)


class CandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baselines = {
            team: Asset(
                check_contact.BASELINE_DIR / "exported" / f"veyra-{team}.glb"
            )
            for team in TEAMS
        }
        cls.candidates = {
            team: Asset(
                check_contact.CANDIDATE_DIR / "exported" / f"veyra-{team}.glb"
            )
            for team in TEAMS
        }

    def test_candidates_pass_at_default_tolerance(self):
        for team in TEAMS:
            report, _rows = check_contact.verify_team(
                team, check_contact.BASELINE_DIR, check_contact.CANDIDATE_DIR, 0.01
            )
            self.assertTrue(report["passed"], report["errors"])
            self.assertGreaterEqual(report["lowestBodyMinY"], -0.01)
            self.assertLessEqual(report["highestBodyMinY"], 0.02)
            self.assertEqual(report["samples"], 61)

    def test_candidates_pass_at_tight_tolerance(self):
        for team in TEAMS:
            report, _rows = check_contact.verify_team(
                team, check_contact.BASELINE_DIR, check_contact.CANDIDATE_DIR, 0.005
            )
            self.assertTrue(report["passed"], report["errors"])
            self.assertGreaterEqual(report["lowestBodyMinY"], -0.005)
            self.assertGreaterEqual(report["lowestFootMinY"], -0.005)
            self.assertLessEqual(report["highestBodyMinY"], 0.02)

    def test_first_last_poses_are_unchanged(self):
        for team in TEAMS:
            baseline = self.baselines[team]
            candidate = self.candidates[team]
            start, end, _ = candidate.clip_times("death")
            for t in (start, end):
                left = check_contact.flatten(baseline.skinned("death", t))
                right = check_contact.flatten(candidate.skinned("death", t))
                self.assertLessEqual(check_contact.max_delta(left, right), 1e-9)

    def test_only_death_root_translation_y_changed(self):
        for team in TEAMS:
            baseline = self.baselines[team]
            candidate = self.candidates[team]
            base_death = check_contact.channel_map(baseline, "death")
            cand_death = check_contact.channel_map(candidate, "death")
            self.assertEqual(set(base_death), set(cand_death))
            offsets = check_contact.expected_root_offsets(baseline)
            root = ("Root", "translation")
            for key, left in base_death.items():
                if key != root:
                    self.assertEqual(left, cand_death[key], (team, key))
            self.assertEqual(base_death[root]["input"], cand_death[root]["input"])
            changed = 0
            for base, built, offset in zip(
                base_death[root]["output"], cand_death[root]["output"], offsets
            ):
                self.assertAlmostEqual(built[0], base[0], delta=1e-6)
                self.assertAlmostEqual(built[1], base[1] + offset, delta=1e-6)
                self.assertAlmostEqual(built[2], base[2], delta=1e-6)
                if offset != 0.0:
                    changed += 1
            self.assertGreater(changed, 0)

    def test_other_actions_and_materials_are_unchanged(self):
        for team in TEAMS:
            baseline = self.baselines[team]
            candidate = self.candidates[team]
            for clip in check_contact.OTHER_CLIPS:
                self.assertEqual(
                    check_contact.channel_map(baseline, clip),
                    check_contact.channel_map(candidate, clip),
                )
            self.assertEqual(baseline.json["materials"], candidate.json["materials"])
            self.assertEqual(
                check_contact.node_parents(baseline),
                check_contact.node_parents(candidate),
            )
            self.assertEqual(
                set(baseline.joint_names), set(candidate.joint_names)
            )
            self.assertEqual(
                check_contact.joint_inverse_binds(baseline),
                check_contact.joint_inverse_binds(candidate),
            )
            self.assertEqual(
                check_contact.geometry_by_material(baseline),
                check_contact.geometry_by_material(candidate),
            )
            self.assertEqual(
                check_contact.rest_skinned_by_material(baseline),
                check_contact.rest_skinned_by_material(candidate),
            )

    def test_team_colours_are_preserved(self):
        def team_colour(asset):
            for material in asset.json["materials"]:
                if material["name"].startswith(("battle-teal", "battle-rust")):
                    return tuple(material["pbrMetallicRoughness"]["baseColorFactor"])
            raise AssertionError("team material missing")

        teal = team_colour(self.candidates["teal"])
        rust = team_colour(self.candidates["rust"])
        self.assertNotEqual(teal, rust)
        self.assertEqual(
            team_colour(self.candidates["teal"]), team_colour(self.baselines["teal"])
        )
        self.assertEqual(
            team_colour(self.candidates["rust"]), team_colour(self.baselines["rust"])
        )

    def test_offsets_are_zero_on_first_and_tail_frames(self):
        for team in TEAMS:
            offsets, details = root_offsets(self.baselines[team], zero_from_frame=18)
            self.assertEqual(offsets[0], 0.0)
            self.assertTrue(all(offset == 0.0 for offset in offsets[17:]))
            self.assertAlmostEqual(max(offsets), 0.0518, places=4)

    def test_unfixed_baseline_is_rejected(self):
        # Negative control: copying the baseline unchanged must fail the same
        # acceptance, proving the contact check is not vacuous.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "exported"
            out.mkdir()
            baseline = self.baselines["teal"]
            _start, accessor = check_contact.death_accessor_layout(baseline)
            offsets = [0.0] * accessor["count"]
            write_patched_glb(baseline, offsets, out / "veyra-teal.glb")
            report, _rows = check_contact.verify_team(
                "teal", check_contact.BASELINE_DIR, Path(tmp), 0.01
            )
            self.assertFalse(report["passed"])
            self.assertTrue(
                any("body" in error and "frame" in error for error in report["errors"]),
                report["errors"],
            )


class MeshMutationTests(unittest.TestCase):
    def assets(self):
        return (Asset(check_contact.BASELINE_DIR / "exported" / "veyra-teal.glb"),
                Asset(PACKAGE / "exported" / "veyra-teal.glb"))

    def test_changed_normals_are_rejected(self):
        baseline, candidate = self.assets()
        primitive = candidate.json["meshes"][0]["primitives"][0]
        accessor = primitive["attributes"]["NORMAL"]
        candidate.glb._accessor_cache[accessor] = [
            tuple(-value for value in row) for row in candidate.glb.accessor(accessor)
        ]
        errors, _ = check_contact.check_invariants(baseline, candidate)
        self.assertTrue(any("mesh accessor" in error for error in errors), errors)

    def test_changed_bone_binding_is_rejected_even_at_same_rest_position(self):
        baseline, candidate = self.assets()
        primitive = candidate.primitives()[0]
        joints = list(primitive["joints"][0])
        slot = next(i for i, weight in enumerate(primitive["weights"][0]) if weight > 0)
        joints[slot] = (joints[slot] + 1) % len(candidate.joint_names)
        primitive["joints"][0] = tuple(joints)
        # Check the semantic geometry directly: rest-pose coincidence must not
        # hide a reassigned bone in the preserved geometry contract.
        self.assertNotEqual(check_contact.geometry_by_material(baseline),
                            check_contact.geometry_by_material(candidate))
        errors, _ = check_contact.check_invariants(baseline, candidate)
        self.assertTrue(any("mesh accessor" in error for error in errors), errors)


class RootSourceCurveTests(unittest.TestCase):
    def setUp(self):
        self.keys = [[i + 1, 0.0, "LINEAR"] for i in range(31)]
        self.report = json.loads((PACKAGE / "reports" / "death-root-offsets.json").read_text())["assets"][0]["keys"]
        self.built = copy.deepcopy(self.keys)
        for key, row in zip(self.built, self.report):
            key[1] += row["offsetY"]

    def test_expected_root_curve_passes(self):
        self.assertEqual(check_root_keys(self.keys, self.built, self.report), [])

    def test_changed_key_frame_is_rejected(self):
        self.built[9][0] = 10.25
        self.assertTrue(any("frame changed" in error for error in
                            check_root_keys(self.keys, self.built, self.report)))

    def test_changed_key_interpolation_is_rejected(self):
        self.built[9][2] = "CONSTANT"
        self.assertTrue(any("interpolation changed" in error for error in
                            check_root_keys(self.keys, self.built, self.report)))

    def test_extra_matching_source_and_report_keys_are_rejected(self):
        self.built.append([32, 0.0, "LINEAR"])
        self.report.append({"key": 31, "frame": 32, "offsetY": 0.0})
        self.assertTrue(any("key counts" in error for error in
                            check_root_keys(self.keys, self.built, self.report)))


class RuntimeFallbackTests(unittest.TestCase):
    """The patched-GLB fallback keeps the old byte-level guarantee."""

    FALLBACK = PACKAGE / "runtime-fallback"

    @classmethod
    def setUpClass(cls):
        cls.baselines = {
            team: Asset(
                check_contact.BASELINE_DIR / "exported" / f"veyra-{team}.glb"
            )
            for team in TEAMS
        }
        cls.fallbacks = {
            team: Asset(cls.FALLBACK / "exported" / f"veyra-{team}.glb")
            for team in TEAMS
        }

    def test_fallback_diff_is_confined_to_death_root_y(self):
        for team in TEAMS:
            allowed, diff, reason = check_contact.byte_diff_allowed(
                self.baselines[team], self.fallbacks[team]
            )
            self.assertTrue(allowed, reason)
            self.assertTrue(diff["jsonEqual"])
            self.assertGreater(diff["binaryDiffBytes"], 0)

    def test_fallback_passes_both_tolerances(self):
        for tolerance in (0.01, 0.005):
            for team in TEAMS:
                report, _rows = check_contact.verify_team(
                    team, check_contact.BASELINE_DIR, self.FALLBACK, tolerance
                )
                self.assertTrue(report["passed"], report["errors"])


class StructuralTests(unittest.TestCase):
    def test_candidate_containers_are_self_consistent(self):
        for team in TEAMS:
            asset = Asset(
                check_contact.CANDIDATE_DIR / "exported" / f"veyra-{team}.glb"
            )
            # Every accessor must be readable inside the embedded binary chunk.
            for index in range(len(asset.json["accessors"])):
                asset.glb.accessor(index)
            clips = [animation.get("name") for animation in asset.json["animations"]]
            self.assertEqual(sorted(clips), ["attack", "death", "hurt", "idle", "walk"])
            for animation in asset.json["animations"]:
                for channel in animation["channels"]:
                    self.assertIn(channel["target"]["node"], range(len(asset.nodes)))
                    self.assertIn(
                        channel["target"]["path"], ("translation", "rotation", "scale")
                    )
                    sampler = animation["samplers"][channel["sampler"]]
                    inputs = [row[0] for row in asset.glb.accessor(sampler["input"])]
                    outputs = asset.glb.accessor(sampler["output"])
                    self.assertEqual(len(inputs), len(outputs))
                    self.assertEqual(inputs, sorted(inputs))
            for joint in asset.joint_nodes:
                self.assertIn(joint, range(len(asset.nodes)))

    def test_bind_pose_skinning_matches_raw_positions(self):
        # Independent invariant for the CPU evaluator: with rest transforms,
        # world * inverseBind must reproduce the authored POSITION values.
        for team in TEAMS:
            asset = Asset(
                check_contact.CANDIDATE_DIR / "exported" / f"veyra-{team}.glb"
            )
            skinned = asset.rest_skinned()
            for part, primitive in zip(skinned, asset.primitives()):
                delta = check_contact.max_delta(part, primitive["positions"])
                self.assertLess(delta, 1e-5)


class ManifestTests(unittest.TestCase):
    def test_manifest_records_produced_editable_source(self):
        manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["kind"], "source-rebuilt-candidate")
        self.assertEqual(manifest["editableSource"]["status"], "produced")
        self.assertEqual(len(manifest["assets"]), 2)
        for asset in manifest["assets"]:
            self.assertTrue((REPO / asset["source"]).is_file(), asset["source"])
            self.assertTrue((REPO / asset["file"]).is_file(), asset["file"])

    def test_source_and_candidate_hashes_match_the_manifest(self):
        import hashlib

        manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
        for asset in manifest["assets"]:
            source = REPO / asset["source"]
            upstream = REPO / asset["upstreamSource"]
            candidate = REPO / asset["file"]
            self.assertEqual(
                hashlib.sha256(upstream.read_bytes()).hexdigest(),
                asset["upstreamSourceSha256"],
            )
            self.assertEqual(
                hashlib.sha256(source.read_bytes()).hexdigest(),
                asset["sourceSha256"],
            )
            self.assertEqual(
                hashlib.sha256(candidate.read_bytes()).hexdigest(),
                asset["sha256"],
            )
            self.assertEqual(candidate.stat().st_size, asset["bytes"])

    def test_runtime_fallback_manifest_is_marked_superseded(self):
        manifest = json.loads(
            (PACKAGE / "runtime-fallback" / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["kind"], "runtime-fallback")
        self.assertEqual(manifest["editableSource"]["status"], "superseded")
        self.assertEqual(len(manifest["assets"]), 2)

    def test_baseline_hashes_match_the_upstream_manifest(self):
        import hashlib

        upstream = json.loads(
            (check_contact.BASELINE_DIR / "manifest.json").read_text(encoding="utf-8")
        )
        expected = {row["id"]: row["sha256"] for row in upstream["assets"]}
        for team in TEAMS:
            path = (
                check_contact.BASELINE_DIR / "exported" / f"veyra-{team}.glb"
            )
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(actual, expected[f"veyra-{team}"])

    def test_offsets_report_matches_candidate_keys(self):
        report = json.loads(
            (PACKAGE / "reports" / "death-root-offsets.json").read_text(encoding="utf-8")
        )
        self.assertEqual(len(report["assets"]), 2)
        for asset in report["assets"]:
            self.assertEqual(len(asset["keys"]), 31)
            self.assertEqual(asset["keys"][0]["frame"], 1)
            self.assertEqual(asset["keys"][0]["offsetY"], 0.0)
            self.assertTrue(all(key["offsetY"] == 0.0 for key in asset["keys"][17:]))
            self.assertEqual(asset["keys"][17]["frame"], 18)
            self.assertEqual(asset["keys"][-1]["frame"], 31)

    def test_rebuilt_glb_root_keys_are_baseline_plus_offsets(self):
        report = json.loads(
            (PACKAGE / "reports" / "death-root-offsets.json").read_text(encoding="utf-8")
        )
        self.assertEqual([row["id"] for row in report["assets"]],
                         [f"veyra-{team}" for team in TEAMS])
        root = ("Root", "translation")
        for team, report_asset in zip(TEAMS, report["assets"]):
            baseline = Asset(
                check_contact.BASELINE_DIR / "exported" / f"veyra-{team}.glb"
            )
            candidate = Asset(PACKAGE / "exported" / f"veyra-{team}.glb")
            base_keys = check_contact.channel_map(baseline, "death")[root]["output"]
            built_keys = check_contact.channel_map(candidate, "death")[root]["output"]
            self.assertEqual(len(base_keys), len(report_asset["keys"]))
            for index, (key_row, base, built) in enumerate(
                zip(report_asset["keys"], base_keys, built_keys)
            ):
                self.assertEqual(key_row["key"], index)
                self.assertAlmostEqual(
                    built[1], base[1] + key_row["offsetY"], delta=1e-6
                )


class AdoptionDocTests(unittest.TestCase):
    """The adoption instructions are a deliverable; keep them consistent with the files.

    Adoption itself is out of scope for this card, so these tests cannot run the
    adoption.  They do catch the two ways the instructions went stale: wrong
    manifest hashes for the candidates and a missing or out-of-date heroes-recipe
    ``sharedAssets`` pin in step 3.
    """

    @classmethod
    def setUpClass(cls):
        cls.readme = (PACKAGE / "README.md").read_text(encoding="utf-8")
        cls.adoption = cls.readme.split("## Adoption", 1)[1]

    def test_adoption_table_matches_delivered_glbs(self):
        manifest = json.loads((PACKAGE / "manifest.json").read_text(encoding="utf-8"))
        expected = {row["id"]: row for row in manifest["assets"]}
        rows = re.findall(
            r"^\|\s*`(veyra-(?:teal|rust))`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*(\d+)\s*\|$",
            self.adoption,
            flags=re.MULTILINE,
        )
        self.assertEqual({team for team, _sha, _size in rows}, set(expected))
        for team, sha, size in rows:
            asset = expected[team]
            path = REPO / asset["file"]
            self.assertEqual(sha, hashlib.sha256(path.read_bytes()).hexdigest(), team)
            self.assertEqual(int(size), path.stat().st_size, team)
            self.assertEqual(sha, asset["sha256"], team)
            self.assertEqual(int(size), asset["bytes"], team)

    def test_heroes_recipe_scripts_are_pinned_whenever_adoption_mentions_them(self):
        # The recipe scripts are themselves sharedAssets.  Whenever the
        # adoption instruction text points at one of them before step 3 (step 2
        # does, both to warn against rerunning them and for the optional port),
        # step 3 must carry that script's current pin, or a reader who edits it
        # copies a stale value.  Compare with default-source-manifest.json so a
        # pin that is missing, malformed or out of date fails here.
        before, after = self.adoption.split("### 3.", 1)
        step3 = after.split("### 4.", 1)[0]
        shared = {
            entry["path"]: entry["sha256"]
            for entry in json.loads(
                (REPO / "default-source-manifest.json").read_text(encoding="utf-8")
            )["sharedAssets"]
        }
        for script in ("build.py", "retarget.py"):
            path = f"asset-pipeline/heroes/veyra-release/tools/{script}"
            if path not in before:
                continue
            match = re.search(
                re.escape(path) + r".{0,200}?`([0-9a-f]{64})`", step3, re.DOTALL
            )
            self.assertIsNotNone(match, f"step 3 does not list a pin after {path}")
            self.assertIn(path, shared, f"{path} is not a pinned sharedAsset")
            self.assertEqual(match.group(1), shared[path], path)


if __name__ == "__main__":
    unittest.main()
