#!/usr/bin/env python3
"""Deterministic waveform generator for the four in-match UI event cues.

The recipe is the single source of truth: durations, tone order, partials,
envelope edges, peak budget and the committed-event mapping. Rendering uses
only the Python standard library, with no random source, sample library,
model, network access or system clock. Running the command again on the same
interpreter/libm rebuilds the same bytes.

    python3 asset-pipeline/ui-event-audio/generate.py
    python3 asset-pipeline/ui-event-audio/generate.py --check

Outputs stay inside this directory: four mono 48 kHz PCM16 WAV files plus
manifest.json. No runtime or audio device is touched.
"""

import argparse
import array
import hashlib
import io
import json
import math
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECIPE_PATH = ROOT / "recipe.json"
MANIFEST_NAME = "manifest.json"

REQUIRED_IDS = ("purchase-ok", "purchase-denied", "level-up", "respawn-ready")
REQUIRED_MAX_SECONDS = {
    "purchase-ok": 0.25,
    "purchase-denied": 0.25,
    "level-up": 0.6,
    "respawn-ready": 0.6,
}
ALLOWED_CONTOURS = {
    "ascending-two-tone",
    "descending-two-tone",
    "ascending-three-tone",
    "descending-three-tone",
    "rising-sweep",
}


def _mapping(value, path):
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def _list(value, path):
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    return value


def _number(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path} must be a number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{path} must be finite")
    return value


def _positive(value, path):
    value = _number(value, path)
    if value <= 0:
        raise ValueError(f"{path} must be greater than zero")
    return value


def _text(value, path):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value


def _require(mapping, key, path):
    if key not in mapping:
        raise ValueError(f"{path}.{key} is required")
    return mapping[key]


def edge_factor(index, length, edge_samples):
    """Linear 5 ms attack/release guard; both outer samples are exactly zero."""
    if edge_samples <= 0:
        return 1.0
    if index < edge_samples:
        return index / edge_samples
    remaining = length - 1 - index
    if remaining < edge_samples:
        return remaining / edge_samples
    return 1.0


def cue_contour(cue):
    segments = cue["segments"]
    if len(segments) == 1:
        segment = segments[0]
        start = segment["frequencyHz"]
        end = segment.get("glideToHz", start)
        if end > start * 1.02:
            return "rising-sweep"
        if end < start * 0.98:
            return "falling-sweep"
        return "single-tone"
    frequencies = []
    for segment in segments:
        if "glideToHz" in segment and not math.isclose(
            segment["glideToHz"], segment["frequencyHz"], rel_tol=1e-9
        ):
            raise ValueError("multi-tone cues cannot glide between segments")
        frequencies.append(segment["frequencyHz"])
    if len(frequencies) == 2:
        if frequencies[1] > frequencies[0]:
            return "ascending-two-tone"
        if frequencies[1] < frequencies[0]:
            return "descending-two-tone"
    if len(frequencies) == 3:
        if frequencies[0] < frequencies[1] < frequencies[2]:
            return "ascending-three-tone"
        if frequencies[0] > frequencies[1] > frequencies[2]:
            return "descending-three-tone"
    raise ValueError("cue segments do not form a recognized two- or three-tone contour")


def validate_format(format_spec, rate_override=None):
    format_spec = _mapping(format_spec, "format")
    rate = _number(_require(format_spec, "sampleRate", "format"), "format.sampleRate")
    if rate_override is not None:
        rate = _number(rate_override, "format.sampleRate override")
    if rate != round(rate) or rate != 48000:
        raise ValueError("format.sampleRate must be 48000 for this batch")
    channels = _require(format_spec, "channels", "format")
    if channels != 1:
        raise ValueError("format.channels must be 1 (mono)")
    if _require(format_spec, "encoding", "format") != "PCM16":
        raise ValueError("format.encoding must be PCM16")
    fade = _positive(_require(format_spec, "fadeSeconds", "format"), "format.fadeSeconds")
    if fade < 0.005 - 1e-12:
        raise ValueError("format.fadeSeconds must be at least the required 5 ms")
    ceiling = _number(
        _require(format_spec, "peakCeilingDbfs", "format"), "format.peakCeilingDbfs"
    )
    target = _number(
        _require(format_spec, "peakTargetDbfs", "format"), "format.peakTargetDbfs"
    )
    if ceiling >= 0 or target >= 0:
        raise ValueError("peak dBFS values must be negative")
    if target > ceiling:
        raise ValueError("format.peakTargetDbfs must not exceed the ceiling")
    return {
        "sampleRate": int(rate),
        "channels": 1,
        "encoding": "PCM16",
        "fadeSeconds": fade,
        "peakCeilingDbfs": ceiling,
        "peakTargetDbfs": target,
    }


