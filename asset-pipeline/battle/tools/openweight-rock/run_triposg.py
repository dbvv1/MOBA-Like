"""Thin TripoSG caller for the open-weight rock candidate.

Differences from ``scripts/inference_triposg.py`` upstream, all deliberate:

* The input must already carry a real alpha matte. It is validated with
  ``png_rgba`` and composited over white here; RMBG-1.4 is never imported,
  downloaded or initialised. An empty/opaque/malformed alpha fails loudly.
* Weights are never downloaded from this script. ``--weights`` must point at a
  local copy of the official ``VAST-AI/TripoSG`` repository; the caller is
  responsible for the revision and records it via ``--revision``.
* The TripoSG checkout on ``PYTHONPATH`` is verified against the pinned
  commit with ``git rev-parse HEAD`` (pass ``--source-dir`` to name it); a
  different checkout fails instead of being recorded under the pinned SHA.
* The raw generated mesh is exported unchanged (``raw.glb`` plus
  ``raw-mesh.npz``). Decimation, re-grounding and material work belong to the
  separate Blender source pass so the raw output stays auditable.
* A ``run.json`` sidecar records the exact versions, hashes and timings.

Run (after the official weights have been placed locally):
    python asset-pipeline/battle/tools/openweight-rock/run_triposg.py \
        --weights <local TripoSG checkout> --revision <hf commit> \
        --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
        --out-dir asset-pipeline/battle/source/openweight-rock/generated

The script writes only below ``--out-dir``.
"""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from png_rgba import read_rgba, validate_alpha  # noqa: E402

SOURCE_COMMIT = "fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c"
SOURCE_URL = "https://github.com/VAST-AI-Research/TripoSG"
WEIGHTS_URL = "https://huggingface.co/VAST-AI/TripoSG"
RMBG_NOTE = "RMBG-1.4 is not used: the input supplies its own alpha matte."


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare_foreground(image_path, out_path):
    """Validate alpha, crop to it and composite over white with a 10% margin.

    The crop uses the full-alpha bbox from ``validate_alpha`` (``a > 0``),
    including the anti-aliased rim, so the matte gate and the crop agree.
    Matches the framing of upstream ``image_process.load_image`` without any
    background-removal fallback.
    """
    width, height, rgba = read_rgba(image_path)
    stats = validate_alpha(width, height, rgba)
    min_x, min_y, max_x, max_y = stats["bbox"]
    rgba_image = Image.frombytes("RGBA", (width, height), bytes(rgba))
    crop = rgba_image.crop((min_x, min_y, max_x + 1, max_y + 1))
    white = Image.new("RGB", crop.size, (255, 255, 255))
    white.paste(crop, (0, 0), crop)
    w, h = white.size
    if w > h:
        pad_x = int(w * 0.1)
        pad_y = int(pad_x + (w - h) / 2)
    else:
        pad_y = int(h * 0.1)
        pad_x = int(pad_y + (h - w) / 2)
    canvas = Image.new("RGB", (w + 2 * pad_x, h + 2 * pad_y), (255, 255, 255))
    canvas.paste(white, (pad_x, pad_y))
    canvas.save(out_path, format="PNG")
    return canvas, stats


