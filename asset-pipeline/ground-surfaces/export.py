"""Export two verified Kenney OBJ sources into one small geometry-only payload."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent


def read_geometry(path):
    vertices, normals, result, result_normals = [], [], [], []
    for line in path.read_text().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == 'v':
            vertices.append([float(x) for x in fields[1:4]])
        elif fields[0] == 'vn':
            normals.append([float(x) for x in fields[1:4]])
        elif fields[0] == 'f':
            face = [tuple(int(v) if v else 0 for v in item.split('/')) for item in fields[1:]]
            for i in range(1, len(face)-1):
                for vertex in (face[0], face[i], face[i+1]):
                    result.extend(vertices[vertex[0]-1])
                    result_normals.extend(normals[vertex[2]-1])
    if not result or len(result) != len(result_normals):
        raise ValueError('Missing geometry or normals')
    return {'positions': result, 'normals': result_normals, 'triangles': len(result)//9}


def export(root=ROOT):
    provenance = json.loads((root/'source/provenance.json').read_text())
    archive = root/'source'/provenance['originalByteArchive']['file']
    if hashlib.sha256(archive.read_bytes()).hexdigest() != provenance['originalByteArchive']['sha256']:
        raise ValueError('Original byte archive identity mismatch')
    with ZipFile(archive) as original:
        for item in provenance['files']:
            source = (root/'source'/item['name']).read_bytes()
            raw = original.read(item['name'])
            if hashlib.sha256(source).hexdigest() != item['sha256'] or hashlib.sha256(raw).hexdigest() != item['archiveMemberSHA256'] or source.split() != raw.split():
                raise ValueError(f"Source identity mismatch: {item['name']}")
    data = {key: read_geometry(root/'source'/f'{name}.obj') for key, name in [('blade', 'grass_large'), ('leaf', 'grass_leafsLarge')]}
    (root/'exported/grass-geometries.json').write_text(json.dumps(data, separators=(',', ':'))+'\n')
    print({key: item['triangles'] for key, item in data.items()})


if __name__ == '__main__':
    export()
