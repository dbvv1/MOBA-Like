"""Thin TripoSG caller for the open-weight rock candidate.

Differences from ``scripts/inference_triposg.py`` upstream, all deliberate:

* The input must already carry a real alpha matte. It is validated with
  ``png_rgba`` and composited over white here; RMBG-1.4 is never imported,
  downloaded or initialised. An empty/opaque/malformed alpha fails loudly.
* Weights are never downloaded from this script. ``--weights`` must point at a
  local weights directory (``model_index.json`` plus the transformer/vae
  tensors) for the official ``VAST-AI/TripoSG`` model; it is not the source
  checkout. The caller records the revision via ``--revision`` and names the
  source with ``--source-dir``.
* The TripoSG checkout on ``PYTHONPATH`` is verified against the pinned
  commit with ``git rev-parse HEAD`` (pass ``--source-dir`` to name it); a
  different checkout fails instead of being recorded under the pinned SHA.
* Nonflash extraction is the only product-eligible mode. It uses the official
  ``use_flash_decoder=False`` branch (``hierarchical_extract_geometry`` ->
  ``scikit-image.measure.marching_cubes``) and therefore never needs
  ``diso``. Upstream still imports ``diso`` at module top level, so the
  reviewed ``--patch`` (see ``patches/triposg-nonflash.patch``) is required;
  its base commit and SHA-256 are recorded. A patched tree is never recorded
  as clean upstream.
* Flash extraction is available only as a comparison and imports ``diso``,
  whose upstream license is CC BY-NC 4.0. It is not a product path.
* The raw generated mesh is exported unchanged (``raw.glb`` plus
  ``raw-mesh.npz``). Decimation, re-grounding and material work belong to
  ``postprocess.py`` so the raw output stays auditable.
* A ``run.json`` sidecar records the exact versions, hashes and timings.

Run (after the official weights have been placed locally):
    python asset-pipeline/battle/tools/openweight-rock/run_triposg.py \
        --weights <local weights directory containing model_index.json> \
        --revision <hf commit> \
        --source-dir <pinned TripoSG checkout> \
        --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
        --out-dir asset-pipeline/battle/source/openweight-rock/generated

The script writes only below ``--out-dir``.
"""
import argparse
import hashlib
import json
import platform
import os
import re
import importlib.metadata
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from png_rgba import read_rgba, validate_alpha  # noqa: E402

SOURCE_COMMIT = "fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c"
SOURCE_URL = "https://github.com/VAST-AI-Research/TripoSG"
WEIGHTS_URL = "https://huggingface.co/VAST-AI/TripoSG"
RMBG_NOTE = "RMBG-1.4 is not used: the input supplies its own alpha matte."
NONFLASH_PATCH = Path(__file__).resolve().parent / "patches" / "triposg-nonflash.patch"
# Hash of the reviewed patch that defers the flash-only ``diso`` import.
NONFLASH_PATCH_SHA256 = "32bec58f6c3cd4dd06fdeb50ba19be3f148d3d0dcf7d81f08b8ef55223589b71"
DISO_LICENSE_NOTE = (
    "diso is CC BY-NC 4.0, not part of TripoSG's MIT code; nonflash extraction "
    "does not import it and flash extraction is comparison-only."
)
PACKAGE_NAMES = (
    "diffusers", "transformers", "numpy", "Pillow", "trimesh",
    "scikit-image", "torchvision", "diso",
)


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
    from PIL import Image

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


CONFIG_SUFFIXES = (".json", ".yaml", ".yml")


