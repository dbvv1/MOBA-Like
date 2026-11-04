#!/usr/bin/env python3
"""Acceptance tests for the four in-match UI event cue WAVs.

Run from the repository root:

    python3 -m unittest discover -s asset-pipeline/ui-event-audio -p 'test_*.py'

Only the standard library is used. The tests decode the committed WAVs,
recompute durations/peaks/hashes, check the 5 ms edge guards, prove the four
payloads are distinct, reject incomplete or illegal recipes, and replay the
uniform 0.9 second revision in memory. They do not play audio and cannot judge
whether the cues are distinguishable by ear.
"""

import array
import copy
import hashlib
import math
import tempfile
import unittest
import wave
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import generate  # noqa: E402

RECIPE = generate.load_recipe(HERE / "recipe.json")
CUES = {cue["id"]: cue for cue in RECIPE["cues"]}
BATCH = generate.build_batch(RECIPE)
MANIFEST = generate.build_manifest(RECIPE)


def read_wav(name):
    with wave.open(str(HERE / name), "rb") as wav:
        params = {
            "channels": wav.getnchannels(),
            "sample_width": wav.getsampwidth(),
            "rate": wav.getframerate(),
            "frames": wav.getnframes(),
        }
        samples = array.array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
    return params, samples


def measured_peak_dbfs(samples):
    peak = max(abs(value) for value in samples)
    return 20.0 * math.log10(peak / 32768.0)


def positive_crossing_hz(samples, rate, start_seconds, end_seconds):
    start = int(round(start_seconds * rate))
    end = int(round(end_seconds * rate))
    window = samples[start:end]
    crossings = sum(
        1 for index in range(1, len(window)) if window[index - 1] < 0 <= window[index]
    )
    return crossings / (len(window) / rate)


class CommittedCueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipe = RECIPE
        cls.cues = CUES
        cls.batch = BATCH
        cls.manifest = MANIFEST
        cls.wavs = {cue_id: read_wav(cue["file"]) for cue_id, cue in CUES.items()}

    def test_four_fixed_files_decode_as_48k_mono_pcm16(self):
        self.assertEqual(set(self.cues), set(generate.REQUIRED_IDS))
        self.assertEqual(self.manifest["format"]["fadeSeconds"], 0.005)
        for cue_id, (params, samples) in self.wavs.items():
            with self.subTest(cue=cue_id):
                self.assertEqual(params["channels"], 1)
                self.assertEqual(params["sample_width"], 2)
                self.assertEqual(params["rate"], 48000)
                self.assertEqual(params["frames"], len(samples))
                self.assertGreater(len(samples), 0)

    def test_durations_match_recipe_and_card_budget(self):
        expected = {
            "purchase-ok": 0.22,
            "purchase-denied": 0.22,
            "level-up": 0.55,
            "respawn-ready": 0.5,
        }
        for cue_id, seconds in expected.items():
            with self.subTest(cue=cue_id):
                params, samples = self.wavs[cue_id]
                self.assertEqual(params["frames"], round(seconds * 48000))
                self.assertAlmostEqual(len(samples) / params["rate"], seconds, places=9)
                maximum = 0.25 if cue_id.startswith("purchase-") else 0.6
                self.assertLessEqual(len(samples) / params["rate"], maximum)

    def test_peak_is_below_minus_nine_dbfs(self):
        for cue_id, (_, samples) in self.wavs.items():
            with self.subTest(cue=cue_id):
                dbfs = measured_peak_dbfs(samples)
                self.assertLessEqual(dbfs, -9.0)
                self.assertGreater(dbfs, -9.2)

    def test_edge_fade_spans_five_ms_and_files_start_and_end_at_zero(self):
        # edge_factor itself is linear, but the rendered outer edge is the
        # product of this per-segment guard and the whole-cue guard, so the
        # composite outer envelope is not linear; only its 5 ms span is claimed.
        length, edge = 1000, 10
        self.assertEqual(generate.edge_factor(0, length, edge), 0.0)
        self.assertAlmostEqual(generate.edge_factor(5, length, edge), 0.5)
        self.assertAlmostEqual(generate.edge_factor(9, length, edge), 0.9)
        self.assertEqual(generate.edge_factor(10, length, edge), 1.0)
        self.assertEqual(generate.edge_factor(500, length, edge), 1.0)
        self.assertAlmostEqual(generate.edge_factor(990, length, edge), 0.9)
        self.assertEqual(generate.edge_factor(999, length, edge), 0.0)
        for cue_id, (params, samples) in self.wavs.items():
            with self.subTest(cue=cue_id):
                self.assertEqual(samples[0], 0)
                self.assertEqual(samples[-1], 0)
                edge_samples = int(round(0.0005 * params["rate"]))
                peak = max(abs(value) for value in samples)
                self.assertLessEqual(max(abs(value) for value in samples[:edge_samples]), 0.2 * peak)
                self.assertLessEqual(max(abs(value) for value in samples[-edge_samples:]), 0.2 * peak)

    def test_four_payloads_are_distinct_non_silent_bytes(self):
        hashes = set()
        payloads = set()
        for cue_id, (_, samples) in self.wavs.items():
            with self.subTest(cue=cue_id):
                payload = (HERE / self.cues[cue_id]["file"]).read_bytes()
                payloads.add(payload)
                hashes.add(hashlib.sha256(payload).hexdigest())
                rms = math.sqrt(sum((value / 32768.0) ** 2 for value in samples) / len(samples))
                self.assertGreater(20.0 * math.log10(rms), -30.0)
        self.assertEqual(len(hashes), 4)
        self.assertEqual(len(payloads), 4)

    def test_manifest_matches_committed_files(self):
        rows = {cue["id"]: cue for cue in self.manifest["cues"]}
        self.assertEqual(set(rows), set(self.cues))
        for cue_id, row in rows.items():
            with self.subTest(cue=cue_id):
                payload = (HERE / row["file"]).read_bytes()
                samples = self.wavs[cue_id][1]
                self.assertEqual(row["bytes"], len(payload))
                self.assertEqual(row["sha256"], hashlib.sha256(payload).hexdigest())
                self.assertAlmostEqual(
                    row["durationSeconds"], len(samples) / 48000, places=9
                )
                self.assertAlmostEqual(
                    row["peakDbfs"], measured_peak_dbfs(samples), places=4
                )
                self.assertTrue(row["event"]["committedSource"])
                self.assertTrue(row["event"]["notFrom"])
                self.assertTrue(row["event"]["consumerAccess"])
                self.assertIs(row["event"]["committed"], True)
                self.assertIs(row["event"]["presentationEvent"], False)
        self.assertIn("HUD", self.manifest["triggerPolicy"])
        self.assertIn("committed", self.manifest["triggerPolicy"])

    def test_rebuild_is_byte_identical_and_check_passes(self):
        problems = generate.check_outputs(self.recipe, HERE)
        self.assertEqual(problems, [])
        text = (HERE / "manifest.json").read_text(encoding="utf-8")
        self.assertEqual(text, generate.manifest_text(self.manifest))
        for cue_id, cue in self.cues.items():
            with self.subTest(cue=cue_id):
                self.assertEqual(
                    (HERE / cue["file"]).read_bytes(),
                    self.batch[cue_id]["wav"],
                )

    def test_check_reports_a_corrupted_committed_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            for cue in self.cues.values():
                (target / cue["file"]).write_bytes(self.batch[cue["id"]]["wav"])
            (target / "manifest.json").write_text(
                generate.manifest_text(self.manifest), encoding="utf-8"
            )
            self.assertEqual(generate.check_outputs(self.recipe, target), [])
            (target / "purchase-ok.wav").write_bytes(b"not a wav")
            problems = generate.check_outputs(self.recipe, target)
            self.assertEqual(len(problems), 1)
            self.assertIn("purchase-ok.wav", problems[0])

    def test_second_revision_applies_one_uniform_ratio_and_holds_identity(self):
        first, last = self.manifest["revisions"][0], self.manifest["revisions"][-1]
        self.assertEqual(first["fundamentalRatio"], 1.0)
        self.assertEqual(last["fundamentalRatio"], 0.9)
        first_by_id = {row["id"]: row for row in first["cues"]}
        last_by_id = {row["id"]: row for row in last["cues"]}
        for cue_id in self.cues:
            with self.subTest(cue=cue_id):
                self.assertEqual(
                    first_by_id[cue_id]["durationSeconds"],
                    last_by_id[cue_id]["durationSeconds"],
                )
                self.assertEqual(
                    first_by_id[cue_id]["contour"], last_by_id[cue_id]["contour"]
                )
                self.assertNotEqual(
                    first_by_id[cue_id]["sha256"], last_by_id[cue_id]["sha256"]
                )
                for before, after in zip(
                    first_by_id[cue_id]["segmentFrequenciesHz"],
                    last_by_id[cue_id]["segmentFrequenciesHz"],
                ):
                    for base, scaled in zip(before, after):
                        self.assertAlmostEqual(scaled / base, 0.9, places=4)
        self.assertTrue(self.manifest["revisionResult"]["durationsUnchanged"])
        self.assertTrue(self.manifest["revisionResult"]["eventIdentityUnchanged"])
        self.assertTrue(self.manifest["revisionResult"]["payloadRebuilt"])

    def test_rendered_pitch_drops_by_the_revision_ratio(self):
        base = generate.build_batch(self.recipe, 1.0)
        revised = generate.build_batch(self.recipe, 0.9)
        for cue_id, windows in {
            "purchase-ok": [(0.02, 0.09)],
            "purchase-denied": [(0.02, 0.09)],
            "level-up": [(0.02, 0.15), (0.39, 0.53)],
            "respawn-ready": [(0.1, 0.2), (0.35, 0.45)],
        }.items():
            for start, end in windows:
                with self.subTest(cue=cue_id, window=(start, end)):
                    before = positive_crossing_hz(base[cue_id]["samples"], 48000, start, end)
                    after = positive_crossing_hz(revised[cue_id]["samples"], 48000, start, end)
                    self.assertAlmostEqual(after / before, 0.9, delta=0.03)

    def test_rejects_incomplete_recipe(self):
        mutations = []

        def mutation(label, mutate):
            recipe = copy.deepcopy(self.recipe)
            mutate(recipe)
            mutations.append((label, recipe))

        mutation("missing segments", lambda r: r["cues"][0].pop("segments"))
        mutation(
            "missing segment frequency",
            lambda r: r["cues"][0]["segments"][0].pop("frequencyHz"),
        )
        mutation("missing duration", lambda r: r["cues"][0].pop("durationSeconds"))
        mutation(
            "missing max duration", lambda r: r["cues"][0].pop("maxDurationSeconds")
        )
        mutation("empty partials", lambda r: r["cues"][0]["segments"][0].update(partials=[]))
        mutation(
            "contour mismatch",
            lambda r: r["cues"][1].update(contour="ascending-two-tone"),
        )
        mutation("missing cue id", lambda r: r["cues"][0].pop("id"))
        mutation("duplicate cue id", lambda r: r["cues"][1].update(id=r["cues"][0]["id"]))
        mutation("missing cue", lambda r: r["cues"].pop())
        mutation("unknown current revision", lambda r: r.update(currentRevision="r9"))
        mutation(
            "current revision is not last",
            lambda r: r.update(currentRevision=r["revisions"][0]["label"]),
        )
        mutation("missing revision ratio", lambda r: r["revisions"][0].pop("fundamentalRatio"))
        mutation("missing sample rate", lambda r: r["format"].pop("sampleRate"))
        mutation("non 48k format", lambda r: r["format"].update(sampleRate=44100))
        mutation("stereo format", lambda r: r["format"].update(channels=2))
        mutation("non PCM16 format", lambda r: r["format"].update(encoding="PCM24"))
        mutation("zero fade", lambda r: r["format"].update(fadeSeconds=0))
        mutation(
            "fade under five milliseconds",
            lambda r: r["format"].update(fadeSeconds=0.001),
        )
        mutation("peak above ceiling", lambda r: r["format"].update(peakTargetDbfs=-8.0))
        mutation(
            "relaxed peak budget",
            lambda r: r["format"].update(
                peakCeilingDbfs=-1.0, peakTargetDbfs=-1.1
            ),
        )
        mutation("duration over budget", lambda r: r["cues"][0].update(durationSeconds=0.26))
        mutation("unknown event id", lambda r: r["cues"][0].update(id="menu-click"))
        mutation("missing event", lambda r: r["cues"][0].pop("event"))
        mutation(
            "event missing trigger",
            lambda r: r["cues"][0]["event"].pop("trigger"),
        )
        mutation(
            "event not committed",
            lambda r: r["cues"][0]["event"].update(committed=False),
        )
        mutation(
            "missing audible intent",
            lambda r: r["cues"][0].pop("audibleIntent"),
        )
        for label, recipe in mutations:
            with self.subTest(mutation=label):
                with self.assertRaises(ValueError):
                    generate.validate_recipe(recipe)

    def test_rejects_illegal_frequencies_and_ratios(self):
        format_spec = generate.validate_format(self.recipe["format"])
        base_cue = copy.deepcopy(self.cues["purchase-ok"])
        illegal_frequencies = [0, -440, float("nan"), float("inf"), 24000, 50000]
        for frequency in illegal_frequencies:
            cue = copy.deepcopy(base_cue)
            cue["segments"][0]["frequencyHz"] = frequency
            with self.subTest(field="frequencyHz", value=frequency):
                with self.assertRaises(ValueError):
                    generate.validate_cue(cue, format_spec, 1.0)
        for glide in [0, -1, 24000, float("nan")]:
            cue = copy.deepcopy(self.cues["respawn-ready"])
            cue["segments"][0]["glideToHz"] = glide
            with self.subTest(field="glideToHz", value=glide):
                with self.assertRaises(ValueError):
                    generate.validate_cue(cue, format_spec, 1.0)
        for multiple in [0, -1, 1.5, 100000]:
            cue = copy.deepcopy(base_cue)
            cue["segments"][0]["partials"][0]["multiple"] = multiple
            with self.subTest(field="multiple", value=multiple):
                with self.assertRaises(ValueError):
                    generate.validate_cue(cue, format_spec, 1.0)
        for ratio in [0, -1, float("nan"), float("inf")]:
            with self.subTest(ratio=ratio):
                with self.assertRaises(ValueError):
                    generate.validate_cue(base_cue, format_spec, ratio)
        for ratio in [0, -0.9, float("nan")]:
            recipe = copy.deepcopy(self.recipe)
            recipe["revisions"][0]["fundamentalRatio"] = ratio
            with self.subTest(revision_ratio=ratio):
                with self.assertRaises(ValueError):
                    generate.validate_recipe(recipe)

    def test_rejects_glide_harmonics_past_nyquist_at_every_ratio(self):
        # Regression: validation used to check only the glide start, so a
        # 15000 Hz glide end with a 2x partial passed at both revision ratios
        # even though the partial sweeps to 30000/27000 Hz, past 24000 Hz.
        format_spec = generate.validate_format(self.recipe["format"])
        nyquist = format_spec["sampleRate"] / 2
        ratios = [revision["fundamentalRatio"] for revision in self.recipe["revisions"]]
        self.assertEqual(ratios, [1.0, 0.9])

        past = copy.deepcopy(self.cues["respawn-ready"])
        past["segments"][0]["glideToHz"] = 15000.0
        for ratio in ratios:
            with self.subTest(case="2x glide partial past Nyquist", ratio=ratio):
                with self.assertRaises(ValueError):
                    generate.validate_cue(past, format_spec, ratio)

        # Legal neighbour: the 2x partial stays just below Nyquist.
        adjacent = copy.deepcopy(self.cues["respawn-ready"])
        adjacent["segments"][0]["glideToHz"] = nyquist / 2 - 0.5
        for ratio in ratios:
            with self.subTest(case="adjacent legal", ratio=ratio):
                generate.validate_cue(adjacent, format_spec, ratio)

        # Exact boundary: 12000 Hz * 2x is exactly Nyquist and is rejected.
        boundary = copy.deepcopy(self.cues["respawn-ready"])
        boundary["segments"][0]["glideToHz"] = nyquist / 2
        with self.assertRaises(ValueError):
            generate.validate_cue(boundary, format_spec, 1.0)

        # A revision ratio can itself push the glide harmonic past Nyquist:
        # 11000 * 2x is legal at ratio 1.0 but 11000 * 1.1 * 2x is not.
        ratio_cue = copy.deepcopy(self.cues["respawn-ready"])
        ratio_cue["segments"][0]["glideToHz"] = 11000.0
        generate.validate_cue(ratio_cue, format_spec, 1.0)
        with self.assertRaises(ValueError):
            generate.validate_cue(ratio_cue, format_spec, 1.1)

        # Fixed tones keep the same highest-frequency partial check. The
        # second segment stays above the first, preserving ascending identity.
        fixed = copy.deepcopy(self.cues["purchase-ok"])
        fixed["segments"][1]["frequencyHz"] = nyquist / 2
        with self.assertRaises(ValueError):
            generate.validate_cue(fixed, format_spec, 1.0)

    def test_peak_budget_rejects_relaxation_and_allows_conservative(self):
        def format_with(ceiling, target):
            return {
                "sampleRate": 48000,
                "channels": 1,
                "encoding": "PCM16",
                "fadeSeconds": 0.005,
                "peakCeilingDbfs": ceiling,
                "peakTargetDbfs": target,
            }

        # Default batch values pass.
        generate.validate_format(format_with(-9.0, -9.1))

        # Boundary: exactly -9 dBFS is the least conservative allowed pair.
        generate.validate_format(format_with(-9.0, -9.0))

        # More conservative values pass.
        generate.validate_format(format_with(-12.0, -14.0))
        generate.validate_format(format_with(-30.0, -40.0))

        # Relaxing either bound above -9 dBFS is rejected. The first pair is
        # the reproduced defect: the old validator accepted it and rendered
        # a -1.1004 dBFS peak.
        for ceiling, target in [
            (-1.0, -1.1),
            (-8.0, -9.0),
            (-9.0, -8.0),
            (-8.9999, -9.1),
            (-9.1, -8.9999),
        ]:
            with self.subTest(ceiling=ceiling, target=target):
                with self.assertRaises(ValueError):
                    generate.validate_format(format_with(ceiling, target))

        # Target must still not exceed a conservative ceiling.
        with self.assertRaises(ValueError):
            generate.validate_format(format_with(-12.0, -10.0))

    def test_cli_check_passes(self):
        self.assertEqual(generate.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