def validate_cue(cue, format_spec, ratio=1.0):
    cue = _mapping(cue, "cue")
    cue_id = _text(_require(cue, "id", "cue"), "cue.id")
    if cue_id not in REQUIRED_IDS:
        raise ValueError(f"cue.id {cue_id!r} is not one of the four fixed event ids")
    file_name = _text(_require(cue, "file", "cue"), f"cue[{cue_id}].file")
    if not file_name.endswith(".wav") or "/" in file_name or "\\" in file_name:
        raise ValueError(f"cue[{cue_id}].file must be a local .wav name")
    if file_name != f"{cue_id}.wav":
        raise ValueError(f"cue[{cue_id}].file must match the cue id")
    duration = _positive(
        _require(cue, "durationSeconds", "cue"), f"cue[{cue_id}].durationSeconds"
    )
    max_duration = _positive(
        _require(cue, "maxDurationSeconds", "cue"),
        f"cue[{cue_id}].maxDurationSeconds",
    )
    if duration > max_duration + 1e-9:
        raise ValueError(f"cue[{cue_id}] exceeds its declared maximum duration")
    if duration > REQUIRED_MAX_SECONDS[cue_id] + 1e-9:
        raise ValueError(f"cue[{cue_id}] exceeds the card duration budget")
    if 2 * format_spec["fadeSeconds"] >= duration:
        raise ValueError(f"cue[{cue_id}] is too short for both 5 ms edge fades")
    contour = _text(_require(cue, "contour", "cue"), f"cue[{cue_id}].contour")
    if contour not in ALLOWED_CONTOURS:
        raise ValueError(f"cue[{cue_id}].contour is not a recognized event identity")
    segments = _list(_require(cue, "segments", "cue"), f"cue[{cue_id}].segments")
    if not segments:
        raise ValueError(f"cue[{cue_id}].segments must not be empty")
    rate = format_spec["sampleRate"]
    nyquist = rate / 2
    ratio = _positive(ratio, "fundamental ratio")
    previous_start = -1.0
    for index, segment in enumerate(segments):
        path = f"cue[{cue_id}].segments[{index}]"
        segment = _mapping(segment, path)
        start = _number(_require(segment, "startSeconds", path), f"{path}.startSeconds")
        if start < 0:
            raise ValueError(f"{path}.startSeconds must not be negative")
        if start < previous_start:
            raise ValueError(f"{path}.startSeconds must be non-decreasing")
        previous_start = start
        segment_duration = _positive(
            _require(segment, "durationSeconds", path), f"{path}.durationSeconds"
        )
        if 2 * format_spec["fadeSeconds"] >= segment_duration:
            raise ValueError(f"{path}.durationSeconds is too short for both 5 ms fades")
        if start + segment_duration > duration + 1e-9:
            raise ValueError(f"{path} extends beyond the cue duration")
        frequency = _positive(
            _require(segment, "frequencyHz", path), f"{path}.frequencyHz"
        )
        frequency *= ratio
        if frequency >= nyquist:
            raise ValueError(f"{path}.frequencyHz must stay below Nyquist")
        glide_to = segment.get("glideToHz")
        if glide_to is not None:
            glide_to = _positive(glide_to, f"{path}.glideToHz") * ratio
            if glide_to >= nyquist:
                raise ValueError(f"{path}.glideToHz must stay below Nyquist")
        _positive(_require(segment, "gain", path), f"{path}.gain")
        partials = _list(_require(segment, "partials", path), f"{path}.partials")
        if not partials:
            raise ValueError(f"{path}.partials must not be empty")
        for partial_index, partial in enumerate(partials):
            partial_path = f"{path}.partials[{partial_index}]"
            partial = _mapping(partial, partial_path)
            multiple = _require(partial, "multiple", partial_path)
            if isinstance(multiple, bool) or not isinstance(multiple, int) or multiple < 1:
                raise ValueError(f"{partial_path}.multiple must be a positive integer")
            _positive(
                _require(partial, "amplitude", partial_path),
                f"{partial_path}.amplitude",
            )
            if frequency * multiple >= nyquist:
                raise ValueError(f"{partial_path} harmonic reaches Nyquist")
    computed = cue_contour(cue)
    if computed != contour:
        raise ValueError(
            f"cue[{cue_id}].contour {contour!r} does not match its segments ({computed!r})"
        )
    return cue


