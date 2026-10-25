"""Export four original SVG masters through one shared theme recipe."""
import argparse
import io
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET

NAMES = ('targeted', 'displacement', 'persistent-effect', 'control')
ROOT = Path(__file__).resolve().parent


def validate(config):
    if set(config) != {'sizes', 'variants'} or config['sizes'] != [32, 48]:
        raise ValueError('sizes must be [32, 48]; expected sizes and variants')
    variants = config['variants']
    if not isinstance(variants, dict) or set(variants) != {'bright', 'dark'}:
        raise ValueError('expected bright and dark variants')
    for theme in variants.values():
        if not isinstance(theme, dict) or set(theme) != {'ink', 'accent', 'stroke_width', 'preview_background'}:
            raise ValueError('invalid theme fields')
        for key in ('ink', 'accent', 'preview_background'):
            if not isinstance(theme[key], str) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', theme[key]):
                raise ValueError('colors must be six-digit hex')
        width = theme['stroke_width']
        if type(width) not in (int, float) or not 3 <= width <= 5:
            raise ValueError('stroke_width must be between 3 and 5')


def themed(source, theme):
    tree = ET.fromstring(source)
    if tree.attrib.get('viewBox') != '0 0 64 64':
        raise ValueError('master viewBox must be 0 0 64 64')
    return source.replace('#F1F5F9', theme['preview_background']).replace('#15304B', theme['ink']).replace('#086E85', theme['accent']).replace('stroke-width="4"', f'stroke-width="{theme["stroke_width"]}"')


def export(recipe, output):
    # Validate before importing optional render dependencies or creating output.
    config = json.loads(Path(recipe).read_text())
    validate(config)
    import cairosvg
    from PIL import Image, ImageDraw
    output = Path(output)
    sheet = Image.new('RGB', (640, 400), '#CBD5E1')
    draw = ImageDraw.Draw(sheet)
    for row, (variant, theme) in enumerate(config['variants'].items()):
        folder = output / variant
        folder.mkdir(parents=True, exist_ok=True)
        draw.rectangle((0, row * 200, 639, row * 200 + 199), fill=theme['preview_background'])
        draw.text((12, row * 200 + 8), variant + ' / actual pixels: 32, 48', fill=theme['ink'])
        for col, name in enumerate(NAMES):
            svg = themed((ROOT / 'source' / f'{name}.svg').read_text(), theme)
            (folder / f'{name}.svg').write_text(svg)
            for size, y in ((32, 52), (48, 108)):
                data = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
                (folder / f'{name}-{size}.png').write_bytes(data)
                im = Image.open(io.BytesIO(data)).convert('RGBA')
                sheet.paste(im, (col * 160 + (160-size)//2, row * 200 + y), im)
            draw.text((col * 160 + 10, row * 200 + 175), name, fill=theme['ink'])
    sheet.save(output / 'preview.png')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, default=ROOT / 'recipe.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'exported')
    args = parser.parse_args()
    try:
        export(args.recipe, args.output)
    except (ValueError, OSError) as error:
        parser.exit(2, f'export failed: {error}\n')
