"""Isolated CC0 Morrow source edit; run with Blender 4.3.2, no runtime replacement."""
import argparse, hashlib, json, math, sys
from collections import Counter
from pathlib import Path
import bpy, bmesh
from mathutils import Quaternion, Vector
ROOT=Path(__file__).resolve().parents[2]
PINS={'teal':'963240cca558d3ff1d238583e53399956905a580db07f56b94ed21e3c2bce74a','rust':'d4812021324111483565b5cd81fe9ee0fe14f5df23c4dbf734f8b117e32f0580'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output-dir',required=True);p.add_argument('--source-dir',default=str(ROOT/'battle/source'));args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 out=Path(args.output_dir).resolve();repo=ROOT.parent
 if not out.is_relative_to(repo/'outputs') or out==repo/'outputs':raise ValueError('Output must be a named repository outputs subdirectory')
 if bpy.app.version[:3]!=(4,3,2):raise ValueError('This recipe requires Blender 4.3.2')
 sources={t:Path(args.source_dir)/f'hero-{t}.blend' for t in PINS}
 for t,path in sources.items():
  if hashlib.sha256(path.read_bytes()).hexdigest()!=PINS[t]:raise ValueError('Source hash mismatch: '+t)
 out.mkdir(parents=True,exist_ok=True);report=[]
 for team,path in sources.items():
  bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.preferences.filepaths.save_version=0
  rig=bpy.data.objects['GuardRig'];obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
  def protected_curves():
   return [(a.name,c.data_path,c.array_index,[(tuple(k.co),k.interpolation) for k in c.keyframe_points]) for a in bpy.data.actions for c in a.fcurves if not (a.name=='attack' and c.data_path in {f'pose.bones["{n}"].rotation_quaternion' for n in ['Torso','UpperArm_R','Forearm_R','Hand_R']})]
  before=protected_curves()
  # Sword blade and guard are disconnected components in the joined original mesh.
  bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table();seen=set();removed=[]
  for v in list(bm.verts):
   if v in seen:continue
   component={v};stack=[v];seen.add(v)
   while stack:
    a=stack.pop()
    for edge in a.link_edges:
     b=edge.other_vert(a)
     if b not in seen:seen.add(b);component.add(b);stack.append(b)
   xs=[x.co.x for x in component];ys=[x.co.y for x in component]
   if min(xs)>.4 and max(xs)<.8 and min(ys)<-.28 and max(ys)<-.25:removed.extend(component)
  assert len(removed)==25,('Expected original blade + crossguard vertices',len(removed))
  bmesh.ops.delete(bm,geom=removed,context='VERTS');bm.to_mesh(obj.data);bm.free()
  def vertex_weights():
   return Counter((tuple(v.co),tuple(sorted((obj.vertex_groups[g.group].name,g.weight) for g in v.groups))) for v in obj.data.vertices)
  body=vertex_weights()
  # Three low-poly thorns grow from the retained grip; no new palette or skin.
  verts=[];faces=[]
  for x,tipx,tipy in [(.53,.43,-.80),(.60,.60,-1.02),(.67,.77,-.80)]:
   i=len(verts);verts.extend([(x-.035,-.30,.82),(x+.035,-.30,.82),(x,-.30,.89),(tipx,tipy,.85)]);faces.extend([(i,i+2,i+1),(i,i+1,i+3),(i+1,i+2,i+3),(i+2,i,i+3)])
  data=bpy.data.meshes.new('thorn-focus');data.from_pydata(verts,[],faces);data.materials.append(bpy.data.materials['battle-wood']);thorn=bpy.data.objects.new('thorn-focus',data);bpy.context.collection.objects.link(thorn)
  thorn.vertex_groups.new(name='Hand_R').add(list(range(len(verts))),1,'REPLACE');thorn.parent=rig;thorn.modifiers.new('Skin','ARMATURE').object=rig
  bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);thorn.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.join()
  assert not (body-vertex_weights()),'Protected body vertex or skin weight changed'
  action=bpy.data.actions['attack'];rig.animation_data.action=action
  changed={'Torso','UpperArm_R','Forearm_R','Hand_R'}
  for curve in list(action.fcurves):
   if any(curve.data_path==f'pose.bones["{name}"].rotation_quaternion' for name in changed):action.fcurves.remove(curve)
  # Source frame 14 prepares, 19 releases, 36 recovers. Consumer owns timing.
  for frame,amount in [(1,0),(8,.4),(14,.6),(19,1),(24,.75),(36,0)]:
   for name in changed:
    bone=rig.pose.bones[name];axis=bone.bone.matrix_local.to_3x3().inverted()@Vector((1,0,0))
    angle={'Torso':-5,'UpperArm_R':-65,'Forearm_R':-12,'Hand_R':5}[name]*amount
    bone.rotation_mode='QUATERNION';bone.rotation_quaternion=Quaternion(axis,math.radians(angle));bone.keyframe_insert('rotation_quaternion',frame=frame,group=name)
  for curve in action.fcurves:
   if any(curve.data_path==f'pose.bones["{name}"].rotation_quaternion' for name in changed):
    for key in curve.keyframe_points:key.interpolation='LINEAR'
  assert protected_curves()==before,'Unexpected protected source curve change'
  rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(1)
  bpy.ops.wm.save_as_mainfile(filepath=str(out/f'morrow-{team}.blend'),compress=True)
  dest=out/f'morrow-{team}.glb';bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_yup=True)
  tris=sum(len(poly.vertices)-2 for poly in obj.data.polygons);assert tris<=1085,tris
  report.append({'team':team,'sourceSha256':PINS[team],'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'triangles':tris})
 (out/'manifest.json').write_text(json.dumps({'blender':'4.3.2','status':'source-candidate-not-visually-accepted','assets':report},indent=2)+'\n')
if __name__=='__main__':main()