def validate_event(cue, cue_id):
    event = _mapping(_require(cue, "event", "cue"), f"cue[{cue_id}].event")
    for field in ("label", "trigger", "committedSource", "consumerAccess", "notFrom", "boundaries"):
        _text(_require(event, field, f"cue[{cue_id}].event"), f"cue[{cue_id}].event.{field}")
    if event.get("committed") is not True:
        raise ValueError(f"cue[{cue_id}].event.committed must be true")
    if not isinstance(event.get("presentationEvent"), bool):
        raise ValueError(f"cue[{cue_id}].event.presentationEvent must be a boolean")
    _text(_require(cue, "audibleIntent", "cue"), f"cue[{cue_id}].audibleIntent")
    return event


def validate_recipe(recipe):
    recipe = _mapping(recipe, "recipe")
    format_spec = validate_format(_require(recipe, "format", "recipe"))
    revisions = _list(_require(recipe, "revisions", "recipe"), "recipe.revisions")
    if not revisions:
        raise ValueError("recipe.revisions must not be empty")
    labels = set()
    ratios = []
    for index, revision in enumerate(revisions):
        path = f"recipe.revisions[{index}]"
        revision = _mapping(revision, path)
        label = _text(_require(revision, "label", path), f"{path}.label")
        if label in labels:
            raise ValueError(f"{path}.label is duplicated")
        labels.add(label)
        ratios.append(_positive(_require(revision, "fundamentalRatio", path), f"{path}.fundamentalRatio"))
    current_label = _text(_require(recipe, "currentRevision", "recipe"), "recipe.currentRevision")
    if current_label not in labels:
        raise ValueError("recipe.currentRevision must name a declared revision")
    if current_label != revisions[-1]["label"]:
        raise ValueError("recipe.currentRevision must be the last declared revision")
    cues = _list(_require(recipe, "cues", "recipe"), "recipe.cues")
    if not cues:
        raise ValueError("recipe.cues must not be empty")
    ids = set()
    files = set()
    for cue in cues:
        cue = _mapping(cue, "cue")
        cue_id = _text(_require(cue, "id", "cue"), "cue.id")
        file_name = _text(_require(cue, "file", "cue"), "cue.file")
        if cue_id in ids:
            raise ValueError(f"cue.id {cue_id!r} is duplicated")
        if file_name in files:
            raise ValueError(f"cue file {file_name!r} is duplicated")
        ids.add(cue_id)
        files.add(file_name)
        validate_event(cue, cue_id)
        for risk in ratios:
            validate_cue(cue, format_spec, risk)
    if set(REQUIRED_IDS) != ids:
        raise ValueError(
            "recipe must define exactly these cue ids: " + ", ".join(REQUIRED_IDS)
        )
    return recipe, format_spec, ratios


def current_revision(recipe):
    for revision in recipe["revisions"]:
        if revision["label"] == recipe["currentRevision"]:
            return revision
    raise ValueError("current revision is missing")


def _render_segment(segment, rate, edge_samples, ratio):
    count = int(round(segment["durationSeconds"] * rate))
    if count <= 0:
        raise ValueError("segment duration rounds to zero samples")
    start_frequency = segment["frequencyHz"] * ratio
    end_frequency = segment.get("glideToHz", segment["frequencyHz"]) * ratio
    duration = count / rate
    glide = (end_frequency - start_frequency) / duration if duration > 0 else 0.0
    gain = segment["gain"]
    partials = [(p["multiple"], p["amplitude"]) for p in segment["partials"]]
    data = [0.0] * count
    for index in range(count):
        t = index / rate
        cycles = start_frequency * t + 0.5 * glide * t * t
        phase = 2.0 * math.pi * cycles
        value = 0.0
        for multiple, amplitude in partials:
            value += amplitude * math.sin(phase * multiple)
        data[index] = value * gain * edge_factor(index, count, edge_samples)
    return data


