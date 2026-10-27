"""Deterministic runtime-sized albedo exports; no seam repair or colour repaint."""
from pathlib import Path
from PIL import Image
import hashlib,json
root=Path(__file__).resolve().parent
out=root/'exported';out.mkdir(exist_ok=True)
receipt={'tool':'built-in image_gen','rights':'original generated image; not CC0 or open-weight','files':[]}
for kind in ['earth','forest']:
    path=root/'source'/f'{kind}-albedo-source.png'
    image=Image.open(path);target=out/f'{kind}-albedo.webp'
    image.convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS).save(target,'WEBP',quality=90,method=6)
    receipt['files'].append({'source':path.name,'sourceSize':list(image.size),'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'runtime':target.name,'runtimeSize':[1024,1024],'runtimeSHA256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size})
(out/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