def weights_fingerprint(directory, index_name="model_index.json",
                        tensor_suffixes=(".safetensors", ".bin", ".pt", ".pth"),
                        config_suffixes=CONFIG_SUFFIXES):
    """Fingerprint a local weights directory; never touches the network.

    ``index_name`` distinguishes the TripoSG layout (``model_index.json``)
    from TripoSR (``config.yaml`` + ``model.ckpt``).

    Tensor shards alone are not the whole model identity: a diffusers-style
    directory keeps the component definitions in nested metadata such as
    ``transformer/config.json`` and ``vae/config.json``, and a changed config
    must be visible in ``run.json``. Metadata files (JSON/YAML at any depth)
    are therefore hashed too, while at least one tensor file is still
    required so a metadata-only directory is not mistaken for weights.
    """
    directory = Path(directory)
    index = directory / index_name
    if not index.is_file():
        raise FileNotFoundError(
            f"{directory} is not a local weights repository ({index_name} missing). "
            "Download it from the official Hub on a permitted network; this script never "
            "fetches weights."
        )
    tensors = set(tensor_suffixes)
    configs = set(config_suffixes)
    files = []
    has_tensor = False
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        is_tensor = path.suffix in tensors
        if not (is_tensor or path.suffix in configs or path.name == index_name):
            continue
        has_tensor = has_tensor or is_tensor
        files.append(
            {
                "path": path.relative_to(directory).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    # Relative file names only: run.json is a committed provenance artifact and
    # must not embed the receiver's absolute filesystem layout.
    if not has_tensor:
        raise FileNotFoundError("local weights contain no model tensor files")
    return {"files": files}


def package_versions(names=PACKAGE_NAMES):
    """Record installed distribution versions; missing ones stay explicit."""
    versions = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def read_recorded_patch(patch_path):
    """Return the reviewed patch digest, refusing any other patch file."""
    data = Path(patch_path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != NONFLASH_PATCH_SHA256:
        raise SystemExit(
            f"nonflash patch SHA-256 is {digest}, expected the reviewed "
            f"{NONFLASH_PATCH_SHA256}; regenerate the review before using another patch"
        )
    return digest


def _git(top, *args):
    return subprocess.run(
        ["git", "-C", str(top), *args],
        check=True, capture_output=True,
    ).stdout


def verify_source_commit(source_dir=None, expected=SOURCE_COMMIT, patch=None):
    """Return ``(checkout root, HEAD, patch digest or None)``.

    ``--source-dir`` should name the checkout placed on ``PYTHONPATH``. If it
    is omitted, the already-imported ``triposg`` package is located instead.
    A non-git checkout, missing git, or any other HEAD is a hard failure.

    With no patch the tree must be clean. With a patch the tracked diff must
    be byte-identical to the reviewed patch, so ``run.json`` can honestly say
    "base commit + exactly this patch" instead of claiming clean upstream.
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
        top = _git(source_dir, "rev-parse", "--show-toplevel").decode().strip()
        head = _git(top, "rev-parse", "HEAD").decode().strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            f"cannot read git HEAD of the TripoSG checkout at --source-dir: {exc}"
        ) from exc
    if head != expected:
        raise SystemExit(
            f"pinned checkout HEAD is {head}, expected {expected}; "
            "check out the pinned commit instead of recording a different source"
        )
    if patch is None:
        status = _git(top, "status", "--porcelain", "--untracked-files=all").decode().strip()
        if status:
            raise SystemExit("source checkout is dirty; use a clean pinned checkout")
        return Path(top).resolve(), head, None

    patch_digest = read_recorded_patch(patch)
    status = _git(top, "status", "--porcelain", "--untracked-files=all").decode().splitlines()
    untracked = [line for line in status if line.startswith("??")]
    if untracked:
        raise SystemExit(f"source checkout has untracked files: {untracked[:3]}")
    diff = _git(top, "diff", "--no-color", "HEAD", "--")
    if hashlib.sha256(diff).hexdigest() != patch_digest:
        raise SystemExit(
            "source working tree does not match the reviewed nonflash patch; "
            "apply exactly patches/triposg-nonflash.patch to the pinned commit"
        )
    return Path(top).resolve(), head, patch_digest


def verify_imported_source(source_root, module_file, package_dir="triposg"):
    """The code imported must be the checkout whose commit was checked."""
    try:
        Path(module_file).resolve().relative_to(source_root / package_dir)
    except (ValueError, TypeError):
        raise SystemExit("imported module is outside the verified checkout")


def verify_imported_modules(source_root, module_files):
    for module_file in module_files:
        verify_imported_source(source_root, module_file)


def assert_no_diso_import(modules=None):
    """Nonflash mode must prove the CC BY-NC dependency stayed unloaded."""
    loaded = sys.modules if modules is None else modules
    if "diso" in loaded:
        raise SystemExit(
            "nonflash extraction imported diso; the tree is not the reviewed "
            "nonflash patch, so this run cannot be recorded as license-cleared"
        )


def validate_revision(revision):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("--revision must be the exact 40-character official Hub commit")


def create_output(directory):
    directory = Path(directory)
    if directory.exists() and any(directory.iterdir()):
        raise FileExistsError("output directory is nonempty; preserve the earlier attempt")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True,
                        help="local weights directory (model_index.json and tensors), "
                             "not the source checkout")
    parser.add_argument("--revision", required=True, help="Hub revision/commit the weights came from")
    parser.add_argument(
        "--source-dir",
        required=True,
        help="pinned TripoSG checkout on PYTHONPATH; HEAD must match SOURCE_COMMIT",
    )
    parser.add_argument(
        "--extractor",
        choices=("nonflash", "flash"),
        default="nonflash",
        help="nonflash (official license-cleared path, default) or flash (comparison only)",
    )
    parser.add_argument(
        "--patch",
        default=None,
        help="nonflash patch to verify; defaults to patches/triposg-nonflash.patch",
    )
    parser.add_argument("--image", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--seed", type=int, default=20261026)
    parser.add_argument("--num-inference-steps", type=int, default=50)
    parser.add_argument("--guidance-scale", type=float, default=7.0)
    parser.add_argument("--dense-octree-depth", type=int, default=8,
                        help="nonflash extraction; lower only with a recorded quality/memory note")
    parser.add_argument("--hierarchical-octree-depth", type=int, default=9,
                        help="nonflash extraction; lower only with a recorded quality/memory note")
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()

    validate_revision(args.revision)
    if args.extractor == "nonflash":
        patch = Path(args.patch) if args.patch else NONFLASH_PATCH
    else:
        if args.patch:
            raise SystemExit("--patch is only valid for --extractor nonflash")
        patch = None
    source_root, source_commit, patch_digest = verify_source_commit(
        args.source_dir, SOURCE_COMMIT, patch
    )
    # No implicit Hub downloads, including nested component loads.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path.insert(0, str(source_root))
    import numpy as np
    import torch

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; TripoSG needs a CUDA GPU")
    torch.cuda.init()

    out_dir = create_output(args.out_dir)
    prepared_path = out_dir / "prepared-input.png"
    prepared, alpha_stats = prepare_foreground(args.image, prepared_path)
    try:
        fingerprint = weights_fingerprint(args.weights)
    except FileNotFoundError as exc:
        raise SystemExit(str(exc)) from exc

    try:
        from triposg import inference_utils
        from triposg.pipelines import pipeline_triposg
        TripoSGPipeline = pipeline_triposg.TripoSGPipeline
        verify_imported_modules(
            source_root, [pipeline_triposg.__file__, inference_utils.__file__]
        )
    except ImportError as exc:
        raise SystemExit(
            "TripoSG source is not importable. For nonflash, apply "
            "patches/triposg-nonflash.patch to the pinned commit. For flash, "
            "install diso==0.1.4 (CC BY-NC 4.0); flash is comparison-only. Put the "
            "checkout on PYTHONPATH; this script does not vendor model code."
        ) from exc

    if args.extractor == "nonflash":
        # Importing the pipeline is where an unpatched tree pulls in diso.
        assert_no_diso_import()

    device = torch.device(args.device)
    dtype = torch.float16
    torch.cuda.reset_peak_memory_stats(device)
    free_before, total = torch.cuda.mem_get_info(device)

    load_start = time.time()
    pipe = TripoSGPipeline.from_pretrained(args.weights, local_files_only=True, torch_dtype=dtype)
    pipe = pipe.to(device, dtype)
    torch.cuda.synchronize(device)
    load_seconds = time.time() - load_start

    generator = torch.Generator(device=device).manual_seed(args.seed)
    infer_start = time.time()
    with torch.no_grad():
        output = pipe(
            image=prepared,
            generator=generator,
            num_inference_steps=args.num_inference_steps,
            guidance_scale=args.guidance_scale,
            use_flash_decoder=(args.extractor == "flash"),
            dense_octree_depth=args.dense_octree_depth,
            hierarchical_octree_depth=args.hierarchical_octree_depth,
        ).samples[0]
    torch.cuda.synchronize(device)
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
        "source": {
            "url": SOURCE_URL,
            "baseCommit": source_commit,
            "patched": patch_digest is not None,
            "patch": (
                {"file": Path(patch).name, "sha256": patch_digest}
                if patch_digest is not None else None
            ),
        },
        "extractor": args.extractor,
        "diso": DISO_LICENSE_NOTE,
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
            "denseOctreeDepth": args.dense_octree_depth,
            "hierarchicalOctreeDepth": args.hierarchical_octree_depth,
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
            "packages": package_versions(),
            "torch": torch.__version__,
            "torchCuda": torch.version.cuda,
            "deviceName": torch.cuda.get_device_name(device),
        },
    }
    (out_dir / "run.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
    print(json.dumps({"raw": str(raw_glb), "faces": len(faces), "run": str(out_dir / "run.json")}))


if __name__ == "__main__":
    main()
