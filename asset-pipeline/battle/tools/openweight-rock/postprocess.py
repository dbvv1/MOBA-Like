"""Reproducible raw-mesh -> final rock GLB conversion.

The generator output is intentionally kept untouched. This script performs
only the contracted post-processing and records what it did:

1. optional quadric decimation to ``--target-faces`` (default 2,000),
2. grounding and uniform scale to ``--height`` (default 1.1 m),
3. one rough, non-metallic material with no texture and no baked shadow,
4. GLB export plus ``postprocess.json`` with metrics and versions.

The material/texture contract is read back from the exported GLB's JSON chunk,
not assumed from what this script built: ``inspect_glb`` reports the real
material, texture and image counts and alpha modes, and violates the contract
if any texture/image is present, more than two materials are exported, or a
material is not ``OPAQUE``.

The geometry contract is checked against every vertex, not a single bounding
box axis: the maximum horizontal radius ``sqrt(x^2 + z^2)`` must stay at or
below ``--max-radius`` (default 1.2 m). Forward ``+Z`` and the absence of baked
shadow stay manual checks because they cannot be inferred from vertices.

Decimation needs ``fast-simplification`` (MIT) through trimesh. Version is
recorded in the sidecar. Run with the task venv, not the system Python.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

NOMINAL_HEIGHT = 1.1
MAX_RADIUS = 1.2
MAX_TRIANGLES = 2000
MAX_MATERIALS = 2
MAX_GLB_BYTES = 500 * 1024
GLB_MAGIC = 0x46546C67  # "glTF"
GLB_JSON_CHUNK = 0x4E4F534A  # "JSON"
DEFAULT_COLOR = (0.62, 0.57, 0.50, 1.0)  # warm grey stone


def _points(vertices):
    return [(float(v[0]), float(v[1]), float(v[2])) for v in vertices]


def mesh_metrics(vertices):
    """Bounds, height and true all-vertex horizontal radius."""
    points = _points(vertices)
    if not points:
        raise ValueError("mesh has no vertices")
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    radius = max(math.hypot(x, z) for x, z in zip(xs, zs))
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
        "height": max(ys) - min(ys),
        "maxRadius": radius,
    }


def ground_and_scale(vertices, nominal_height=NOMINAL_HEIGHT):
    """Uniformly scale to ``nominal_height`` and put the lowest vertex at y=0."""
    points = _points(vertices)
    if not points:
        raise ValueError("mesh has no vertices")
    min_y = min(p[1] for p in points)
    height = max(p[1] for p in points) - min_y
    if height <= 0:
        raise ValueError("mesh has zero height")
    scale = nominal_height / height
    moved = [(p[0] * scale, (p[1] - min_y) * scale, p[2] * scale) for p in points]
    return moved, scale


def inspect_glb(path):
    """Read the exported GLB JSON chunk and report its actual material state.

    The asset contract must be checked against the bytes on disk, not against
    the material object this script intended to attach. A malformed or
    unexpected GLB is an error, not a silent pass.
    """
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError("GLB is too short to contain a header and JSON chunk")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError("exported file is not a glTF 2.0 binary (GLB)")
    if declared_length != len(data):
        raise ValueError(
            f"GLB header declares {declared_length} bytes but the file has {len(data)}"
        )
    chunk_length, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != GLB_JSON_CHUNK:
        raise ValueError("GLB first chunk is not JSON")
    chunk_end = 20 + chunk_length
    if chunk_end > len(data):
        raise ValueError("GLB JSON chunk is truncated")
    document = json.loads(data[20:chunk_end].decode("utf-8"))
    materials = document.get("materials") or []
    return {
        "materials": len(materials),
        "textures": len(document.get("textures") or []),
        "images": len(document.get("images") or []),
        "alphaModes": [material.get("alphaMode", "OPAQUE") for material in materials],
        "extensionsUsed": list(document.get("extensionsUsed") or []),
    }


def validate_contract(metrics, triangles, materials, glb_bytes=None,
                      nominal_height=NOMINAL_HEIGHT, max_radius=MAX_RADIUS,
                      textures=0, images=0, alpha_modes=()):
    """Raise ValueError for any violated asset contract item."""
    problems = []
    if triangles > MAX_TRIANGLES:
        problems.append(f"{triangles} triangles > {MAX_TRIANGLES}")
    if materials > MAX_MATERIALS:
        problems.append(f"{materials} materials > {MAX_MATERIALS}")
    if textures or images:
        problems.append(
            f"exported GLB has {textures} textures / {images} images; "
            "the contract allows no texture"
        )
    for mode in alpha_modes:
        if mode != "OPAQUE":
            problems.append(f"exported material alphaMode {mode} is not OPAQUE")
    if metrics["maxRadius"] > max_radius + 1e-4:
        problems.append(f"max radius {metrics['maxRadius']:.4f} m > {max_radius} m")
    if abs(metrics["height"] - nominal_height) > 1e-3:
        problems.append(f"height {metrics['height']:.4f} m != {nominal_height} m")
    if abs(metrics["min"][1]) > 1e-3:
        problems.append(f"lowest vertex y={metrics['min'][1]:.4f}, expected 0")
    if glb_bytes is not None and glb_bytes > MAX_GLB_BYTES:
        problems.append(f"GLB {glb_bytes} bytes > {MAX_GLB_BYTES}")
    if problems:
        raise ValueError("; ".join(problems))
    return True


def _load_mesh(path):
    import numpy as np
    import trimesh
    path = Path(path)
    if path.suffix == ".npz":
        data = np.load(path)
        return trimesh.Trimesh(vertices=data["vertices"], faces=data["faces"], process=True)
    return trimesh.load(path, force="mesh", process=True)


def _rough_material(trimesh_module, color):
    from trimesh.visual.material import PBRMaterial
    return PBRMaterial(
        baseColorFactor=list(color),
        metallicFactor=0.0,
        roughnessFactor=0.95,
        alphaMode="OPAQUE",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True, help="raw.glb or raw-mesh.npz from a runner")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--name", default="rock")
    parser.add_argument("--target-faces", type=int, default=MAX_TRIANGLES)
    parser.add_argument("--height", type=float, default=NOMINAL_HEIGHT)
    parser.add_argument("--max-radius", type=float, default=MAX_RADIUS)
    args = parser.parse_args()

    import importlib.metadata
    import numpy as np
    import trimesh

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mesh = _load_mesh(args.raw)
    source_faces = int(len(mesh.faces))

    if source_faces > args.target_faces:
        try:
            mesh = mesh.simplify_quadric_decimation(face_count=args.target_faces)
        except (ImportError, ModuleNotFoundError) as exc:
            raise SystemExit(
                "decimation needs fast-simplification (MIT) in the task venv; "
                "install it instead of skipping the triangle budget"
            ) from exc

    moved, scale = ground_and_scale(mesh.vertices, args.height)
    mesh.vertices = np.asarray(moved, dtype=np.float64)
    mesh.faces = np.ascontiguousarray(mesh.faces)
    mesh.remove_unreferenced_vertices()

    color = DEFAULT_COLOR
    if getattr(mesh.visual, "vertex_colors", None) is not None and len(mesh.visual.vertex_colors):
        mean = np.asarray(mesh.visual.vertex_colors, dtype=np.float64).mean(axis=0) / 255.0
        color = (float(mean[0]), float(mean[1]), float(mean[2]), 1.0)
    mesh.visual = trimesh.visual.TextureVisuals(material=_rough_material(trimesh, color))

    metrics = mesh_metrics(mesh.vertices)
    triangles = int(len(mesh.faces))
    glb_path = out_dir / f"{args.name}.glb"
    mesh.export(glb_path)
    glb_bytes = glb_path.stat().st_size
    export_state = inspect_glb(glb_path)
    validate_contract(
        metrics, triangles, export_state["materials"], glb_bytes,
        args.height, args.max_radius,
        textures=export_state["textures"], images=export_state["images"],
        alpha_modes=export_state["alphaModes"],
    )

    try:
        simplify_version = importlib.metadata.version("fast-simplification")
    except importlib.metadata.PackageNotFoundError:
        simplify_version = None
    sidecar = {
        "input": {"file": Path(args.raw).name, "faces": source_faces},
        "output": {
            "file": glb_path.name,
            "bytes": glb_bytes,
            "triangles": triangles,
            "materials": export_state["materials"],
            "textures": export_state["textures"],
            "images": export_state["images"],
            "alphaModes": export_state["alphaModes"],
            "extensionsUsed": export_state["extensionsUsed"],
            "sha256": _sha256(glb_path),
        },
        "transform": {"uniformScale": scale, "nominalHeight": args.height},
        "metrics": metrics,
        "material": {"baseColor": list(color), "metallic": 0.0, "roughness": 0.95,
                     "textures": export_state["textures"]},
        "manualChecks": [
            "forward is +Z, not the back face",
            "no baked hard shadow or ambient occlusion",
            "no transparent or effect faces",
        ],
        "runtime": {
            "python": sys.version.split()[0],
            "trimesh": trimesh.__version__,
            "fastSimplification": simplify_version,
            "command": _command_label(sys.argv),
        },
    }
    (out_dir / "postprocess.json").write_text(json.dumps(sidecar, indent=1), encoding="utf-8")
    print(json.dumps({
        "glb": str(glb_path), "triangles": triangles, "bytes": glb_bytes,
        "materials": export_state["materials"], "textures": export_state["textures"],
    }))


def _sha256(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _command_label(argv):
    """Keep the recorded command free of absolute host paths."""
    parts = []
    for index, raw in enumerate(argv):
        path = Path(raw)
        if index == 0:
            parts.append(path.name)
        elif path.is_absolute():
            parts.append(path.name)
        else:
            parts.append(raw)
    return " ".join(parts)


if __name__ == "__main__":
    main()
