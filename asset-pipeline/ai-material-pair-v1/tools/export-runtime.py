"""Size/codec-only runtime export; never edits generated material content."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
(root / 'exported').mkdir(exist_ok=True)
for name in ['ground-stone-earth', 'wall-stone']:
    image = Image.open(root / 'source' / f'{name}-v2.png')
    image.resize((512, 512), Image.Resampling.LANCZOS).save(
        root / 'exported' / f'{name}-v2.webp', quality=90, method=6)
