"""Low-cost TripoSR fallback for the open-weight rock candidate.

This is a thin caller, not a reimplementation and not a mirror:

* Source and weights are the official ``VAST-AI-Research/TripoSR`` (MIT) at a
  pinned commit, and ``stabilityai/TripoSR`` (MIT) locally. Nothing is
  downloaded here.
* ``run.py`` upstream imports ``rembg`` at module top level even with
  ``--no-remove-bg``. This script imports ``tsr.system.TSR`` directly, so the
  banned background model is never installed, imported or initialised.
* The input contract mirrors ``--no-remove-bg``: crop the real alpha matte to
  its full-alpha box, pad to a square and composite over neutral gray 0.5.
  The output is an RGB PNG with no alpha and a properly sized foreground.
* Surface extraction uses ``torchmcubes`` (MPL-2.0) as upstream does. It is a
  compiled extension; the runner reports its absence instead of swapping in a
  different extraction framework.
* The raw generated mesh is exported unchanged; ``postprocess.py`` handles
  decimation, grounding and materials.

Run (after the official weights have been placed locally):
    python asset-pipeline/battle/tools/openweight-rock/run_triposr.py \
        --weights <local TripoSR weights dir with config.yaml + model.ckpt> \
        --revision <hf commit> \
        --source-dir <pinned TripoSR checkout> \
        --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
        --out-dir asset-pipeline/battle/source/openweight-rock/generated-triposr

The script writes only below ``--out-dir``.
"""
import argparse
import json
import platform
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from png_rgba import read_rgba, validate_alpha, write_rgb_png  # noqa: E402
from run_triposg import (  # noqa: E402
    create_output,
    package_versions,
    sha256_file,
    validate_revision,
    verify_imported_source,
    verify_source_commit,
    weights_fingerprint,
)

SOURCE_COMMIT = "107cefdc244c39106fa830359024f6a2f1c78871"
SOURCE_URL = "https://github.com/VAST-AI-Research/TripoSR"
WEIGHTS_URL = "https://huggingface.co/stabilityai/TripoSR"
SOURCE_LICENSE = "MIT"
TORCHMCUBES_LICENSE = "MPL-2.0"
NO_REMBG_NOTE = (
    "rembg is never imported: run.py is not used, and the input already carries "
    "a sized foreground over neutral gray."
)
GRAY = (128, 128, 128)
TARGET_RATIO = 0.85
PACKAGE_NAMES = ("torch", "numpy", "trimesh", "Pillow", "torchmcubes", "scikit-image")


def gray_background_rgb(width, height, rgba, bbox, background=128, ratio=TARGET_RATIO):
    """Crop to the full-alpha box and composite over neutral gray.

    Matches upstream ``resize_foreground``: crop, pad to a square, then pad the
    square so the foreground takes ``ratio`` of the final edge. The crop uses
    ``a > 0`` (opaque core plus anti-aliased rim), the same rule as the alpha
    gate, so soft edges are not discarded.
    """
    min_x, min_y, max_x, max_y = bbox
    box_w, box_h = max_x - min_x + 1, max_y - min_y + 1
    if box_w < 1 or box_h < 1:
        raise ValueError("empty alpha bbox")
    size = max(box_w, box_h)
    square = bytearray([background]) * (size * size * 3)
    ox, oy = (size - box_w) // 2, (size - box_h) // 2
    for y in range(box_h):
        src_row = (min_y + y) * width
        dst_row = (oy + y) * size
        for x in range(box_w):
            i = (src_row + min_x + x) * 4
            alpha = rgba[i + 3]
            j = (dst_row + ox + x) * 3
            if alpha == 255:
                square[j:j + 3] = rgba[i:i + 3]
            elif alpha:
                inverse = 255 - alpha
                square[j] = (rgba[i] * alpha + background * inverse + 127) // 255
                square[j + 1] = (rgba[i + 1] * alpha + background * inverse + 127) // 255
                square[j + 2] = (rgba[i + 2] * alpha + background * inverse + 127) // 255
    final_size = int(size / ratio)
    final = bytearray([background]) * (final_size * final_size * 3)
    offset = (final_size - size) // 2
    row_bytes = size * 3
    for row in range(size):
        start = (offset + row) * final_size * 3 + offset * 3
        final[start:start + row_bytes] = square[row * row_bytes:(row + 1) * row_bytes]
    return final_size, final_size, final


def prepare_gray_rgb(image_path, out_path):
    width, height, rgba = read_rgba(image_path)
    stats = validate_alpha(width, height, rgba)
    out_w, out_h, rgb = gray_background_rgb(width, height, rgba, stats["bbox"])
    write_rgb_png(out_path, out_w, out_h, rgb)
    return out_w, out_h, stats


