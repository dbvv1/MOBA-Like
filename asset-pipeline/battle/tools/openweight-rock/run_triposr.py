"""Low-cost TripoSR fallback for the open-weight rock candidate.

This is a thin caller, not a reimplementation and not a mirror:

* Source and weights are the official ``VAST-AI-Research/TripoSR`` (MIT) at a
  pinned commit, and ``stabilityai/TripoSR`` (MIT) locally. Nothing is
  downloaded here.
* Both ``run.py`` and ``tsr.utils`` import ``rembg`` upstream. The required
  two-file patch defers the latter import to actual background removal and
  reads DINO configuration locally. No background model is downloaded.
* Source HEAD, the exact patched files and local DINO config are checked
  before importing dependencies or creating output. No Hub cache is needed.
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
        --revision 5b521936b01fbe1890f6f9baed0254ab6351c04a \
        --source-dir <pinned TripoSR checkout> \
        --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
        --out-dir asset-pipeline/battle/source/openweight-rock/generated-triposr

The script writes only below ``--out-dir``.
"""
import argparse
import hashlib
import subprocess
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
    weights_fingerprint,
)

SOURCE_COMMIT = "107cefdc244c39106fa830359024f6a2f1c78871"
SOURCE_URL = "https://github.com/VAST-AI-Research/TripoSR"
WEIGHTS_URL = "https://huggingface.co/stabilityai/TripoSR"
SOURCE_LICENSE = "MIT"
TORCHMCUBES_LICENSE = "MPL-2.0"
NO_REMBG_NOTE = (
    "run.py is not used; the reviewed tsr.utils patch defers rembg until actual "
    "background removal, which this gray-RGB runner never requests."
)
WEIGHTS_REVISION = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
WEIGHTS_CONFIG_BYTES = 987
WEIGHTS_CONFIG_SHA256 = "74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62"
CHECKPOINT_BYTES = 1677246742
CHECKPOINT_SHA256 = "429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee"
DINO_REPO = "facebook/dino-vitb16"
DINO_REVISION = "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2"
DINO_CONFIG = (Path(__file__).resolve().parents[2] /
               "source/openweight-rock/config/dino-vitb16-config.json")
DINO_CONFIG_BYTES = 454
DINO_CONFIG_SHA256 = "b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c"
OFFLINE_PATCH = Path(__file__).resolve().parent / "patches/triposr-offline.patch"
OFFLINE_PATCH_SHA256 = "99167c33aebec64285c97b40c6e4bf75d2d7bdc332f3015865863fd0eccd5b14"
PATCHED_FILES = {
    "tsr/models/tokenizers/image.py": {
        "baseSha256": "f6da23124dfabe6a1f8d0d27693d0cece6574de68be15487a77781b6a9d73195",
        "sha256": "32a12f638e85e73701622dad7092d276119173512d5afbb72dbb4b5d627ebd9c",
    },
    "tsr/utils.py": {
        "baseSha256": "d9d1a645fef7ea489615bff3471fd01a4941a2c0e138c5dff5daae619563279b",
        "sha256": "ec1f673845cfd7568440e51ed9a8947b08a6fb72d5534b0f25856f5cbc2c4394",
    },
}
GRAY = (128, 128, 128)
TARGET_RATIO = 0.85
PACKAGE_NAMES = ("torch", "numpy", "trimesh", "Pillow", "torchmcubes", "scikit-image",
                 "transformers", "huggingface-hub", "omegaconf", "einops", "imageio")


def verify_dino_config(config_path):
    """Verify the only auxiliary model file; no network/cache fallback."""
    path = Path(config_path).resolve()
    if not path.is_file():
        raise SystemExit("local DINO config is missing; provide the pinned 454-byte config.json")
    if path.stat().st_size != DINO_CONFIG_BYTES or sha256_file(path) != DINO_CONFIG_SHA256:
        raise SystemExit("local DINO config size/SHA-256 does not match the pinned official file")
    return path, {
        "repo": DINO_REPO, "revision": DINO_REVISION, "file": "config.json",
        "bytes": DINO_CONFIG_BYTES, "sha256": DINO_CONFIG_SHA256,
        "license": "Apache-2.0", "loading": "local JSON only; no DINO weights",
    }


def _source_git(root, *args):
    return subprocess.run(
        ["git", "-C", str(root), *args], check=True, capture_output=True,
    ).stdout


