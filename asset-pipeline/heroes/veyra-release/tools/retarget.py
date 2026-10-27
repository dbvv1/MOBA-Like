"""One source-specific upper-body bake: UAL1 spell phases -> the owned guard rig.
Run after build.py. No network; root/legs and four non-attack actions are retained.
"""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'source/UAL1_Standard.glb'
# Names are not anatomical proof. These two rigs use opposite side suffixes:
# target Hand_R and source hand_l are both on positive model X at bind pose.
MAP={'Torso':'spine_03','Head':'Head','UpperArm_L':'upperarm_r','Forearm_L':'lowerarm_r','Hand_L':'hand_r','UpperArm_R':'upperarm_l','Forearm_R':'lowerarm_l','Hand_R':'hand_l'}
manifest=json.loads((ROOT/'manifest.json').read_text())
for row in manifest['assets']:
 team=row['team'];blend=ROOT/'source'/f'veyra-{team}.blend'
 bpy.ops.wm.open_mainfile(filepath=str(blend));bpy.context.preferences.filepaths.save_version=0;bpy.context.scene.render.fps=30
 target=bpy.data.objects['GuardRig'];target.animation_data.action=None;target.animation_data.use_nla=False
 original_actions=set(bpy.data.actions);original_objects=set(bpy.context.scene.objects)
 bpy.ops.import_scene.gltf(filepath=str(SRC));imported=set(bpy.context.scene.objects)-original_objects
 source=next(o for o in imported if o.type=='ARMATURE');source.animation_data.use_nla=False
 clips={name:next(a for a in bpy.data.actions if a not in original_actions and a.name.startswith(name)) for name in ['Spell_Simple_Enter','Spell_Simple_Shoot','Spell_Simple_Exit']}
 assert target.data.bones['Hand_R'].head_local.x>0 and source.data.bones['hand_l'].head_local.x>0
 action=bpy.data.actions['attack']
 for curve in list(action.fcurves):action.fcurves.remove(curve)
 target.animation_data.action=action
 for frame in range(1,37):
  if frame<=14:name='Spell_Simple_Enter';u=(frame-1)/13
  elif frame<=19:name='Spell_Simple_Shoot';u=(frame-14)/5
  else:name='Spell_Simple_Exit';u=(frame-19)/17
  source.animation_data.action=clips[name];source_frame=u*clips[name].frame_range[1]
  bpy.context.scene.frame_set(int(source_frame),subframe=source_frame-int(source_frame))
  matrices={t:(source.matrix_world @ source.pose.bones[n].matrix).copy() for t,n in MAP.items()}
  for p in target.pose.bones:p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0);p.location=(0,0,0)
  bpy.context.view_layer.update()
  for target_name in MAP:
   p=target.pose.bones[target_name]
   p.matrix=Matrix.LocRotScale(p.head.copy(),(target.matrix_world.inverted() @ matrices[target_name]).to_quaternion(),Vector((1,1,1)))
   bpy.context.view_layer.update();p.keyframe_insert('rotation_quaternion',frame=frame,group=target_name)
 for obj in imported:bpy.data.objects.remove(obj,do_unlink=True)
 for a in list(bpy.data.actions):
  if a not in original_actions:bpy.data.actions.remove(a)
 for curve in action.fcurves:
  for key in curve.keyframe_points:key.interpolation='LINEAR'
 action.use_fake_user=True;target.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(1)
 bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True)
 output=ROOT/row['file'];bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_yup=True)
 row['sha256']=hashlib.sha256(output.read_bytes()).hexdigest();row['bytes']=output.stat().st_size
manifest['animationSource']={'url':'https://quaternius.itch.io/universal-animation-library','license':'CC0-1.0','packageSha256':'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724','file':'source/UAL1_Standard.glb','sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'clips':['Spell_Simple_Enter','Spell_Simple_Shoot','Spell_Simple_Exit'],'targetFrames':{'prepare':[1,14],'release':[14,19],'recover':[19,36]},'boneMap':MAP}
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
