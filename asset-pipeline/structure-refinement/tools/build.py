"""Refine the existing CC0 structure family, never replace it with primitives.
Blender 4.3.2, offline, no render/browser. Source GLBs remain immutable.
"""
import bpy, bmesh, json, math, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'battle'/'exported'
STYLE=json.loads((ROOT/'style.json').read_text())
OUT=ROOT/'exported';OUT.mkdir(exist_ok=True)

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(objects):
 pts=[o.matrix_world @ v.co for o in objects for v in o.data.vertices]
 return {'min':[min(v[i] for v in pts) for i in range(3)],'max':[max(v[i] for v in pts) for i in range(3)]}
def material_class(rgb):
 r,g,b=rgb
 if max(rgb)-min(rgb)<.18 and .12<sum(rgb)/3<.87:return 'stone'
 if r>g*1.18 and g>b*1.1:return 'wood'
 return 'other'
def finish_body(o):
 # Preserve every imported part and its UVs. Split roughness classes using the
 # existing palette atlas; do not rebake lighting or invent detail textures.
 source=o.data.materials[0]
 image=next((n.image for n in source.node_tree.nodes if n.type=='TEX_IMAGE'),None)
 assert image is not None, o.name
 w,h=image.size;pixels=list(image.pixels);uv=o.data.uv_layers.active.data
 classes=[]
 for p in o.data.polygons:
  u=sum(uv[i].uv.x for i in p.loop_indices)/len(p.loop_indices)
  v=sum(uv[i].uv.y for i in p.loop_indices)/len(p.loop_indices)
  at=4*(max(0,min(h-1,int(v*h)))*w+max(0,min(w-1,int(u*w))))
  classes.append(material_class(pixels[at:at+3]))
 o.data.materials.clear();names=['stone','wood','other']
 for name in names:
  m=source.copy();m.name='stonework-'+name
  m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=STYLE['roughness'][name]
  o.data.materials.append(m)
 for p,kind in zip(o.data.polygons,classes):p.material_index=names.index(kind)
 bm=bmesh.new();bm.from_mesh(o.data)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=STYLE['weldDistanceMetres'])
 # Only long stone-to-stone architectural edges. Do not chamfer the roof,
 # timber, colour seams, open surfaces or tiny atlas details into noisy highlights.
 weight=bm.edges.layers.float.new('bevel_weight_edge');uv_layer=bm.loops.layers.uv.active
 def continuous_uv(edge):
  if len(edge.link_faces)!=2 or uv_layer is None:return False
  for vertex in edge.verts:
   uv=[next(loop[uv_layer].uv for loop in face.loops if loop.vert==vertex) for face in edge.link_faces]
   if (uv[0]-uv[1]).length>1e-6:return False
  return True
 eligible=0;seam_skips=0
 for e in bm.edges:
  possible=len(e.link_faces)==2 and all(f.material_index==0 for f in e.link_faces) and e.calc_length()>=STYLE['minimumStoneEdgeMetres'] and e.calc_face_angle()>=math.radians(STYLE['bevelAngleDegrees'])
  allowed=possible and continuous_uv(e)
  e[weight]=1.0 if allowed else 0.0
  eligible+=int(allowed);seam_skips+=int(possible and not allowed)
 bm.to_mesh(o.data);bm.free();o.data.update()
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 bevel=o.modifiers.new('Architectural edge catch','BEVEL')
 bevel.width=STYLE['bevelWidthMetres'];bevel.segments=STYLE['bevelSegments']
 bevel.limit_method='WEIGHT';bevel.angle_limit=math.radians(STYLE['bevelAngleDegrees']);bevel.use_clamp_overlap=True
 bpy.ops.object.modifier_apply(modifier=bevel.name)
 o.select_set(False)
 return {'faces':{name:classes.count(name) for name in names},'bevelEdges':eligible,'uvSeamEdgesExcluded':seam_skips}
rows=[]
for kind in ['tower','barracks','base']:
 for team in ['teal','rust']:
  name=f'{kind}-{team}';src=SOURCE/(name+'.glb')
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=str(src))
  objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
  original_names=sorted(o.name for o in objects);before=bounds(objects)
  untouched={o.name:[list(v.co) for v in o.data.vertices] for o in objects if not o.name.startswith('building_')}
  for o in objects:o.select_set(False)
  classes={o.name:finish_body(o) for o in objects if o.name.startswith('building_')}
  bpy.context.view_layer.update();after=bounds(objects)
  assert sorted(o.name for o in objects)==original_names
  for o in objects:
   if o.name in untouched:assert [list(v.co) for v in o.data.vertices]==untouched[o.name],o.name
  for axis in range(3):
   assert after['min'][axis]>=before['min'][axis]-.00001,(name,'bounds expanded')
   assert after['max'][axis]<=before['max'][axis]+.00001,(name,'bounds expanded')
  triangles=sum(len(p.vertices)-2 for o in objects for p in o.data.polygons)
  assert triangles<=STYLE['maxTrianglesPerAsset'],(name,triangles)
  dst=OUT/(name+'.glb')
  bpy.ops.export_scene.gltf(filepath=str(dst),export_format='GLB',export_yup=True,export_animations=False,export_extras=False)
  assert dst.stat().st_size<=STYLE['maxBytesPerAsset']
  rows.append({'id':name,'file':'exported/'+dst.name,'sourceSha256':sha(src),'sha256':sha(dst),'bytes':dst.stat().st_size,'triangles':triangles,'parts':original_names,'unchangedParts':sorted(untouched),'classifiedFaces':classes,'sourceBoundsBlenderZUp':before,'boundsBlenderZUp':after})
(ROOT/'manifest.json').write_text(json.dumps({'id':STYLE['id'],'sourceCommit':STYLE['sourceCommit'],'recipe':'tools/build.py + style.json','assets':rows},indent=2)+'\n')
print('STRUCTURE_REFINEMENT',[(x['id'],x['triangles'],x['bytes']) for x in rows])
