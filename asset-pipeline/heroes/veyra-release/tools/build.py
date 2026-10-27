"""Veyra's ranged focus and release poses, derived from the adopted original guard.
Blender 4.3, no network. Does not write the shared battle source or manifest.
"""
import bpy,bmesh,math,json,hashlib,importlib.util
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix
ROOT=Path(__file__).resolve().parents[1]
BATTLE=ROOT.parents[1]/'battle'
spec=importlib.util.spec_from_file_location('battle_mesh_helpers',BATTLE/'tools/build.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
rows=[]
for team in ['teal','rust']:
 src=BATTLE/'source'/f'hero-{team}.blend'
 bpy.ops.wm.open_mainfile(filepath=str(src));bpy.context.preferences.filepaths.save_version=0
 rig=bpy.data.objects['GuardRig'];body=bpy.data.objects['hero-body']
 rig.animation_data.action=None
 for p in rig.pose.bones:p.rotation_quaternion=(1,0,0,0);p.location=(0,0,0)
 # Connected weapon parts are authored as separate islands in the joined skin.
 # Keep hands/gauntlets; remove only islands entirely on a hand extending in front.
 adjacency={i:set() for i in range(len(body.data.vertices))}
 for e in body.data.edges:a,b=e.vertices;adjacency[a].add(b);adjacency[b].add(a)
 seen=set();remove=set();removed=[]
 for start in adjacency:
  if start in seen:continue
  stack=[start];island=set()
  while stack:
   i=stack.pop()
   if i in island:continue
   island.add(i);stack.extend(adjacency[i]-island)
  seen|=island
  names={body.vertex_groups[g.group].name for i in island for g in body.data.vertices[i].groups if g.weight>.99}
  points=[body.data.vertices[i].co for i in island]
  if names in [{'Hand_L'},{'Hand_R'}] and min(p.y for p in points)<-.19:
   remove|=island;removed.append({'bone':next(iter(names)),'vertices':len(island)})
 assert len(removed)==5,removed # shield layers + grip + guard + blade
 bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in remove],context='VERTS');bm.to_mesh(body.data);bm.free()
 # A broad forked botanical focus gives the ranged hero a different weapon silhouette.
 h.PALETTE['focus']=(.68,.89,.72,1)
 h.rod('focus-shaft',(-.60,-.10,.78),(-.60,-.10,1.93),.045,'wood','Hand_L',rig)
 h.rod('focus-wrap',(-.60,-.10,.78),(-.60,-.10,1.02),.065,'gold','Hand_L',rig)
 for sign in [-1,1]:
  h.rod('focus-branch',(-.60,-.10,1.71),(-.60+sign*.25,-.10,2.04),.044,'gold','Hand_L',rig)
  h.plate('focus-leaf',[(-.60+sign*.23,-.1,1.94),(-.60+sign*.32,-.1,2.10),(-.60+sign*.12,-.1,2.23)],.06,team,'Hand_L',rig)
 h.rings('focus-seed',[(1.87,.06,.07,-.60,-.10),(2.01,.13,.10,-.60,-.10),(2.14,.025,.025,-.60,-.10)],'focus','Hand_L',rig,n=6)
 # Hold the short focus forward of the torso rather than hiding its crown
 # behind the overhead health bar. This is a bind-mesh grip, not a timed effect.
 grip=Vector((-.60,-.10,.85));tilt=Matrix.Rotation(math.radians(35),3,'X')
 for o in bpy.context.scene.objects:
  if o.type=='MESH' and o.name.startswith('focus-'):
   for v in o.data.vertices:v.co=grip+tilt@(v.co-grip)
 # Non-emissive palm focus: physical source geometry, not a damage/charge effect.
 h.rings('casting-bracer',[(.78,.13,.14,.60,-.03),(.92,.14,.15,.60,-.03),(1.01,.11,.12,.59,-.03)],'gold','Hand_R',rig,n=8)
 bpy.ops.object.select_all(action='DESELECT')
 for o in bpy.context.scene.objects:
  if o.type=='MESH':o.select_set(True)
 bpy.context.view_layer.objects.active=body;bpy.ops.object.join();body.name='veyra-body'
 action=bpy.data.actions['attack']
 for c in list(action.fcurves):action.fcurves.remove(c)
 rig.animation_data.action=action
 # Three major poses. Source frames 1..13 are available only to genuine cast windups.
 # Instant basicAttack begins at source frame 14: the actual committed release transition.
 poses=[(1,0),(8,-.5),(14,-.5),(16,1),(19,1),(25,.4),(36,0)]
 for frame,amount in poses:
  for p in rig.pose.bones:
   p.rotation_mode='QUATERNION';p.rotation_quaternion=(1,0,0,0);p.location=(0,0,0)
   rotations=[]
   if p.name=='Torso':rotations=[((0,0,1),-22*amount),((1,0,0),18*max(0,amount))]
   if p.name=='Head':rotations=[((0,0,1),16*amount)]
   if p.name=='UpperArm_R':rotations=[((1,0,0),-85*amount),((0,1,0),-22*amount)]
   if p.name=='Forearm_R':rotations=[((1,0,0),-15*amount)]
   if p.name=='Hand_R':rotations=[((1,0,0),25*amount)]
   if p.name=='UpperArm_L':rotations=[((0,1,0),15*amount),((1,0,0),-25*amount)]
   if p.name=='Forearm_L':rotations=[((1,0,0),30*amount)]
   for axis,degrees in rotations:
    local=p.bone.matrix_local.to_3x3().inverted()@Vector(axis)
    p.rotation_quaternion=p.rotation_quaternion@Quaternion(local,math.radians(degrees))
   p.keyframe_insert('rotation_quaternion',frame=frame,group=p.name);p.keyframe_insert('location',frame=frame,group=p.name)
 for curve in action.fcurves:
  for k in curve.keyframe_points:k.interpolation='LINEAR'
 action.use_fake_user=True
 rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(1)
 blend=ROOT/'source'/f'veyra-{team}.blend';out=ROOT/'exported'/f'veyra-{team}.glb'
 bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_yup=True)
 rows.append({'id':f'veyra-{team}','definitionId':'veyra','team':team,'file':f'exported/veyra-{team}.glb','sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'sourceBaseSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'clips':['idle','walk','attack','hurt','death'],'bones':15,'removedWeaponParts':removed})
(ROOT/'manifest.json').write_text(json.dumps({'schemaVersion':1,'license':'CC0-1.0','forward':'+Z','assets':rows},indent=2)+'\n')
