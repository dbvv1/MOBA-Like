"""Render the image-to-3D conditioning image for the open-weight rock candidate.

The image is an original, deterministic flat-shaded render of three low, unequal
rock masses with large cut facets, a few hairline cracks, warm-grey stone and
sparse dark-green moss. It has a real alpha channel (the background is not a
baked colour key), one object only, no text, no glow, no flags and no cast
shadow. It is the input to ``tools/openweight-rock/run_triposg.py``; it is not
a game asset and is never loaded by the renderer.

The cluster is kept near 1.47:1 width-to-height so that, after the mesh is scaled
to the required 1.1 m nominal height, its footprint can still fit the 1.2 m
radius budget.

Requires NumPy, Pillow and SciPy explicitly; model inference is not needed. The committed PNG is
authoritative; this script explains how it was made.

Run:
    python asset-pipeline/battle/source/openweight-rock/input/make_input.py \
        --out asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png
"""
import argparse
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw
from scipy.spatial import ConvexHull

# Wide-low cluster, near 1.47:1: three masses of unequal height meeting at the feet.
# (centre x, centre z, footprint radius, height)
MASSES = [
    (-0.38, 0.06, 0.32, 0.44),
    (0.02, -0.04, 0.40, 0.66),
    (0.40, 0.07, 0.30, 0.50),
]
STONE = (138, 128, 112)
MOSS = (58, 78, 50)
LIGHT = np.array([-0.45, 0.82, 0.35], dtype=np.float64)
LIGHT /= np.linalg.norm(LIGHT)


def mass_points(rng, cx, cz, radius, height):
    """Deterministic hull points: faceted crown, flat base at y=0."""
    pts = []
    for i in range(16):  # Smooth base ring keeps the ground contact readable.
        a = i * math.tau / 16 + rng.uniform(-0.03, 0.03)
        r = radius * rng.uniform(0.97, 1.0)
        pts.append((cx + r * math.cos(a), 0.0, cz + r * math.sin(a)))
    for ring, (radius_k, height_k, count) in enumerate(
        [(0.92, 0.38, 8), (0.62, 0.72, 7), (0.24, 1.0, 4)]
    ):
        for i in range(count):
            a = i * math.tau / count + rng.uniform(-0.22, 0.22) + ring * 0.31
            r = radius * radius_k * rng.uniform(0.80, 1.12)
            y = height * height_k * rng.uniform(0.86, 1.10)
            pts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
    pts.append(  # One dominant peak per mass, offset so silhouettes differ.
        (cx + rng.uniform(-0.12, 0.12) * radius, height, cz + rng.uniform(-0.12, 0.12) * radius)
    )
    return np.asarray(pts, dtype=np.float64)


def project(points, yaw, pitch):
    """Orthographic 3/4 view. Returns screen-x, screen-up and camera depth."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    ce, se = math.cos(pitch), math.sin(pitch)
    out = []
    for x, y, z in points:
        xr = x * ca - z * sa
        zr = x * sa + z * ca
        out.append((xr, y * ce - zr * se, y * se + zr * ce))
    return out


def render(size, seed, supersample=3):
    rng = random.Random(seed)
    work = size * supersample
    image = Image.new("RGBA", (work, work), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)

    yaw, pitch = math.radians(28), math.radians(16)
    hulls = []
    for cx, cz, radius, height in MASSES:
        pts = mass_points(rng, cx, cz, radius, height)
        hull = ConvexHull(pts)
        hulls.append((pts, hull))

    all_pts = np.concatenate([p for p, _ in hulls], axis=0)
    proj = project(all_pts, yaw, pitch)
    xs = [p[0] for p in proj]
    ys = [p[1] for p in proj]
    span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
    scale = 0.72 * work / max(span_x, span_y)
    offset = (
        work / 2 - (min(xs) + max(xs)) / 2 * scale,
        work / 2 + (min(ys) + max(ys)) / 2 * scale,
    )

    def to_screen(p):
        x, y_up, depth = p
        return (x * scale + offset[0], offset[1] - y_up * scale, depth)

    # Unit vector from the cluster toward the camera; back faces are culled so
    # each convex mass renders its own front shell without painter overlap.
    view_dir = np.array(
        [
            math.sin(yaw) * math.cos(pitch),
            math.sin(pitch),
            math.cos(yaw) * math.cos(pitch),
        ]
    )
    faces = []
    for pts, hull in hulls:
        # ConvexHull.equations rows are outward face normals in simplex order.
        for simplex, equation in zip(hull.simplices, hull.equations):
            normal = equation[:3]
            if normal[1] < 0.05 or float(np.dot(normal, view_dir)) <= 0.02:
                continue  # underside or back face: never visible from this camera
            tri = pts[simplex]
            pp = [to_screen(p) for p in project(tri, yaw, pitch)]
            depth = sum(p[2] for p in pp) / 3.0
            faces.append((depth, [(p[0], p[1]) for p in pp], normal))
    faces.sort(key=lambda f: f[0])  # painter's algorithm: far faces first

    for _, poly, normal in faces:
        lambert = max(0.0, float(np.dot(normal, LIGHT)))
        shade = 0.58 + 0.42 * lambert
        tint = 1.0 + 0.035 * (normal[0] * 0.6 + normal[2] * 0.4)
        rgb = tuple(
            int(max(0, min(255, c * shade * tint + 12 * lambert))) for c in STONE
        )
        draw.polygon(poly, fill=rgb + (255,))

    image = image.resize((size, size), Image.LANCZOS)
    alpha = image.getchannel("A")
    silhouette = alpha.point(lambda v: 255 if v > 250 else 0)

    # Moss and cracks are painted only inside the existing alpha so the
    # conditioning silhouette stays clean.
    moss_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    moss_draw = ImageDraw.Draw(moss_layer)
    mrng = random.Random(seed + 7)
    for _ in range(26):
        x = mrng.randint(int(size * 0.16), int(size * 0.84))
        y = mrng.randint(int(size * 0.42), int(size * 0.86))
        if alpha.getpixel((x, y)) < 250:
            continue
        rw, rh = mrng.randint(3, 9), mrng.randint(2, 5)
        moss_draw.ellipse(
            (x - rw, y - rh, x + rw, y + rh),
            fill=MOSS + (mrng.randint(55, 95),),
        )
    moss_layer.putalpha(ImageChops.multiply(moss_layer.getchannel("A"), silhouette))
    image = Image.alpha_composite(image, moss_layer)

    crack_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    crack_draw = ImageDraw.Draw(crack_layer)
    crng = random.Random(seed + 11)
    for _ in range(5):
        x = crng.randint(int(size * 0.22), int(size * 0.78))
        y = crng.randint(int(size * 0.30), int(size * 0.72))
        points = [(x, y)]
        for _ in range(crng.randint(2, 4)):
            x += crng.randint(-42, 42)
            y += crng.randint(10, 38)
            points.append((x, y))
        crack_draw.line(points, fill=(64, 58, 50, 170), width=max(1, size // 512))
    crack_layer.putalpha(ImageChops.multiply(crack_layer.getchannel("A"), silhouette))
    image = Image.alpha_composite(image, crack_layer)

    # Transparent pixels carry white RGB so compositing over a light
    # background cannot produce dark fringes from uninitialised colour.
    px = image.load()
    for y in range(size):
        for x in range(size):
            if px[x, y][3] == 0:
                px[x, y] = (255, 255, 255, 0)
    return image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=20261026)
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    render(args.size, args.seed).save(out, format="PNG", optimize=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