def weights_fingerprint(directory):
    directory = Path(directory)
    index = directory / "model_index.json"
    if not index.is_file():
        raise FileNotFoundError(
            f"{directory} is not a local TripoSG repository (model_index.json missing). "
            "Download it from the official Hub on a permitted network; this script never "
            "fetches weights."
        )
    files = []
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.suffix in {".json", ".safetensors", ".bin", ".pt", ".pth"}:
            files.append(
                {
                    "path": path.relative_to(directory).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    # Relative file names only: run.json is a committed provenance artifact and
    # must not embed the receiver's absolute filesystem layout.
    return {"files": files}


def verify_source_commit(source_dir=None):
    """Return the TripoSG checkout HEAD and require it to be ``SOURCE_COMMIT``.

    ``--source-dir`` should name the checkout placed on ``PYTHONPATH``. If it
    is omitted, the already-imported ``triposg`` package is located instead.
    A non-git checkout, missing git, or any other HEAD is a hard failure: the
    provenance recorded in ``run.json`` must describe the code that ran.
    """
    if source_dir is None:
        package = sys.modules.get("triposg")
        module_file = getattr(package, "__file__", None) if package else None
        if not module_file:
            raise SystemExit(
                "cannot locate the imported triposg package; pass --source-dir "
                "pointing at the pinned TripoSG checkout"
            )
        source_dir = Path(module_file).resolve().parent
    source_dir = Path(source_dir)
    if not source_dir.is_dir():
        raise SystemExit(f"--source-dir is not a directory: {source_dir}")
    try:
        top = subprocess.run(
            ["git", "-C", str(source_dir), "rev-parse", "--show-toplevel"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        head = subprocess.run(
            ["git", "-C", top, "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            f"cannot read git HEAD of the TripoSG checkout at --source-dir: {exc}"
        ) from exc
    if head != SOURCE_COMMIT:
        raise SystemExit(
            f"TripoSG checkout HEAD is {head}, expected the pinned {SOURCE_COMMIT}; "
            "check out the pinned commit instead of recording a different source"
        )
    return head


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True, help="local copy of the official TripoSG repo")
    parser.add_argument("--revision", default="", help="Hub revision/commit the weights came from")
    parser.add_argument(
        "--source-dir",
        default=None,
        help="pinned TripoSG checkout on PYTHONPATH; HEAD must match SOURCE_COMMIT",
    )
    parser.add_argument("--image", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--seed", type=int, default=20261026)
    parser.add_argument("--num-inference-steps", type=int, default=50)
    parser.add_argument("--guidance-scale", type=float, default=7.0)
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; TripoSG needs a CUDA GPU")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    prepared_path = out_dir / "prepared-input.png"
    prepared, alpha_stats = prepare_foreground(args.image, prepared_path)
    fingerprint = weights_fingerprint(args.weights)

    try:
        from triposg.pipelines.pipeline_triposg import TripoSGPipeline
    except ImportError as exc:
        raise SystemExit(
            "TripoSG source is not importable. Clone the pinned commit and put its "
            "checkout on PYTHONPATH (or install it editable) before running; this "
            "script does not vendor model code."
        ) from exc

    source_commit = verify_source_commit(args.source_dir)

    device = torch.device(args.device)
    dtype = torch.float16
    torch.cuda.reset_peak_memory_stats(device)
    free_before, total = torch.cuda.mem_get_info(device)

    load_start = time.time()
    pipe = TripoSGPipeline.from_pretrained(args.weights)
    pipe = pipe.to(device, dtype)
    load_seconds = time.time() - load_start

    generator = torch.Generator(device=device).manual_seed(args.seed)
    infer_start = time.time()
    with torch.no_grad():
        output = pipe(
            image=prepared,
            generator=generator,
            num_inference_steps=args.num_inference_steps,
            guidance_scale=args.guidance_scale,
        ).samples[0]
    infer_seconds = time.time() - infer_start
    peak_allocated = torch.cuda.max_memory_allocated(device)
    peak_reserved = torch.cuda.max_memory_reserved(device)
    free_after, _ = torch.cuda.mem_get_info(device)

    vertices = np.asarray(output[0], dtype=np.float32)
    faces = np.ascontiguousarray(output[1])
    import trimesh

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    raw_glb = out_dir / "raw.glb"
    mesh.export(raw_glb)
    np.savez_compressed(out_dir / "raw-mesh.npz", vertices=vertices, faces=faces)

    run = {
        "source": {"url": SOURCE_URL, "commit": source_commit},
        "weights": {"url": WEIGHTS_URL, "revision": args.revision, **fingerprint},
        "rmbg": RMBG_NOTE,
        "input": {
            "file": Path(args.image).name,
            "sha256": sha256_file(args.image),
            "alpha": {k: v for k, v in alpha_stats.items() if k != "bbox"},
            "bbox": alpha_stats["bbox"],
            "preparedSha256": sha256_file(prepared_path),
        },
        "params": {
            "seed": args.seed,
            "numInferenceSteps": args.num_inference_steps,
            "guidanceScale": args.guidance_scale,
            "dtype": str(dtype),
            "device": str(device),
        },
        "output": {
            "rawGlbSha256": sha256_file(raw_glb),
            "vertices": int(len(vertices)),
            "faces": int(len(faces)),
        },
        "timing": {"loadSeconds": round(load_seconds, 2), "inferSeconds": round(infer_seconds, 2)},
        "vram": {
            "totalMiB": round(total / 2 ** 20, 1),
            "freeBeforeMiB": round(free_before / 2 ** 20, 1),
            "freeAfterMiB": round(free_after / 2 ** 20, 1),
            "peakAllocatedMiB": round(peak_allocated / 2 ** 20, 1),
            "peakReservedMiB": round(peak_reserved / 2 ** 20, 1),
        },
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "torchCuda": torch.version.cuda,
            "deviceName": torch.cuda.get_device_name(device),
        },
    }
    (out_dir / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
    print(json.dumps({"raw": str(raw_glb), "faces": len(faces), "run": str(out_dir / "run.json")}))


if __name__ == "__main__":
    main()
