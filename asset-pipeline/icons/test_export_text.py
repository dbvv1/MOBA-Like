"""Text-only export regressions; these need neither CairoSVG nor system Cairo."""
import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
import export


def load_recipe():
    return json.loads((export.ROOT / 'recipe.json').read_text(encoding='utf-8'))


def source_text(name):
    return (export.ROOT / 'source' / f'{name}.svg').read_text(encoding='utf-8')


def write_svg_family(config, output):
    for variant, theme in config['variants'].items():
        folder = Path(output) / variant
        folder.mkdir(parents=True, exist_ok=True)
        for name in export.NAMES:
            svg = export.themed(source_text(name), theme)
            export.write_text_utf8_lf(folder / f'{name}.svg', svg)


class TextExportTest(unittest.TestCase):
    def test_render_routes_svg_text_through_lf_writer(self):
        self.assertIn('write_text_utf8_lf', export.render.__code__.co_names)
        self.assertNotIn('write_text', export.render.__code__.co_names)

    def test_windows_default_newline_rule_would_emit_crlf(self):
        """Path.write_text(newline=None) translates to os.linesep; simulate the Windows rule."""
        config = load_recipe()
        svg = export.themed(source_text('targeted'), config['variants']['bright'])
        self.assertIn('\n', svg)
        buffer = io.BytesIO()
        writer = io.TextIOWrapper(buffer, encoding='utf-8', newline='\r\n')
        writer.write(svg)
        writer.flush()
        legacy = buffer.getvalue()
        writer.detach()
        self.assertIn(b'\r\n', legacy)
        self.assertNotEqual(legacy, svg.encode('utf-8'))
        if os.linesep == '\r\n':
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / 'probe' / 'targeted.svg'
                path.parent.mkdir(parents=True)
                path.write_text(svg, encoding='utf-8')
                self.assertEqual(path.read_bytes(), legacy)
                for variant, theme in config['variants'].items():
                    for name in export.NAMES:
                        text = export.themed(source_text(name), theme)
                        target = root / variant / f'{name}.svg'
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(text, encoding='utf-8')
                        data = target.read_bytes()
                        self.assertIn(b'\r\n', data)
                        self.assertNotEqual(
                            data, (export.ROOT / 'exported' / variant / f'{name}.svg').read_bytes())

    def test_explicit_lf_writer_matches_source_encoded_bytes(self):
        config = load_recipe()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_svg_family(config, root)
            for variant, theme in config['variants'].items():
                for name in export.NAMES:
                    svg = export.themed(source_text(name), theme)
                    data = (root / variant / f'{name}.svg').read_bytes()
                    self.assertEqual(data, svg.encode('utf-8'))
                    self.assertNotIn(b'\r', data)

    def test_committed_consumer_bytes_match_both_themes(self):
        config = load_recipe()
        for variant, theme in config['variants'].items():
            for name in export.NAMES:
                expected = export.themed(source_text(name), theme).encode('utf-8')
                committed = (export.ROOT / 'exported' / variant / f'{name}.svg').read_bytes()
                self.assertEqual(expected, committed)
                self.assertNotIn(b'\r\n', committed)

    def test_dark_accent_edit_changes_only_dark_six_and_keeps_notice(self):
        config = load_recipe()
        edited = copy.deepcopy(config)
        edited['variants']['dark']['accent'] = edited['variants']['bright']['accent']
        self.assertNotEqual(edited['variants']['dark']['accent'], config['variants']['dark']['accent'])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_svg_family(config, root / 'before')
            write_svg_family(edited, root / 'after')
            before = {p.relative_to(root / 'before').as_posix(): p.read_bytes()
                      for p in (root / 'before').rglob('*.svg')}
            after = {p.relative_to(root / 'after').as_posix(): p.read_bytes()
                     for p in (root / 'after').rglob('*.svg')}
        self.assertEqual(len(before), 12)
        self.assertEqual(len(after), 12)
        for name in export.NAMES:
            self.assertEqual(before[f'bright/{name}.svg'], after[f'bright/{name}.svg'])
            self.assertNotEqual(before[f'dark/{name}.svg'], after[f'dark/{name}.svg'])
            self.assertNotIn(b'#70E6E1', after[f'dark/{name}.svg'])
            self.assertIn(b'#086E85', after[f'dark/{name}.svg'])
            self.assertEqual(before[f'bright/{name}.svg'],
                             (export.ROOT / 'exported' / 'bright' / f'{name}.svg').read_bytes())
            self.assertEqual(before[f'dark/{name}.svg'],
                             (export.ROOT / 'exported' / 'dark' / f'{name}.svg').read_bytes())
        notice = (export.ROOT / 'source' / 'tabler' / 'LICENSE.txt').read_text(encoding='utf-8').strip().encode('utf-8')
        for variant in ('bright', 'dark'):
            self.assertIn(notice, after[f'{variant}/self-shield.svg'])


if __name__ == '__main__':
    unittest.main()