def assert_no_rembg_import(modules=None):
    """The fallback must not quietly reintroduce the banned background model."""
    loaded = sys.modules if modules is None else modules
    for name in ("rembg", "tsr.bake_texture"):
        if name in loaded:
            raise SystemExit(
                f"{name} was imported; this runner must avoid rembg and xatlas "
                "and keep the input contract explicit"
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True,
                        help="local TripoSR weights directory (config.yaml + model.ckpt)")
    parser.add_argument("--revision", required=True, help="Hub revision the weights came from")
    parser.add_argument("--source-dir", required=True,
                        help="pinned TripoSR checkout; HEAD must match SOURCE_COMMIT")
    parser.add_argument("--image", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--mc-resolution", type=int, default=256)
    parser.add_argument("--chunk-size", type=int, default=8192)
    args = parser.parse_args()

    validate_revision(args.revision)
    source_root, source_commit, _ = verify_source_commit(args.source_dir, SOURCE_COMMIT)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path.insert(0, str(source_root))
    import numpy as np
    import torch
    from PIL import Image

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; the TripoSR route targets the GPU host")
    torch.cuda.init()

    out_dir = create_output(args.out_dir)
    prepared_path = out_dir / "prepared-input.png"
    prepared_w, prepared_h, alpha_stats = prepare_gray_rgb(args.image, prepared_path)
    try:
        fingerprint = weights_fingerprint(
            args.weights, index_name="config.yaml", tensor_suffixes=(".ckpt",)
        )
    except FileNotFoundError as exc:
        raise SystemExit(str(exc)) from exc

    try:
        from tsr.system import TSR
    except ImportError as exc:
        # Keep the missing module name visible; a wrapped message alone hides
        # whether torchmcubes, rembg or another dependency is the cause.
        assert_no_rembg_import(sys.modules)
        raise SystemExit(
            "TripoSR source is not importable: "
            f"{exc}. Put the pinned checkout on PYTHONPATH; surface extraction "
            "also needs torchmcubes (MPL-2.0), a compiled extension. Do not "
            "substitute another extraction framework."
        ) from exc
    verify_imported_source(source_root, sys.modules["tsr.system"].__file__, package_dir="tsr")
    assert_no_rembg_import()

    device = torch.device(args.device)
    torch.cuda.reset_peak_memory_stats(device)
    free_before, total = torch.cuda.mem_get_info(device)

    load_start = time.time()
    model = TSR.from_pretrained(args.weights, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(args.chunk_size)
    model.to(device)
    torch.cuda.synchronize(device)
    load_seconds = time.time() - load_start

    # ``--no-remove-bg`` upstream path: an RGB image, no rembg session.
    image = np.array(Image.open(prepared_path).convert("RGB"))
    infer_start = time.time()
    with torch.no_grad():
        scene_codes = model([image], device=str(device))
    torch.cuda.synchronize(device)
    infer_seconds = time.time() - infer_start

    extract_start = time.time()
    meshes = model.extract_mesh(scene_codes, True, resolution=args.mc_resolution)
    torch.cuda.synchronize(device)
    extract_seconds = time.time() - extract_start
    peak_allocated = torch.cuda.max_memory_allocated(device)
    peak_reserved = torch.cuda.max_memory_reserved(device)
    free_after, _ = torch.cuda.mem_get_info(device)

    import trimesh
    mesh = meshes[0]
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.ascontiguousarray(mesh.faces)
    raw_glb = out_dir / "raw.glb"
    mesh.export(raw_glb)
    np.savez_compressed(out_dir / "raw-mesh.npz", vertices=vertices, faces=faces)

    run = {
        "source": {"url": SOURCE_URL, "commit": source_commit, "license": SOURCE_LICENSE},
        "extractor": "torchmcubes",
        "dependencies": {
            "torchmcubes": {"license": TORCHMCUBES_LICENSE,
                            "version": package_versions(("torchmcubes",)).get("torchmcubes")},
            "rembg": NO_REMBG_NOTE,
            "rmbg": "not used",
        },
        "weights": {"url": WEIGHTS_URL, "revision": args.revision, "license": SOURCE_LICENSE,
                    **fingerprint},
        "input": {
            "file": Path(args.image).name,
            "sha256": sha256_file(args.image),
            "alpha": {k: v for k, v in alpha_stats.items() if k != "bbox"},
            "bbox": alpha_stats["bbox"],
            "background": "neutral gray 0.5 (RGB, no alpha)",
            "prepared": {"width": prepared_w, "height": prepared_h,
                         "sha256": sha256_file(prepared_path)},
        },
        "params": {"mcResolution": args.mc_resolution, "chunkSize": args.chunk_size,
                   "device": str(device)},
        "output": {"rawGlbSha256": sha256_file(raw_glb),
                   "vertices": int(len(vertices)), "faces": int(len(faces))},
        "timing": {"loadSeconds": round(load_seconds, 2),
                   "inferSeconds": round(infer_seconds, 2),
                   "extractSeconds": round(extract_seconds, 2)},
        "vram": {
            "totalMiB": round(total / 2 ** 20, 1),
            "freeBeforeMiB": round(free_before / 2 ** 20, 1),
            "freeAfterMiB": round(free_after / 2 ** 20, 1),
            "peakAllocatedMiB": round(peak_allocated / 2 ** 20, 1),
            "peakReservedMiB": round(peak_reserved / 2 ** 20, 1),
        },
        "runtime": {
            "python": platform.python_version(),
            "packages": package_versions(PACKAGE_NAMES),
            "torch": torch.__version__,
            "torchCuda": torch.version.cuda,
            "deviceName": torch.cuda.get_device_name(device),
        },
    }
    (out_dir / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
    print(json.dumps({"raw": str(raw_glb), "faces": len(faces),
                      "run": str(out_dir / "run.json")}))


if __name__ == "__main__":
    main()
