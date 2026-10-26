"""Dependency-free 8-bit RGBA PNG reader and alpha-contract checks.

This module is the single place that decides whether a conditioning image has a
usable alpha matte. It is deliberately free of PIL/torch so the contract can be
tested on a machine that cannot run the generator (see
``asset-pipeline/battle/tests/test_openweight_input.py``).

Only colour type 6 (RGBA), bit depth 8, non-interlaced PNGs are accepted. That
is what the committed input is; anything else is rejected instead of being
guessed at.
"""
import struct
import zlib


class PngError(ValueError):
    pass


def _chunks(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise PngError("not a PNG file")
    pos = 8
    while pos + 8 <= len(data):
        length, kind = struct.unpack_from(">I4s", data, pos)
        body = data[pos + 8:pos + 8 + length]
        if len(body) != length:
            raise PngError(f"truncated PNG chunk {kind!r}")
        yield kind, body
        pos += 12 + length
        if kind == b"IEND":
            return


def read_rgba(path):
    """Return (width, height, bytearray RGBA) for an 8-bit non-interlaced PNG."""
    with open(path, "rb") as handle:
        data = handle.read()
    header = None
    compressed = bytearray()
    for kind, body in _chunks(data):
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            compressed += body
        elif kind == b"IEND":
            break
    if header is None:
        raise PngError("PNG has no IHDR chunk")
    width, height, depth, colour, compression, filtering, interlace = header
    if depth != 8 or colour != 6:
        raise PngError(f"expected 8-bit RGBA (colour type 6), got depth {depth} type {colour}")
    if compression != 0 or filtering != 0:
        raise PngError("unsupported PNG compression/filter method")
    if interlace != 0:
        raise PngError("interlaced PNG is not supported")
    raw = zlib.decompress(bytes(compressed))
    stride = width * 4
    if len(raw) != (stride + 1) * height:
        raise PngError("PNG data length does not match IHDR")
    out = bytearray(stride * height)
    previous = bytearray(stride)
    pos = 0
    for row in range(height):
        method = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if method == 1:  # Sub
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif method == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif method == 3:  # Average
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif method == 4:  # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = previous[i]
                c = previous[i - 4] if i >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + predictor) & 0xFF
        elif method != 0:
            raise PngError(f"unknown PNG filter type {method}")
        out[row * stride:(row + 1) * stride] = line
        previous = line
    return width, height, out


def alpha_stats(width, height, rgba):
    """Summarise the alpha matte without interpreting any colour.

    Two boxes are reported. ``bbox`` covers every pixel with ``a > 0`` and is
    the one used for cropping and for the reported footprint: the matte
    contract treats the anti-aliased rim as foreground, so cropping to the
    fully opaque core would silently discard it. ``opaqueBbox`` covers only
    ``a == 255`` and is informational.
    """
    opaque = transparent = edge = 0
    min_x, min_y, max_x, max_y = width, height, -1, -1
    o_min_x, o_min_y, o_max_x, o_max_y = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            a = rgba[row + x * 4 + 3]
            if a != 0:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
                if a == 255:
                    opaque += 1
                    if x < o_min_x:
                        o_min_x = x
                    if x > o_max_x:
                        o_max_x = x
                    if y < o_min_y:
                        o_min_y = y
                    if y > o_max_y:
                        o_max_y = y
                else:
                    edge += 1
            else:
                transparent += 1
    total = width * height
    bbox = None
    if max_x >= 0:
        bbox = (min_x, min_y, max_x, max_y)
    opaque_bbox = None
    if o_max_x >= 0:
        opaque_bbox = (o_min_x, o_min_y, o_max_x, o_max_y)
    return {
        "width": width,
        "height": height,
        "opaque": opaque,
        "transparent": transparent,
        "edge": edge,
        "opaqueRatio": opaque / total,
        "transparentRatio": transparent / total,
        "edgeRatio": edge / total,
        # Foreground according to the matte contract: the opaque core plus its
        # anti-aliased rim.
        "coverageRatio": (opaque + edge) / total,
        "bbox": bbox,
        "opaqueBbox": opaque_bbox,
    }


def validate_alpha(width, height, rgba):
    """Return stats or raise ValueError with an explicit, actionable reason.

    Background removal is intentionally not part of this pipeline. An image
    without a real matte is rejected rather than handed to a segmentation
    model; a fully opaque or empty alpha must never be silently repaired.
    """
    if width < 64 or height < 64:
        raise ValueError(f"conditioning image is too small: {width}x{height}")
    stats = alpha_stats(width, height, rgba)
    if stats["opaqueRatio"] < 0.03:
        raise ValueError("alpha has no opaque foreground (opaque ratio < 3%)")
    if stats["transparentRatio"] < 0.05:
        raise ValueError(
            "alpha is effectively fully opaque; supply a real alpha matte "
            "(background removal is disabled in this pipeline)"
        )
    if stats["edgeRatio"] < 0.001:
        raise ValueError("alpha has no anti-aliased edge; the matte looks like a hard mask")
    min_x, min_y, max_x, max_y = stats["bbox"]
    if max_x - min_x < 16 or max_y - min_y < 16:
        raise ValueError("alpha foreground bounding box is too small")
    if (max_x - min_x + 1) * (max_y - min_y + 1) < 0.05 * width * height:
        raise ValueError("alpha foreground covers too little area")
    return stats