def render_samples(cue, format_spec, ratio):
    """Render one cue to quantized int16 samples plus measurement fields."""
    validate_cue(cue, format_spec, ratio)
    rate = format_spec["sampleRate"]
    edge_samples = int(round(format_spec["fadeSeconds"] * rate))
    total = int(round(cue["durationSeconds"] * rate))
    if total <= 0:
        raise ValueError("cue duration rounds to zero samples")
    mix = [0.0] * total
    for segment in cue["segments"]:
        start = int(round(segment["startSeconds"] * rate))
        rendered = _render_segment(segment, rate, edge_samples, ratio)
        for offset, value in enumerate(rendered):
            index = start + offset
            if index >= total:
                raise ValueError("segment rendering exceeds the cue buffer")
            mix[index] += value
    for index in range(total):
        mix[index] *= edge_factor(index, total, edge_samples)
    peak = max(abs(value) for value in mix)
    if peak <= 1e-12:
        raise ValueError("cue rendered silent")
    target = 10.0 ** (format_spec["peakTargetDbfs"] / 20.0)
    scale = target / peak
    quantized = []
    for value in mix:
        sample = int(math.floor(value * scale * 32767.0 + 0.5))
        if sample > 32767:
            sample = 32767
        elif sample < -32768:
            sample = -32768
        quantized.append(sample)
    peak_int = max(abs(value) for value in quantized)
    if peak_int == 0:
        raise ValueError("cue quantized to silence")
    peak_dbfs = 20.0 * math.log10(peak_int / 32768.0)
    if peak_dbfs > format_spec["peakCeilingDbfs"] + 1e-9:
        raise ValueError(
            f"quantized peak {peak_dbfs:.6f} dBFS exceeds the {format_spec['peakCeilingDbfs']} dBFS ceiling"
        )
    rms = math.sqrt(sum((value / 32768.0) ** 2 for value in quantized) / len(quantized))
    rms_dbfs = 20.0 * math.log10(rms) if rms > 0 else float("-inf")
    frequencies = []
    for segment in cue["segments"]:
        row = [segment["frequencyHz"] * ratio]
        if "glideToHz" in segment:
            row.append(segment["glideToHz"] * ratio)
        frequencies.append([round(value, 4) for value in row])
    return {
        "samples": quantized,
        "durationSeconds": total / rate,
        "peakDbfs": peak_dbfs,
        "rmsDbfs": rms_dbfs,
        "segmentFrequenciesHz": frequencies,
        "contour": cue_contour(cue),
    }


def wav_bytes(samples, rate):
    if array.array("h").itemsize != 2:
        raise RuntimeError("this platform does not provide 16-bit signed short samples")
    buffer = io.BytesIO()
    samples_array = array.array("h", samples)
    if sys.byteorder != "little":
        samples_array.byteswap()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.setnframes(len(samples))
        wav.writeframes(samples_array.tobytes())
    return buffer.getvalue()


