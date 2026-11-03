"""Export editable SVG masters through one shared theme recipe."""
import argparse
from contextlib import contextmanager
import io
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
import xml.etree.ElementTree as ET

NAMES = ('targeted', 'displacement', 'persistent-effect', 'control', 'directional-projectile', 'self-shield')
ROOT = Path(__file__).resolve().parent


def validate(config):
    if not isinstance(config, dict) or set(config) != {'sizes', 'variants'} or config['sizes'] != [32, 48]:
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


@contextmanager
def output_batch(output, recipe):
    """Stage one family; roll back ordinary rename errors, not power loss."""
    requested = Path(output).absolute()
    if any(p.is_symlink() for p in (requested, *requested.parents)):
        raise ValueError('output cannot contain symlinks')
    target = requested.resolve()
    source = ROOT.resolve() / 'source'
    if (ROOT.resolve().is_relative_to(target) or target.is_relative_to(source)
            or Path(recipe).resolve().is_relative_to(target)):
        raise ValueError('output cannot replace authoring inputs')
    if not target.parent.is_dir():
        raise ValueError('output parent must already exist')
    if target.exists() and not target.is_dir():
        raise ValueError('output must be a directory')
    lock = target.with_name(f'.{target.name}.export-lock')
    backup = target.with_name(f'.{target.name}.export-backup')
    if backup.exists() or backup.is_symlink():
        raise RuntimeError(f'backup exists: {backup}; inspect before retrying')
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise RuntimeError(f'export lock exists: {lock}; another or interrupted export owns it') from error
    stage = None
    keep_recovery = False
    expected = ['preview.png'] + [
        f'{variant}/{name}{suffix}' for variant in ('bright', 'dark')
        for name in NAMES for suffix in ('.svg', '-32.png', '-48.png')
    ]
    try:
        if target.exists() and any(p.is_symlink() for p in target.rglob('*')):
            raise ValueError('output contents cannot contain symlinks')
        stage = Path(tempfile.mkdtemp(prefix=f'.{target.name}.export-', dir=target.parent))
        if target.exists():
            shutil.copytree(target, stage, dirs_exist_ok=True)
        for name in expected:
            path = stage / name
            if path.exists():
                if not path.is_file():
                    raise ValueError(f'generated output is not a regular file: {name}')
                path.unlink()
        yield stage
        for name in expected:
            path = stage / name
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f'missing generated output: {name}')
        had_target = target.exists()
        if had_target:
            os.replace(target, backup)
        try:
            os.replace(stage, target)
            stage = None
        except BaseException:
            if had_target:
                try:
                    os.replace(backup, target)
                except BaseException as error:
                    keep_recovery = True
                    raise RuntimeError(f'publication and rollback failed; preserve {lock}, {backup} and {stage}') from error
            raise
        if had_target:
            try:
                shutil.rmtree(backup)
            except OSError as error:
                keep_recovery = True
                raise RuntimeError(f'new batch committed to {target}, but backup cleanup failed; inspect {backup} and {lock}') from error
    finally:
        if not keep_recovery:
            if stage is not None:
                shutil.rmtree(stage)
            lock.rmdir()


def export(recipe, output):
    config = json.loads(Path(recipe).read_text(encoding='utf-8'))
    validate(config)
    with output_batch(output, recipe) as stage:
        render(config, stage)


def render(config, output):
    import cairosvg
    from PIL import Image, ImageDraw
    width=160*len(NAMES)
    sheet = Image.new('RGB', (width, 400), '#CBD5E1')
    draw = ImageDraw.Draw(sheet)
    for row, (variant, theme) in enumerate(config['variants'].items()):
        folder = output / variant
        folder.mkdir(parents=True, exist_ok=True)
        draw.rectangle((0, row * 200, width-1, row * 200 + 199), fill=theme['preview_background'])
        draw.text((12, row * 200 + 8), variant + ' / actual pixels: 32, 48', fill=theme['ink'])
        for col, name in enumerate(NAMES):
            svg = themed((ROOT / 'source' / f'{name}.svg').read_text(encoding='utf-8'), theme)
            (folder / f'{name}.svg').write_text(svg, encoding='utf-8')
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
    except (ValueError, OSError, ET.ParseError, RuntimeError) as error:
        parser.exit(2, f'export failed: {error}\n')
