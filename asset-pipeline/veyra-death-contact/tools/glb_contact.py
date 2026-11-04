"""Deterministic CPU contact sampling for the Veyra runtime GLBs.

This module reads a self-contained glTF 2.0 binary (GLB), evaluates the
15-bone skin at arbitrary clip times with linear blend skinning, and reports
the lowest world-space Y of the body, each foot and the focus prop.  It is a
file-processing tool: no Blender, browser, GPU, network or system clock.

The Veyra export uses +Y as up and puts the ground plane at Y = 0.  The
contact contract in this task is expressed in that same space.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

COMPONENT = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

# The source recipe creates the focus from rod/plate/rings calls assigned to
# Hand_L (shaft, wrap, branches, leaves, seeds) and Hand_R (casting bracer).
# The generic body/gauntlet islands are authored in the dark/steel materials.
FOCUS_MATERIALS = {"battle-wood", "battle-focus"}
HAND_MATERIALS = {"battle-gold"}
TEAM_PREFIXES = ("battle-teal", "battle-rust")


class ContactError(Exception):
    """Raised for a missing/invalid input or an impossible threshold."""


# ---------------------------------------------------------------------------
# GLB container and accessors
# ---------------------------------------------------------------------------


class Glb:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if not self.path.is_file():
            raise ContactError(f"missing GLB: {self.path}")
        raw = self.path.read_bytes()
        if len(raw) < 12:
            raise ContactError(f"truncated GLB header: {self.path}")
        self.raw = raw
        magic, version, length = struct.unpack_from("<III", raw, 0)
        if magic != GLB_MAGIC or version != 2:
            raise ContactError(f"not a glTF 2.0 GLB: {self.path}")
        if length != len(raw):
            raise ContactError(f"GLB length mismatch: {self.path}")
        offset = 12
        self.json_bytes = None
        self.bin = b""
        while offset < length:
            if offset + 8 > length:
                raise ContactError(f"truncated GLB chunk: {self.path}")
            chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
            offset += 8
            chunk = raw[offset : offset + chunk_length]
            if len(chunk) != chunk_length:
                raise ContactError(f"truncated GLB chunk data: {self.path}")
            offset += chunk_length
            if chunk_type == CHUNK_JSON:
                self.json_bytes = chunk
            elif chunk_type == CHUNK_BIN:
                self.bin = chunk
        if self.json_bytes is None:
            raise ContactError(f"missing GLB JSON chunk: {self.path}")
        try:
            self.json = json.loads(self.json_bytes.decode("utf-8").rstrip("\x00 "))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContactError(f"invalid GLB JSON: {self.path}: {exc}") from exc
        self._accessor_cache = {}

    def accessor(self, index: int):
        cached = self._accessor_cache.get(index)
        if cached is not None:
            return cached
        try:
            acc = self.json["accessors"][index]
        except (KeyError, IndexError) as exc:
            raise ContactError(f"bad accessor index {index}") from exc
        if "bufferView" not in acc:
            raise ContactError(f"accessor {index} has no bufferView")
        try:
            view = self.json["bufferViews"][acc["bufferView"]]
        except (KeyError, IndexError) as exc:
            raise ContactError(f"bad bufferView for accessor {index}") from exc
        component_type = acc["componentType"]
        if component_type not in COMPONENT:
            raise ContactError(f"unsupported componentType {component_type}")
        fmt, size = COMPONENT[component_type]
        ncomp = NCOMP[acc["type"]]
        count = acc["count"]
        if view.get("buffer", 0) != 0:
            raise ContactError("only the embedded GLB buffer is supported")
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride", size * ncomp)
        end = start + stride * (count - 1) + size * ncomp
        if start < 0 or end > len(self.bin):
            raise ContactError(f"accessor {index} exceeds the binary chunk")
        values = []
        for item in range(count):
            values.append(
                struct.unpack_from("<" + fmt * ncomp, self.bin, start + item * stride)
            )
        if acc.get("normalized", False):
            denom = {5121: 255.0, 5123: 65535.0}.get(component_type)
            if denom:
                values = [tuple(component / denom for component in row) for row in values]
        self._accessor_cache[index] = values
        return values


# ---------------------------------------------------------------------------
# Mathematics
# ---------------------------------------------------------------------------


def identity():
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat_mul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def mat_vec(a, v):
    x, y, z, w = v
    return (
        a[0][0] * x + a[0][1] * y + a[0][2] * z + a[0][3] * w,
        a[1][0] * x + a[1][1] * y + a[1][2] * z + a[1][3] * w,
        a[2][0] * x + a[2][1] * y + a[2][2] * z + a[2][3] * w,
        a[3][0] * x + a[3][1] * y + a[3][2] * z + a[3][3] * w,
    )


def quat_to_matrix(q):
    x, y, z, w = q
    length = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / length, y / length, z / length, w / length
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0.0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0.0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def node_local(node):
    t = node.get("translation", [0.0, 0.0, 0.0])
    q = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = node.get("scale", [1.0, 1.0, 1.0])
    m = quat_to_matrix(q)
    for r in range(3):
        for c in range(3):
            m[r][c] *= s[c]
        m[r][3] = t[r]
    return m


def _slerp(q0, q1, a):
    q0 = list(q0)
    q1 = list(q1)
    dot = sum(x * y for x, y in zip(q0, q1))
    if dot < 0.0:
        q1 = [-x for x in q1]
        dot = -dot
    if dot > 0.9995:
        out = [q0[i] + a * (q1[i] - q0[i]) for i in range(4)]
        length = math.sqrt(sum(x * x for x in out)) or 1.0
        return [x / length for x in out]
    theta = math.acos(max(-1.0, min(1.0, dot)))
    sin_theta = math.sin(theta)
    if sin_theta == 0.0:
        return list(q0)
    w0 = math.sin((1.0 - a) * theta) / sin_theta
    w1 = math.sin(a * theta) / sin_theta
    return [w0 * q0[i] + w1 * q1[i] for i in range(4)]


def _sample(times, values, t, interpolation, is_rotation):
    if t <= times[0]:
        return list(values[0])
    if t >= times[-1]:
        return list(values[-1])
    lo = 0
    hi = len(times) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if times[mid] <= t:
            lo = mid
        else:
            hi = mid
    if interpolation == "STEP":
        return list(values[lo])
    span = times[hi] - times[lo]
    a = 0.0 if span == 0.0 else (t - times[lo]) / span
    if is_rotation:
        return _slerp(values[lo], values[hi], a)
    return [values[lo][i] * (1.0 - a) + values[hi][i] * a for i in range(len(values[lo]))]


# ---------------------------------------------------------------------------
# Asset evaluation
# ---------------------------------------------------------------------------


class Asset:
    def __init__(self, path: str | Path):
        self.glb = Glb(path)
        self.path = str(path)
        self.json = self.glb.json
        self.nodes = self.json.get("nodes", [])
        if not self.nodes:
            raise ContactError(f"GLB has no nodes: {path}")
        self.node_names = [node.get("name", f"node{index}") for index, node in enumerate(self.nodes)]
        self.parent = {}
        for index, node in enumerate(self.nodes):
            for child in node.get("children", []):
                self.parent[child] = index
        self.roots = [index for index in range(len(self.nodes)) if index not in self.parent]
        if not self.json.get("skins"):
            raise ContactError(f"GLB has no skin: {path}")
        self.skin = self.json["skins"][0]
        self.joint_nodes = list(self.skin["joints"])
        self.joint_names = [self.node_names[index] for index in self.joint_nodes]
        self.inverse_bind = self._inverse_bind_matrices()
        self._primitive_cache = None

    def _inverse_bind_matrices(self):
        if "inverseBindMatrices" not in self.skin:
            raise ContactError("skin has no inverseBindMatrices")
        rows = self.glb.accessor(self.skin["inverseBindMatrices"])
        if len(rows) != len(self.joint_nodes):
            raise ContactError("inverseBindMatrices count does not match joints")
        # glTF matrices are column-major; convert to row-major.
        return [
            [[row[c * 4 + r] for c in range(4)] for r in range(4)]
            for row in rows
        ]

    # -- mesh ------------------------------------------------------------
    def primitives(self):
        if self._primitive_cache is not None:
            return self._primitive_cache
        meshes = self.json.get("meshes", [])
        mesh_nodes = [node for node in self.nodes if "mesh" in node and "skin" in node]
        if not mesh_nodes:
            raise ContactError(f"GLB has no skinned mesh: {self.path}")
        node = mesh_nodes[0]
        result = []
        for primitive in meshes[node["mesh"]]["primitives"]:
            attributes = primitive["attributes"]
            for required in ("POSITION", "JOINTS_0", "WEIGHTS_0"):
                if required not in attributes:
                    raise ContactError(f"primitive missing {required}")
            material_index = primitive.get("material")
            material = (
                self.json["materials"][material_index].get("name", f"material{material_index}")
                if material_index is not None
                else ""
            )
            positions = self.glb.accessor(attributes["POSITION"])
            joints = self.glb.accessor(attributes["JOINTS_0"])
            weights = self.glb.accessor(attributes["WEIGHTS_0"])
            if len(positions) != len(joints) or len(positions) != len(weights):
                raise ContactError("primitive attribute counts differ")
            indices = [row[0] for row in self.glb.accessor(primitive["indices"])]
            result.append(
                {
                    "material": material,
                    "positions": positions,
                    "joints": joints,
                    "weights": weights,
                    "indices": indices,
                }
            )
        self._primitive_cache = result
        return result

    # -- animation -------------------------------------------------------
    def find_clip(self, name: str):
        for animation in self.json.get("animations", []):
            if animation.get("name") == name:
                return animation
        raise ContactError(f"GLB has no animation {name!r}: {self.path}")

    def clip_times(self, name: str):
        animation = self.find_clip(name)
        times = []
        for channel in animation["channels"]:
            sampler = animation["samplers"][channel["sampler"]]
            values = self.glb.accessor(sampler["input"])
            times.extend(row[0] for row in values)
        if not times:
            raise ContactError(f"animation {name!r} has no samples")
        return min(times), max(times), len(self.glb.accessor(animation["samplers"][0]["input"]))

    def pose(self, clip: str, t: float):
        state = {}
        for index, node in enumerate(self.nodes):
            state[index] = {
                "translation": list(node.get("translation", [0.0, 0.0, 0.0])),
                "rotation": list(node.get("rotation", [0.0, 0.0, 0.0, 1.0])),
                "scale": list(node.get("scale", [1.0, 1.0, 1.0])),
            }
        animation = self.find_clip(clip)
        for channel in animation["channels"]:
            target = channel["target"]
            node = target["node"]
            path = target["path"]
            sampler = animation["samplers"][channel["sampler"]]
            times = [row[0] for row in self.glb.accessor(sampler["input"])]
            values = self.glb.accessor(sampler["output"])
            interpolation = sampler.get("interpolation", "LINEAR")
            if path in ("translation", "scale", "rotation"):
                state[node][path] = _sample(
                    times, values, t, interpolation, path == "rotation"
                )
        world = {}

        def visit(index, parent):
            matrix = mat_mul(parent, node_local(state[index]))
            world[index] = matrix
            for child in self.nodes[index].get("children", []):
                visit(child, matrix)

        for root in self.roots:
            visit(root, identity())
        return world

    def skinned(self, clip: str, t: float):
        return self._apply_skin(self.pose(clip, t))

    def rest_skinned(self):
        """Skin using the node rest transforms (no animation channel)."""
        world = {}

        def visit(index, parent):
            matrix = mat_mul(parent, node_local(self.nodes[index]))
            world[index] = matrix
            for child in self.nodes[index].get("children", []):
                visit(child, matrix)

        for root in self.roots:
            visit(root, identity())
        return self._apply_skin(world)

    def _apply_skin(self, world):
        skin_matrices = [
            mat_mul(world[joint], self.inverse_bind[index])
            for index, joint in enumerate(self.joint_nodes)
        ]
        result = []
        for primitive in self.primitives():
            positions = primitive["positions"]
            joints = primitive["joints"]
            weights = primitive["weights"]
            output = []
            for index, position in enumerate(positions):
                x, y, z = position
                px = (x, y, z, 1.0)
                rx = ry = rz = 0.0
                for influence in range(4):
                    weight = weights[index][influence]
                    if weight == 0.0:
                        continue
                    matrix = skin_matrices[joints[index][influence]]
                    vx, vy, vz, _ = mat_vec(matrix, px)
                    rx += vx * weight
                    ry += vy * weight
                    rz += vz * weight
                output.append((rx, ry, rz))
            result.append(output)
        return result

    # -- classification --------------------------------------------------
    def vertex_classes(self):
        """Return per-primitive (is_foot, is_weapon, dominant_name, side) lists."""
        cached = getattr(self, "_class_cache", None)
        if cached is not None:
            return cached
        classes = []
        for primitive in self.primitives():
            material = primitive["material"]
            is_foot = []
            is_weapon = []
            dominant = []
            side = []
            for index, joints in enumerate(primitive["joints"]):
                weights = primitive["weights"][index]
                best = max(range(4), key=lambda slot: weights[slot])
                name = self.joint_names[joints[best]]
                dominant.append(name)
                foot = name in ("Foot_L", "Foot_R")
                is_foot.append(foot)
                side.append(name[-1] if foot else "")
                hand = name in ("Hand_L", "Hand_R")
                if material in FOCUS_MATERIALS:
                    weapon = True
                elif material in HAND_MATERIALS or material.startswith(TEAM_PREFIXES):
                    # The focus prop is held in Hand_L.  Hand_R's gold ring
                    # set is the worn casting bracer, which stays in the body
                    # contact set so a bracer touching the floor cannot be
                    # hidden as "weapon".
                    weapon = name == "Hand_L"
                else:
                    weapon = False
                is_weapon.append(weapon)
            classes.append(
                {
                    "material": material,
                    "foot": is_foot,
                    "weapon": is_weapon,
                    "dominant": dominant,
                    "side": side,
                }
            )
        self._class_cache = classes
        return classes

    def contact(self, clip: str, t: float):
        positions = self.skinned(clip, t)
        classes = self.vertex_classes()
        all_min = math.inf
        body_min = math.inf
        foot_min = math.inf
        foot_min_side = {"L": math.inf, "R": math.inf}
        weapon_min = math.inf
        body_min_bone = None
        foot_min_bone = None
        for part, cls in zip(positions, classes):
            for index, (x, y, z) in enumerate(part):
                if y < all_min:
                    all_min = y
                if cls["weapon"][index]:
                    if y < weapon_min:
                        weapon_min = y
                else:
                    if y < body_min:
                        body_min = y
                        body_min_bone = cls["dominant"][index]
                if cls["foot"][index]:
                    if y < foot_min:
                        foot_min = y
                        foot_min_bone = cls["dominant"][index]
                    side = cls["side"][index]
                    if y < foot_min_side[side]:
                        foot_min_side[side] = y
        return {
            "time": t,
            "allMinY": all_min,
            "bodyMinY": body_min,
            "footMinY": foot_min,
            "footMinLeftY": foot_min_side["L"],
            "footMinRightY": foot_min_side["R"],
            "weaponMinY": weapon_min,
            "bodyMinBone": body_min_bone,
            "footMinBone": foot_min_bone,
        }

    def contact_series(self, clip: str, samples):
        return [self.contact(clip, t) for t in samples]


def frame_times(asset: Asset, clip: str, fps: float = 30.0, half: bool = True):
    """Frame times matching the Blender 1..N export (first key at 1/fps)."""
    start, end, _count = asset.clip_times(clip)
    first_frame = round(start * fps)
    last_frame = round(end * fps)
    if abs(start * fps - first_frame) > 1e-6 or abs(end * fps - last_frame) > 1e-6:
        raise ContactError(f"clip {clip!r} is not aligned to {fps} fps")
    times = []
    for frame in range(first_frame, last_frame + 1):
        times.append((frame / fps, frame))
        if half and frame < last_frame:
            times.append(((frame + 0.5) / fps, frame + 0.5))
    return times


# ---------------------------------------------------------------------------
# Root-offset candidate generation
# ---------------------------------------------------------------------------


def _find_root_translation(asset: Asset, clip: str, node_name: str = "Root"):
    animation = asset.find_clip(clip)
    try:
        node_index = asset.node_names.index(node_name)
    except ValueError as exc:
        raise ContactError(f"GLB has no node named {node_name!r}") from exc
    for channel in animation["channels"]:
        target = channel["target"]
        if target["node"] == node_index and target["path"] == "translation":
            sampler = animation["samplers"][channel["sampler"]]
            return target["node"], sampler
    raise ContactError(f"clip {clip!r} has no {node_name} translation channel")


def root_offsets(asset: Asset, clip: str = "death", node_name: str = "Root", zero_from_frame: int = 18):
    """Per-key root-Y lift that keeps the lowest body vertex on the ground.

    The lift mirrors the baseline penetration: feet already in contact stay in
    contact, no vertex is lowered, and the first/last keys are left untouched.
    """
    node, sampler = _find_root_translation(asset, clip, node_name)
    input_rows = asset.glb.accessor(sampler["input"])
    output_rows = asset.glb.accessor(sampler["output"])
    fps = 30.0
    offsets = []
    details = []
    for key_index, (time_row, output_row) in enumerate(zip(input_rows, output_rows)):
        t = time_row[0]
        body_min = asset.contact(clip, t)["bodyMinY"]
        offset = max(0.0, -body_min)
        frame = round(t * fps)
        if frame <= 1 or frame >= zero_from_frame:
            offset = 0.0
        offsets.append(offset)
        details.append(
            {"key": key_index, "frame": frame, "time": t, "baseBodyMinY": body_min, "offsetY": offset}
        )
    return offsets, details


def _accessor_byte_layout(asset: Asset, accessor_index: int):
    accessor = asset.json["accessors"][accessor_index]
    view = asset.json["bufferViews"][accessor["bufferView"]]
    return view.get("byteOffset", 0) + accessor.get("byteOffset", 0), accessor


def write_patched_glb(asset: Asset, offsets, out_path: str | Path, clip: str = "death"):
    """Write a copy whose only changed bytes are the Root translation Y words.

    JSON and every other binary byte are copied verbatim, so mesh accessors,
    bind matrices, materials, team colours and the other four actions are
    unchanged by construction.
    """
    _node, sampler = _find_root_translation(asset, clip)
    output_accessor = sampler["output"]
    start, accessor = _accessor_byte_layout(asset, output_accessor)
    if accessor["type"] != "VEC3" or accessor["componentType"] != 5126:
        raise ContactError("Root translation output is not float VEC3")
    if len(offsets) != accessor["count"]:
        raise ContactError("offset count does not match Root translation keys")
    binary = bytearray(asset.glb.bin)
    for key, offset in enumerate(offsets):
        position = start + key * 12 + 4
        if position + 4 > len(binary):
            raise ContactError("Root translation write exceeds the binary chunk")
        value = struct.unpack_from("<f", binary, position)[0] + float(offset)
        struct.pack_into("<f", binary, position, value)

    raw = bytearray(asset.glb.raw)
    # Locate the BIN chunk in the original file and replace only its payload.
    offset = 12
    replaced = False
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        header = offset
        data_start = offset + 8
        if chunk_type == CHUNK_BIN:
            if chunk_length != len(binary):
                raise ContactError("BIN chunk length changed")
            raw[data_start : data_start + chunk_length] = binary
            replaced = True
            break
        offset = data_start + chunk_length
    if not replaced:
        raise ContactError("GLB has no BIN chunk to patch")
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(bytes(raw))
    return out


def describe_byte_diff(baseline: Glb, candidate: Glb):
    """Report where two GLBs differ; returns a structured diff summary."""
    if baseline.json_bytes != candidate.json_bytes:
        return {"jsonEqual": False, "binaryDiffBytes": None, "allowed": False}
    first = baseline.bin
    second = candidate.bin
    if len(first) != len(second):
        return {"jsonEqual": True, "binaryDiffBytes": None, "allowed": False}
    diffs = [index for index in range(len(first)) if first[index] != second[index]]
    return {
        "jsonEqual": True,
        "binaryDiffBytes": len(diffs),
        "firstDiff": diffs[0] if diffs else None,
        "lastDiff": diffs[-1] if diffs else None,
        "diffs": diffs,
        "allowed": True,
    }
