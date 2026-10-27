"""Offline, source-locked placement normalizer. Never rewrites meshes, rigs or clips."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def checked_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Input must remain inside the repository")
    return path


def read_glb(data: bytes) -> tuple[dict, bytes]:
    if len(data) < 20:
        raise ValueError("Truncated GLB")
    magic, version, size = struct.unpack_from("<4sII", data)
    if (magic, version, size) != (b"glTF", 2, len(data)):
        raise ValueError("Invalid GLB header")
    chunks = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated chunk header")
        size, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValueError("Invalid chunk length")
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != b"JSON":
        raise ValueError("Missing GLB JSON")
    doc = json.loads(chunks[0][1])
    if any("uri" in item for group in ("buffers", "images") for item in doc.get(group, [])):
        raise ValueError("Standard GLBs must be self-contained")
    binary = next((chunk for kind, chunk in chunks if kind == b"BIN\0"), b"")
    return doc, binary


def times(doc: dict, binary: bytes, accessor_id: int) -> list[float]:
    accessor = doc["accessors"][accessor_id]
    if accessor["componentType"] != 5126 or accessor["type"] != "SCALAR" or "sparse" in accessor:
        raise ValueError("Unsupported animation time accessor")
    view = doc["bufferViews"][accessor["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise ValueError("Unexpected time buffer")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", 4)
    end = start + (accessor["count"] - 1) * stride + 4
    if stride < 4 or end > view.get("byteOffset", 0) + view["byteLength"] or end > len(binary):
        raise ValueError("Animation time accessor out of range")
    values = [struct.unpack_from("<f", binary, start + i * stride)[0] for i in range(accessor["count"])]
    if not values or not all(math.isfinite(x) for x in values) or any(a >= b for a, b in zip(values, values[1:])):
        raise ValueError("Invalid animation time sequence")
    return values


def geometry_summary(data: bytes) -> dict:
    doc, binary = read_glb(data)
    primitives = [p for mesh in doc.get("meshes", []) for p in mesh["primitives"]]
    triangles = 0
    for primitive in primitives:
        if primitive.get("mode", 4) != 4:
            raise ValueError("Expected triangle primitive")
        count = doc["accessors"][primitive["indices"]]["count"] if "indices" in primitive else doc["accessors"][primitive["attributes"]["POSITION"]]["count"]
        if count % 3:
            raise ValueError("Incomplete triangle")
        triangles += count // 3
    clips = {}
    for animation in doc.get("animations", []):
        inputs = [times(doc, binary, sampler["input"]) for sampler in animation["samplers"]]
        clips[animation["name"]] = round(max(max(x) for x in inputs) - min(min(x) for x in inputs), 6)
    return {
        "triangles": triangles,
        "primitives": len(primitives),
        "materials": len(doc.get("materials", [])),
        "skinJointCounts": [len(skin["joints"]) for skin in doc.get("skins", [])],
        "clipsSeconds": clips,
        "images": len(doc.get("images", [])),
        "allOpaque": all(m.get("alphaMode", "OPAQUE") == "OPAQUE" for m in doc.get("materials", [])),
    }


def placement(spec: dict) -> dict:
    # Nominal author height, NOT attack/death AABB: a long weapon must not shrink its owner.
    source = spec["sourceNominalHeight"]
    target = spec["targetNominalHeight"]
    floor = spec["sourceGroundY"]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (source, target, floor)) or source <= 0 or target <= 0:
        raise ValueError("Invalid placement dimensions")
    if spec["up"] != "+Y" or spec["forward"] != "+Z":
        raise ValueError("Unknown source axes: return to source owner, do not guess")
    scale = target / source
    return {"scale": [scale] * 3, "position": [0, -floor * scale, 0], "rotationY": 0,
            "application": "one parent of complete scene, including skeleton; never scale mesh or bones separately"}


def projected_axis_pixels(height: float, viewport_height: int) -> float:
    # Runtime camera offset (0,24,18), vertical FOV 45, subject at focus.
    # This is the vertical world-axis projection, NOT silhouette/animation coverage.
    return round(viewport_height * (.6 * height) / ((30 - .8 * height) * 2 * math.tan(math.pi / 8)), 2)


def build(recipe: dict, root: Path = REPO) -> dict:
    assets = []
    for source in recipe["files"]:
        data = checked_path(root, source["path"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != source["sha256"]:
            raise ValueError(f"Source changed: {source['path']}; inspect and deliberately update the lock")
        if not source["licenseEvidence"]:
            raise ValueError("Missing license evidence")
        for evidence in source["licenseEvidence"]:
            if not checked_path(root, evidence).is_file():
                raise ValueError(f"Missing license file: {evidence}")
        row = {"id": source["id"], "path": source["path"], "sha256": source["sha256"], "bytes": len(data)}
        if source["path"].endswith(".glb"):
            row.update(geometry_summary(data))
            budget = source["budget"]
            if row["triangles"] > budget["triangles"] or row["materials"] > budget["materials"] or len(data) > budget["bytes"]:
                raise ValueError(f"Asset budget exceeded: {source['id']}")
            if not row["allOpaque"]:
                raise ValueError("Unexpected transparency")
            if source.get("clips") and (set(source["clips"]) != set(row["clipsSeconds"]) or row["skinJointCounts"] != [15]):
                raise ValueError("Rig/clip contract changed; do not silently retarget")
            row["placement"] = placement(source["normalization"])
            if source["normalization"]["targetNominalHeight"] > .1:
                row["nominalAxisPixels"] = {str(h): projected_axis_pixels(source["normalization"]["targetNominalHeight"], h) for h in (600, 720)}
        assets.append(row)
    return {"schemaVersion": 1, "status": "engineering-handoff-not-visual-acceptance",
            "sourceCommit": recipe["sourceCommit"], "camera": recipe["camera"],
            "standards": recipe["standards"], "files": assets,
            "totalReferencedBytes": sum(a["bytes"] for a in assets),
            "runtimeMutated": False, "meshRigClipBytesRewritten": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, default=HERE / "standard-set.json")
    parser.add_argument("--output", type=Path, default=HERE / "reports" / "normalized-set.json")
    args = parser.parse_args()
    result = build(json.loads(args.recipe.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Validated {len(result['files'])} locked files; {result['totalReferencedBytes']} bytes. Visual acceptance not run.")


if __name__ == "__main__":
    main()