def _verify_patched_tree(source_dir, expected_commit, expected_files):
    """Real Git checks shared with small synthetic fixtures, never model mocks.

    Require an unstaged application of exactly the reviewed two-file patch.
    Per-file bytes (not a user-configurable diff formatter) establish identity.
    """
    root = Path(source_dir).resolve()
    try:
        top = Path(_source_git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        head = _source_git(root, "rev-parse", "HEAD").decode().strip()
        if root != top:
            raise SystemExit("--source-dir must be the verified checkout root")
        if head != expected_commit:
            raise SystemExit(f"pinned checkout HEAD is {head}, expected {expected_commit}")
        # Do not allow assume-unchanged/skip-worktree to hide source changes.
        flags = _source_git(root, "ls-files", "-v", "-z").split(b"\0")
        if any(row and row[:1] != b"H" for row in flags):
            raise SystemExit("source index has unsupported assume-unchanged/skip-worktree flags")
        if _source_git(root, "diff", "--cached", "--name-only", "-z", "HEAD", "--"):
            raise SystemExit("source checkout has staged changes; apply only the unstaged reviewed patch")
        # Ignore rules must not conceal executable additions or stale bytecode
        # anywhere on source_root's import path (including a root torch.py).
        if _source_git(root, "ls-files", "--others", "-z"):
            raise SystemExit("source checkout has untracked/ignored files; use a clean dedicated checkout")
        status = _source_git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        expected_status = {b" M " + name.encode() for name in expected_files}
        if set(filter(None, status.split(b"\0"))) != expected_status:
            raise SystemExit("source dirty paths do not match the reviewed two-file patch (or untracked files exist)")
        for name, hashes in expected_files.items():
            path = root / name
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                raise SystemExit(f"reviewed source file is missing or linked: {name}")
            base = _source_git(root, "show", f"HEAD:{name}")
            if hashlib.sha256(base).hexdigest() != hashes["baseSha256"]:
                raise SystemExit(f"reviewed source base SHA-256 mismatch: {name}")
            if sha256_file(path) != hashes["sha256"]:
                raise SystemExit(f"reviewed patched source SHA-256 mismatch: {name}")
        return root, head
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit("cannot verify TripoSR Git checkout") from exc


def verify_triposr_source(source_dir):
    if not OFFLINE_PATCH.is_file() or sha256_file(OFFLINE_PATCH) != OFFLINE_PATCH_SHA256:
        raise SystemExit("reviewed TripoSR patch SHA-256 mismatch")
    root, head = _verify_patched_tree(source_dir, SOURCE_COMMIT, PATCHED_FILES)
    return root, {
        "url": SOURCE_URL, "baseCommit": head, "license": SOURCE_LICENSE,
        "patched": True, "patch": OFFLINE_PATCH.name,
        "patchSha256": OFFLINE_PATCH_SHA256, "files": PATCHED_FILES,
    }


def verify_triposr_weights(directory, revision):
    validate_revision(revision)
    if revision != WEIGHTS_REVISION:
        raise SystemExit(f"TripoSR weights revision must be {WEIGHTS_REVISION}")
    # Require the exact filename TSR.from_pretrained uses, not any *.ckpt.
    checkpoint = Path(directory) / "model.ckpt"
    config = Path(directory) / "config.yaml"
    if not config.is_file():
        raise SystemExit("local TripoSR config.yaml missing; no download is attempted")
    if config.stat().st_size != WEIGHTS_CONFIG_BYTES or sha256_file(config) != WEIGHTS_CONFIG_SHA256:
        raise SystemExit("TripoSR config.yaml size/SHA-256 does not match the pinned official config")
    if not checkpoint.is_file():
        raise SystemExit("local TripoSR model.ckpt missing; no download is attempted")
    if checkpoint.stat().st_size != CHECKPOINT_BYTES:
        raise SystemExit("TripoSR model.ckpt size does not match the pinned checkpoint")
    fingerprint = weights_fingerprint(directory, index_name="config.yaml", tensor_suffixes=(".ckpt",))
    row = next(row for row in fingerprint["files"] if row["path"] == "model.ckpt")
    if row["sha256"] != CHECKPOINT_SHA256:
        raise SystemExit("TripoSR model.ckpt SHA-256 does not match the pinned checkpoint")
    return fingerprint


def configure_offline_runtime(source_root, dino_path):
    """Process-local setup, called only after all local identity guards pass.

    Do not create __pycache__ in the dedicated source tree: a later invocation
    must still satisfy the strict ignored/untracked-file guard.
    """
    sys.dont_write_bytecode = True
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TRIPOSR_DINO_CONFIG"] = str(dino_path)
    sys.path.insert(0, str(source_root))


def verify_triposr_imports(source_root, modules=None, require_tokenizer=False):
    loaded = sys.modules if modules is None else modules
    required = {"tsr.system": "tsr/system.py", "tsr.utils": "tsr/utils.py"}
    if require_tokenizer:
        required["tsr.models.tokenizers.image"] = "tsr/models/tokenizers/image.py"
    for name, relative in required.items():
        module_file = getattr(loaded.get(name), "__file__", None)
        verify_imported_source(source_root, module_file, package_dir="tsr")
        if Path(module_file).resolve() != source_root / relative:
            raise SystemExit(f"imported module identity mismatch: {name}")
    # Namespace packages have __path__, not __file__; all search roots must
    # still be inside this checkout. Do not silently mix installed/editable TSR.
    for name, module in list(loaded.items()):
        if name != "tsr" and not name.startswith("tsr."):
            continue
        module_file = getattr(module, "__file__", None)
        if module_file:
            verify_imported_source(source_root, module_file, package_dir="tsr")
        else:
            paths = list(getattr(module, "__path__", ()))
            if not paths:
                raise SystemExit(f"cannot verify imported namespace: {name}")
            for path in paths:
                verify_imported_source(source_root, path, package_dir="tsr")
    for name, relative in (("tsr.utils", "tsr/utils.py"),
                           ("tsr.models.tokenizers.image", "tsr/models/tokenizers/image.py")):
        if name in loaded:
            actual = Path(loaded[name].__file__).resolve()
            if actual != source_root / relative or sha256_file(actual) != PATCHED_FILES[relative]["sha256"]:
                raise SystemExit(f"imported reviewed module identity mismatch: {name}")


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
    """The no-background-removal route must keep optional libraries unloaded."""
    loaded = sys.modules if modules is None else modules
    for name in ("rembg", "tsr.bake_texture"):
        if any(key == name or key.startswith(name + ".") for key in loaded):
            raise SystemExit(
                f"{name} was imported; this runner must avoid rembg and xatlas "
                "and keep the input contract explicit"
            )


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True,
                        help="local TripoSR weights directory (config.yaml + model.ckpt)")
    parser.add_argument("--revision", required=True, help="Hub revision the weights came from")
    parser.add_argument("--source-dir", required=True,
                        help="pinned TripoSR checkout with exactly patches/triposr-offline.patch applied")
    parser.add_argument("--dino-config", default=str(DINO_CONFIG),
                        help="local pinned DINO config.json (bundled 454-byte default)")
    parser.add_argument("--image", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--mc-resolution", type=int, default=256)
    parser.add_argument("--chunk-size", type=int, default=8192)
    args = parser.parse_args(argv)

    # These fail closed using only stdlib + local files, even on a CPU host.
    dino_path, dino_identity = verify_dino_config(args.dino_config)
    source_root, source_identity = verify_triposr_source(args.source_dir)
    fingerprint = verify_triposr_weights(args.weights, args.revision)
    configure_offline_runtime(source_root, dino_path)
    assert_no_rembg_import()
    import numpy as np
    import torch
    from PIL import Image

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; the TripoSR route targets the GPU host")
    torch.cuda.init()

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
    verify_triposr_imports(source_root)
    assert_no_rembg_import()

    out_dir = create_output(args.out_dir)
    prepared_path = out_dir / "prepared-input.png"
    prepared_w, prepared_h, alpha_stats = prepare_gray_rgb(args.image, prepared_path)

    device = torch.device(args.device)
    torch.cuda.reset_peak_memory_stats(device)
    free_before, total = torch.cuda.mem_get_info(device)

    load_start = time.time()
    model = TSR.from_pretrained(args.weights, config_name="config.yaml", weight_name="model.ckpt")
    verify_triposr_imports(source_root, require_tokenizer=True)
    assert_no_rembg_import()
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
        "source": source_identity,
        "extractor": "torchmcubes",
        "dependencies": {
            "dinoConfig": dino_identity,
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
