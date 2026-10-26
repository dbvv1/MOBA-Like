"""Contract checks for the open-weight rock conditioning image.

Runs with plain Python 3 (no Pillow, torch or SciPy): the committed PNG is
decoded by the same dependency-free reader the inference script uses for its
alpha gate. Regenerating the PNG itself needs the TripoSG environment; see
source/openweight-rock/README.md.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "openweight-rock"))
import png_rgba  # noqa: E402

INPUT = ROOT / "source" / "openweight-rock" / "input" / "rock-cluster.png"


def synthetic(width, height, alpha_fn):
    pixels = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            pixels[i:i + 3] = b"\x80\x80\x80"
            pixels[i + 3] = alpha_fn(x, y)
    return pixels


class InputContract(unittest.TestCase):
    def test_committed_input_contract(self):
        width, height, pixels = png_rgba.read_rgba(INPUT)
        stats = png_rgba.validate_alpha(width, height, pixels)
        self.assertEqual((width, height), (1024, 1024))
        min_x, min_y, max_x, max_y = stats["bbox"]
        box_w, box_h = max_x - min_x + 1, max_y - min_y + 1
        # bbox is the full-alpha (a > 0) box, i.e. the opaque core plus its
        # anti-aliased rim; the inference crop uses the same box.
        self.assertEqual((box_w, box_h), (742, 504))
        self.assertAlmostEqual(stats["coverageRatio"], 0.222, delta=0.005)
        self.assertLess(stats["opaqueRatio"], stats["coverageRatio"])
        # Wide-low cluster, but inside the 2.18:1 envelope implied by the
        # 1.1 m nominal height and the 1.2 m footprint-radius budget.
        self.assertGreaterEqual(box_w / box_h, 1.30)
        self.assertLessEqual(box_w / box_h, 2.18)
        self.assertGreaterEqual(stats["opaqueRatio"], 0.10)
        self.assertLessEqual(stats["opaqueRatio"], 0.45)
        self.assertGreaterEqual(stats["transparentRatio"], 0.40)
        self.assertGreaterEqual(stats["edgeRatio"], 0.002)
        margin = width * 0.05
        self.assertGreaterEqual(min(min_x, min_y, width - 1 - max_x, height - 1 - max_y), margin)

        # Warm grey stone with readable facet shading and no colour-key edges.
        red = green = blue = 0
        luminance = []
        count = 0
        for y in range(0, height, 2):
            for x in range(0, width, 2):
                i = (y * width + x) * 4
                if pixels[i + 3] < 250:
                    continue
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                red += r
                green += g
                blue += b
                luminance.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
                count += 1
        self.assertGreater(count, 1000)
        self.assertGreater(red / count - blue / count, 10.0, "stone must stay warm, not neutral")
        mean = sum(luminance) / len(luminance)
        variance = sum((v - mean) ** 2 for v in luminance) / len(luminance)
        self.assertGreater(variance ** 0.5, 6.0, "facets need visible shading separation")

        # Transparent pixels keep white RGB so a light background cannot fringe.
        for y in range(0, height, 7):
            for x in range(0, width, 7):
                i = (y * width + x) * 4
                if pixels[i + 3] == 0:
                    self.assertEqual(tuple(pixels[i:i + 3]), (255, 255, 255))

    def test_rejects_empty_alpha(self):
        width = height = 64
        with self.assertRaisesRegex(ValueError, "no opaque foreground"):
            png_rgba.validate_alpha(width, height, synthetic(width, height, lambda x, y: 0))

    def test_rejects_fully_opaque_alpha(self):
        width = height = 64
        with self.assertRaisesRegex(ValueError, "background removal is disabled"):
            png_rgba.validate_alpha(width, height, synthetic(width, height, lambda x, y: 255))

    def test_rejects_tiny_foreground(self):
        width = height = 64
        with self.assertRaises(ValueError):
            png_rgba.validate_alpha(
                width,
                height,
                synthetic(width, height, lambda x, y: 255 if 10 <= x < 18 and 10 <= y < 18 else 0),
            )

    def test_rejects_non_png(self):
        with self.assertRaises(png_rgba.PngError):
            png_rgba.read_rgba(ROOT / "manifest.json")


if __name__ == "__main__":
    unittest.main()
