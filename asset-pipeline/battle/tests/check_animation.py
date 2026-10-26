"""Blender round-trip sampled deformations; does not judge animation feel.
Five integer frames and one half frame per clip; not exhaustive path identity."""
import bpy,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def sample(path):
 if path.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(path))
 else:
  bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=30;bpy.ops.import_scene.gltf(filepath=str(path))
 rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');result={}
 for name in ['idle','walk','attack','hurt','death']:
  act=next(a for a in bpy.data.actions if a.name==name or a.name.startswith(name+'_'))
  rig.animation_data.action=act;frames=[round(act.frame_range[0]+(act.frame_range[1]-act.frame_range[0])*u) for u in [0,.25,.5,.75,1]]+[round(sum(act.frame_range)/2)+.5];poses=[]
  for frame in frames:
   bpy.context.scene.frame_set(int(frame),subframe=frame-int(frame));deps=bpy.context.evaluated_depsgraph_get();pts=sorted(tuple(o.matrix_world @ v.co) for o in bpy.context.scene.objects if o.type=='MESH' for v in o.evaluated_get(deps).data.vertices)
   assert pts and all(math.isfinite(n) for p in pts for n in p)
   # GLB splits vertices at material/normal seams; compare unique rounded positions, not vertex order.
   poses.append(sorted(set(tuple(round(n,4) for n in p) for p in pts)))
  result[name]=poses
 return result
report=[]
for role in ['hero','melee','ranged']:
 for team in ['teal','rust']:
  id=role+'-'+team;source=sample(ROOT/'source'/f'{id}.blend');runtime=sample(ROOT/'exported'/f'{id}.glb');error=0
  for name,poses in source.items():
   for sample_index,(left,right) in enumerate(zip(poses,runtime[name])):
    # Directed nearest-point distance handles glTF seam splitting and stable rounding boundaries.
    err=max(min(sum((a-b)**2 for a,b in zip(p,q))**.5 for q in right) for p in left)
    error=max(error,err);limit=.005 if sample_index==5 else .0003;assert err<limit,(id,name,sample_index,err)
  assert source['walk'][0]!=source['walk'][1]
  assert source['attack'][0]!=source['attack'][1]
  report.append({'id':id,'maxSampleErrorMetres':error,'sampledActions':5,'samplesPerAction':6})
print('BATTLE_ANIMATION_ROUNDTRIP',json.dumps(report))