def build_cue(cue, format_spec, ratio):
    rendered = render_samples(cue, format_spec, ratio)
    payload = wav_bytes(rendered["samples"], format_spec["sampleRate"])
    return {
        **rendered,
        "wav": payload,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def build_batch(recipe, ratio=None):
    recipe, format_spec, _ = validate_recipe(recipe)
    if ratio is None:
        ratio = current_revision(recipe)["fundamentalRatio"]
    return {
        cue["id"]: build_cue(cue, format_spec, ratio)
        for cue in recipe["cues"]
    }


def _revision_rows(recipe):
    rows = []
    for revision in recipe["revisions"]:
        ratio = revision["fundamentalRatio"]
        batch = build_batch(recipe, ratio)
        rows.append(
            {
                "label": revision["label"],
                "fundamentalRatio": ratio,
                "change": revision.get("change", ""),
                "cues": [
                    {
                        "id": cue["id"],
                        "durationSeconds": batch[cue["id"]]["durationSeconds"],
                        "peakDbfs": round(batch[cue["id"]]["peakDbfs"], 4),
                        "sha256": batch[cue["id"]]["sha256"],
                        "contour": batch[cue["id"]]["contour"],
                        "segmentFrequenciesHz": batch[cue["id"]]["segmentFrequenciesHz"],
                    }
                    for cue in recipe["cues"]
                ],
            }
        )
    return rows


def build_manifest(recipe):
    recipe, format_spec, _ = validate_recipe(recipe)
    current = current_revision(recipe)
    ratio = current["fundamentalRatio"]
    batch = build_batch(recipe, ratio)
    revisions = _revision_rows(recipe)
    first = revisions[0]
    last = revisions[-1]
    first_by_id = {row["id"]: row for row in first["cues"]}
    last_by_id = {row["id"]: row for row in last["cues"]}
    cue_rows = []
    for cue in recipe["cues"]:
        audio = batch[cue["id"]]
        cue_rows.append(
            {
                "id": cue["id"],
                "file": cue["file"],
                "durationSeconds": audio["durationSeconds"],
                "bytes": audio["bytes"],
                "sha256": audio["sha256"],
                "peakDbfs": round(audio["peakDbfs"], 4),
                "rmsDbfs": round(audio["rmsDbfs"], 4),
                "contour": audio["contour"],
                "segmentFrequenciesHz": audio["segmentFrequenciesHz"],
                "audibleIntent": cue.get("audibleIntent", ""),
                "event": cue["event"],
            }
        )
    manifest = {
        "schema": 1,
        "batch": recipe["batch"],
        "revision": {
            "label": current["label"],
            "fundamentalRatio": ratio,
            "change": current.get("change", ""),
        },
        "format": {
            "sampleRate": format_spec["sampleRate"],
            "channels": 1,
            "encoding": "PCM16",
            "fadeSeconds": format_spec["fadeSeconds"],
            "peakCeilingDbfs": format_spec["peakCeilingDbfs"],
            "peakTargetDbfs": format_spec["peakTargetDbfs"],
        },
        "source": "Original deterministic Python waveform synthesis in generate.py; no samples, models, network, randomness, system clock or third-party audio.",
        "triggerPolicy": recipe["triggerPolicy"],
        "cues": cue_rows,
        "revisions": revisions,
        "revisionResult": {
            "from": first["label"],
            "to": last["label"],
            "durationsUnchanged": all(
                first_by_id[cue_id]["durationSeconds"]
                == last_by_id[cue_id]["durationSeconds"]
                for cue_id in first_by_id
            ),
            "eventIdentityUnchanged": all(
                first_by_id[cue_id]["contour"] == last_by_id[cue_id]["contour"]
                for cue_id in first_by_id
            ),
            "payloadRebuilt": all(
                first_by_id[cue_id]["sha256"] != last_by_id[cue_id]["sha256"]
                for cue_id in first_by_id
            ),
        },
        "unverified": recipe.get("unverified", []),
    }
    return manifest


def manifest_text(manifest):
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"


def load_recipe(path=RECIPE_PATH):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"recipe is not valid JSON: {error}") from error


def write_outputs(recipe, output_dir=ROOT):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    batch = build_batch(recipe)
    manifest = build_manifest(recipe)
    for cue in recipe["cues"]:
        (output_dir / cue["file"]).write_bytes(batch[cue["id"]]["wav"])
    (output_dir / MANIFEST_NAME).write_text(manifest_text(manifest), encoding="utf-8")
    return manifest


def check_outputs(recipe, output_dir=ROOT):
    output_dir = Path(output_dir)
    batch = build_batch(recipe)
    manifest = build_manifest(recipe)
    problems = []
    for cue in recipe["cues"]:
        path = output_dir / cue["file"]
        if not path.exists():
            problems.append(f"missing {cue['file']}")
            continue
        expected = batch[cue["id"]]["wav"]
        actual = path.read_bytes()
        if actual != expected:
            problems.append(
                f"{cue['file']} differs (expected {len(expected)} bytes, found {len(actual)})"
            )
    manifest_path = output_dir / MANIFEST_NAME
    if not manifest_path.exists():
        problems.append(f"missing {MANIFEST_NAME}")
    elif manifest_path.read_text(encoding="utf-8") != manifest_text(manifest):
        problems.append(f"{MANIFEST_NAME} differs from a fresh build")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify committed WAVs and manifest against a fresh in-memory build without writing",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT,
        help="directory for the four WAVs and manifest (default: this directory)",
    )
    args = parser.parse_args(argv)
    try:
        recipe = load_recipe()
        if args.check:
            problems = check_outputs(recipe, args.output_dir)
            if problems:
                for problem in problems:
                    print(f"FAIL {problem}", file=sys.stderr)
                return 1
            print("OK four WAVs and manifest match a fresh deterministic build")
            return 0
        manifest = write_outputs(recipe, args.output_dir)
        for cue in manifest["cues"]:
            print(
                f"{cue['id']}: {cue['durationSeconds']:.3f}s "
                f"peak {cue['peakDbfs']:.3f} dBFS {cue['sha256'][:12]}"
            )
        print(
            f"OK wrote {len(manifest['cues'])} WAVs and {MANIFEST_NAME} "
            f"at revision {manifest['revision']['label']} "
            f"(ratio {manifest['revision']['fundamentalRatio']})"
        )
        return 0
    except (ValueError, OSError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
