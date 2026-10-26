"""Reproducible CC0 battle art. Blender 4.3; no network, no external Python packages."""
import bpy, math, json, sys, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'exported'; OUT.mkdir(exist_ok=True)
entries=[]
PALETTE={'teal':(.035,.33,.25,1),'rust':(.56,.105,.045,1),'stone':(.58,.51,.35,1),'steel':(.68,.66,.54,1),'dark':(.045,.065,.065,1),'gold':(.67,.43,.12,1),'wood':(.20,.105,.045,1),'grass':(.045,.13,.105,1),'path':(.32,.28,.18,1),'path-detail':(.30,.26,.17,1)}

def reset():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 bpy.context.scene.render.fps=30

def mat(name):
 m=bpy.data.materials.get('battle-'+name)
 if m:return m
 m=bpy.data.materials.new('battle-'+name);m.diffuse_color=PALETTE[name];m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=PALETTE[name];p.inputs['Roughness'].default_value=.82
 return m

def mesh(name,verts,faces,material,bone=None,rig=None):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(mat(material))
 if rig:
  o.vertex_groups.new(name=bone).add(list(range(len(d.vertices))),1,'REPLACE');o.modifiers.new('Skin','ARMATURE').object=rig;o.parent=rig
 return o

def rings(name,levels,material,bone=None,rig=None,n=10):
 # Elliptic sculpted silhouette: each level is (z, radiusX, radiusY, centerX, centerY).
 vs=[(cx+rx*math.cos(i*2*math.pi/n),cy+ry*math.sin(i*2*math.pi/n),z) for z,rx,ry,cx,cy in levels for i in range(n)]
 fs=[tuple(reversed(range(n))),tuple(range((len(levels)-1)*n,len(levels)*n))]
 for j in range(len(levels)-1):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;fs.append((a,b,b+n,a+n))
 return mesh(name,vs,fs,material,bone,rig)

def rod(name,a,b,r,material,bone=None,rig=None,n=8):
 a,b=Vector(a),Vector(b);z=(b-a).normalized();u=z.cross(Vector((0,0,1)))
 if u.length<.01:u=z.cross(Vector((0,1,0)))
 u.normalize();v=z.cross(u);vs=[tuple(p+r*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n))) for p in [a,b] for i in range(n)]
 return mesh(name,vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,bone,rig)

def plate(name,points,depth,material,bone,rig):
 # Points run around the X/Z face; negative Y is character forward.
 vs=[(x,y+d,z) for d in [-depth/2,depth/2] for x,y,z in points];n=len(points)
 return mesh(name,vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,bone,rig)

def stats():
 obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];deps=bpy.context.evaluated_depsgraph_get();pts=[o.matrix_world @ v.co for o in obs for v in o.evaluated_get(deps).data.vertices]
 return {'triangles':sum(len(p.vertices)-2 for o in obs for p in o.data.polygons),'bounds':{'min':[round(min(p.x for p in pts),5),round(min(p.z for p in pts),5),round(-max(p.y for p in pts),5)],'max':[round(max(p.x for p in pts),5),round(max(p.z for p in pts),5),round(-min(p.y for p in pts),5)]},'materials':len(set(m.name for o in obs for m in o.data.materials))}

def export(id,kind,height,radius,source,team=None,clips=None):
 bpy.context.view_layer.update();s=stats()
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'{id}.blend'),compress=True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{id}.glb'),export_format='GLB',export_animations=bool(clips),export_animation_mode='ACTIONS',export_force_sampling=True,export_yup=True)
 row={'id':id,'url':f'/asset-pipeline/battle/exported/{id}.glb','license':'CC0-1.0','source':source,'kind':kind,'forward':'+Z','groundY':0,'nominalHeight':height,'footprintRadius':radius,'bytes':(OUT/f'{id}.glb').stat().st_size,'sha256':hashlib.sha256((OUT/f'{id}.glb').read_bytes()).hexdigest(),**s}
 if team:row['team']=team
 if clips:row['clips']=clips
 entries.append(row)

def buildings():
 for team,col in [('teal','green'),('rust','red')]:
  for kind,stem,height,radius,xy in [('tower','building_tower_catapult',5.3,2.1,1),('barracks','building_barracks',3,2.2,1),('base','building_castle',6,3.9,1.65)]:
   reset();src=ROOT/'source/kaykit/buildings'/col/f'{stem}_{col}.gltf';bpy.ops.import_scene.gltf(filepath=str(src))
   obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];pts=[o.matrix_world @ v.co for o in obs for v in o.data.vertices];h=max(v.z for v in pts);s=height/h
   # Bake transforms into meshes; source atlas/UV remain editable and intact.
   for o in obs:
    for v in o.data.vertices:
     p=o.matrix_world @ v.co;v.co=(p.x*s*xy,p.y*s*xy,p.z*s)
    o.matrix_world.identity()
   for im in bpy.data.images:
    if im.size[0]>256:im.scale(256,256);im.pack()
   # Supplemental pennant distinguishes teams by silhouette as well as colour.
   # Keep within original height/radius envelope.
   if kind in ['barracks','tower']:
    x=-1.05;top=2.9 if kind=='barracks' else 5.1;rod('standard-pole',(x,0,top-1.3),(x,0,top),.035,'wood')
    pts=[(x,0,top-.05),(x+.72,0,top-.05),(x+.72,0,top-.48),(x,0,top-.48)] if team=='teal' else [(x,0,top-.05),(x+.80,0,top-.26),(x,0,top-.52)]
    mesh('team-standard',pts,[(0,1,2,3)] if team=='teal' else [(0,1,2)],team)
   export(f'{kind}-{team}',kind,height,radius,'https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/tree/84fa4e91af6a88989be7c99e0891cede11f2ca38',team)
 for name,height,radius in [('tree_single_A',4.2,1.2),('rock_single_C',1.1,1.2)]:
  reset();bpy.ops.import_scene.gltf(filepath=str(ROOT/'source/kaykit/decoration/nature'/f'{name}.gltf'))
  obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];pts=[o.matrix_world @ v.co for o in obs for v in o.data.vertices];lo=min(p.z for p in pts);s=height/(max(p.z for p in pts)-lo)
  for o in obs:
   for v in o.data.vertices:p=o.matrix_world @ v.co;v.co=(p.x*s,p.y*s,(p.z-lo)*s)
   o.matrix_world.identity()
  for im in bpy.data.images:
   if im.size[0]>256:im.scale(256,256);im.pack()
  export('tree' if name.startswith('tree') else 'rock','decoration',height,radius,'https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/tree/84fa4e91af6a88989be7c99e0891cede11f2ca38')

def character(team,role):
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/guard-rig-actions.blend'));bpy.context.preferences.filepaths.save_version=0
 rig=bpy.data.objects['GuardRig'];rig.animation_data.action=None
 for p in rig.pose.bones:p.rotation_quaternion=(1,0,0,0);p.location=(0,0,0)
 for o in list(bpy.context.scene.objects):
  if o.type!='ARMATURE':bpy.data.objects.remove(o,do_unlink=True)
 # Bespoke tapered armor, rounded helm, heraldic cloth, and articulating boot shapes.
 rings('hip-armour',[(.83,.25,.18,0,0),(.97,.28,.18,0,0),(1.04,.21,.15,0,0)],'dark','Root',rig)
 rings('waisted-cuirass',[(.99,.22,.16,0,0),(1.16,.26,.19,0,0),(1.43,.36,.23,0,0),(1.54,.23,.18,0,0)],'steel','Torso',rig)
 plate('tabard',[(-.16,-.205,1.4),(.16,-.205,1.4),(.19,-.19,.78),(0,-.22,.69),(-.19,-.19,.78)],.025,team,'Torso',rig)
 rings('belt',[(1.03,.245,.175,0,0),(1.09,.25,.18,0,0)],'gold','Torso',rig)
 rings('neck',[(1.5,.12,.12,0,0),(1.68,.12,.12,0,0)],'dark','Head',rig)
 rings('helm',[(1.63,.21,.20,0,0),(1.84,.28,.25,0,0),(2.0,.23,.21,0,.015),(2.09,.08,.11,0,.02)],'steel','Head',rig,n=12)
 plate('visor',[(-.22,-.223,1.88),(.22,-.223,1.88),(.19,-.249,1.79),(-.19,-.249,1.79)],.015,'dark','Head',rig)
 plate('noseguard',[(-.028,-.262,1.98),(.028,-.262,1.98),(.033,-.273,1.74),(0,-.285,1.69),(-.033,-.273,1.74)],.025,'gold','Head',rig)
 for side,sg in [('L',-1),('R',1)]:
  if role!='ranged':rings('pauldron-'+side,[(1.33,.15,.18,sg*.43,0),(1.48,.22,.24,sg*.43,0),(1.62,.14,.19,sg*.40,0)],team,'UpperArm_'+side,rig)
  else:rings('ranger-shoulder-'+side,[(1.33,.11,.13,sg*.43,0),(1.49,.13,.15,sg*.43,0)],team,'UpperArm_'+side,rig)
  rod('upper-arm-'+side,(sg*.46,0,1.4),(sg*.56,0,1.11),.105,'dark','UpperArm_'+side,rig)
  rings('vambrace-'+side,[(.88,.1,.12,sg*.60,0),(1.05,.13,.14,sg*.57,0),(1.13,.105,.115,sg*.56,0)],'steel','Forearm_'+side,rig)
  rings('gauntlet-'+side,[(.77,.10,.12,sg*.60,-.045),(.9,.12,.13,sg*.60,-.03)],'dark','Hand_'+side,rig)
  rod('thigh-'+side,(sg*.18,0,.87),(sg*.18,0,.5),.125,team,'Thigh_'+side,rig)
  rings('greave-'+side,[(.14,.105,.10,sg*.18,0),(.39,.12,.12,sg*.18,0),(.51,.14,.14,sg*.18,-.02)],'steel','Shin_'+side,rig)
  rings('boot-'+side,[(.005,.13,.24,sg*.18,-.09),(.12,.14,.24,sg*.18,-.09),(.23,.115,.14,sg*.18,-.015)],'dark','Foot_'+side,rig)
 if role=='hero':
  # Flowing rear cape is intentionally short: no floor clipping while running.
  mesh('cape',[(-.24,.20,1.5),(.24,.20,1.5),(.30,.30,1.12),(.38,.40,.66),(0,.45,.59),(-.38,.40,.66),(-.30,.30,1.12)],[(0,1,2,6),(6,2,3,4,5)],team,'Torso',rig)
  # Single long crest vs forked crest; recognizable above troops.
  offsets=[0] if team=='teal' else [-.085,.085]
  for ix,x in enumerate(offsets):
   mesh('crest-'+str(ix),[(x-.035,-.15,2.03),(x+.035,-.15,2.03),(x+.035,-.06,2.28),(x-.035,-.06,2.28),(x-.035,.28,2.13),(x+.035,.28,2.13)],[(0,1,2,3),(3,2,5,4),(0,3,4),(1,5,2),(0,4,5,1)],team,'Head',rig)
  plate('kite-shield',[(-.84,-.20,1.3),(-.39,-.20,1.3),(-.33,-.22,1.15),(-.6,-.24,.55),(-.88,-.22,1.15)],.07,'gold','Hand_L',rig)
  plate('shield-enamel',[(-.80,-.245,1.24),(-.43,-.245,1.24),(-.40,-.265,1.13),(-.60,-.285,.65),(-.81,-.265,1.13)],.015,team,'Hand_L',rig)
  rod('sword-grip',(.60,-.04,.85),(.60,-.3,.85),.04,'wood','Hand_R',rig)
  rod('sword-crossguard',(.43,-.29,.85),(.77,-.29,.85),.035,'gold','Hand_R',rig)
  mesh('longsword',[(.51,-.32,.85),(.60,-.32,.89),(.69,-.32,.85),(.60,-.32,.81),(.54,-1.0,.85),(.60,-1.0,.88),(.66,-1.0,.85),(.60,-1.0,.82),(.60,-1.17,.85)],[(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0),(4,8,5),(5,8,6),(6,8,7),(7,8,4)],'steel','Hand_R',rig)
 elif role=='melee':
  # Short spear remains inside the troop envelope while its pointed profile reads at distance.
  rod('spear',(.60,.18,.85),(.60,-.91,.85),.035,'wood','Hand_R',rig)
  mesh('spearhead',[(.49,-.83,.85),(.71,-.83,.85),(.60,-1.17,.85),(.60,-.85,.93),(.60,-.85,.77)],[(0,2,3),(3,2,1),(1,2,4),(4,2,0),(0,3,1,4)],'steel','Hand_R',rig)
  plate('round-buckler',[(-.60+.40*math.cos(i*math.tau/10),-.22,1.02+.40*math.sin(i*math.tau/10)) for i in range(10)],.06,team,'Hand_L',rig)
 else:
  for name in ['helm','visor','noseguard']:
   bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
  rings('ranger-hood',[(1.60,.23,.23,0,.02),(1.83,.28,.27,0,.02),(2.23,.025,.04,0,.06)],team,'Head',rig,n=8)
  plate('hood-face',[(-.14,-.28,1.90),(.14,-.28,1.90),(.15,-.28,1.72),(0,-.28,1.65),(-.15,-.28,1.72)],.02,'dark','Head',rig)
  rod('crossbow-stock',(.6,.15,.85),(.6,-.63,.85),.055,'wood','Hand_R',rig)
  rod('crossbow-bow',(.03,-.42,.86),(1.17,-.42,.86),.035,'gold','Hand_R',rig)
  rod('crossbow-string',(.03,-.42,.86),(.60,-.16,.86),.009,'dark','Hand_R',rig,n=4)
  rod('crossbow-string2',(1.17,-.42,.86),(.60,-.16,.86),.009,'dark','Hand_R',rig,n=4)
  rod('bolt',(.60,-.2,.92),(.60,-.77,.92),.018,'steel','Hand_R',rig,n=4)
 # Join meshes while retaining material slots and per-bone vertex weights: one skin, shared materials.
 bpy.ops.object.select_all(action='DESELECT')
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 for o in meshes:o.select_set(True)
 bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();meshes[0].name=role+'-body'
 # Troop attacks are weapon-specific rather than playing an overhead sword chop on a crossbow.
 if role!='hero':
  from mathutils import Quaternion
  action=bpy.data.actions['attack']
  for curve in list(action.fcurves):action.fcurves.remove(curve)
  rig.animation_data.action=action
  for frame,impulse in [(1,0),(7,-.25),(11,1),(15,.35),(22,0)]:
   for pb in rig.pose.bones:
    pb.rotation_mode='QUATERNION';pb.rotation_quaternion=(1,0,0,0);pb.location=(0,0,0)
    angle=0
    if pb.name=='UpperArm_R':angle=-8+(12 if role=='ranged' else -20)*impulse
    if pb.name=='Forearm_R':angle=(-8 if role=='ranged' else 15)*impulse
    if pb.name=='Torso':angle=-4*impulse
    axis=pb.bone.matrix_local.to_3x3().inverted()@Vector((1,0,0));pb.rotation_quaternion=Quaternion(axis,math.radians(angle))
    pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name);pb.keyframe_insert('location',frame=frame,group=pb.name)
 # Bake editable source curves at the same integer-frame samples as glTF.
 # This keeps original keyed poses while removing Bezier-only sub-frame overshoot.
 for action in bpy.data.actions:
  first,last=map(int,action.frame_range)
  for curve in action.fcurves:
   values=[(f,curve.evaluate(f)) for f in range(first,last+1)]
   curve.keyframe_points.clear()
   for f,value in values:curve.keyframe_points.insert(f,value,options={'FAST'}).interpolation='LINEAR'
   curve.update()
 # Pure root transform maintains the original fifteen-bone rig and five clips.
 height=2.28 if role=='hero' else 1.2
 scale=height/(2.28 if role=='hero' else 2.09)
 rig.scale=(scale,scale,scale)
 rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(1)
 export(f'{role}-{team}','hero' if role=='hero' else 'minion',1.28 if role=='ranged' else height,.55 if role=='hero' else .45,'https://github.com/dbvv1/MOBA-Like/tree/main/asset-pipeline/battle/tools/build.py',team,{n:n for n in ['idle','walk','attack','hurt','death']})

def ground():
 reset()
 # Road surface only. The renderer already owns continuous #284c43 grass at y=-.035.
 # A duplicate grass slab at that exact height caused real Three.js z-fighting;
 # remove the slab and its tile side faces rather than tuning a shadow bias.
 # End columns overlap neighbours by 3 cm with identical flat material. Their
 # edge profile repeats exactly, avoiding subpixel cracks from tile transforms.
 xs=[-6.03,-3,0,3,6.03]
 north=[5.85,6.05,5.9,5.72,5.85]
 south=[-5.8,-5.95,-5.7,-5.9,-5.8]
 vertices=[(x,south[i],0) for i,x in enumerate(xs)]+[(x,north[i],0) for i,x in enumerate(xs)]
 mesh('stone-path',vertices,[(i,i+1,i+6,i+5) for i in range(4)],'path')
 for ix in range(3):
  for sy in [-1,1]:
   x=-5+ix*4;y=sy*(4.8+(ix%2)*.25)
   vs=[(x-.4,y-.22,.002),(x+.8,y-.18,.002),(x+1,y+.15,.002),(x+.5,y+.32,.002),(x-.45,y+.2,.002)]
   mesh(f'worn-edge-{ix}-{sy}',vs,[(0,1,2,3,4)],'path-detail')
 export('lane-ground','ground',.002,8.6,'https://github.com/dbvv1/MOBA-Like/tree/main/asset-pipeline/battle/tools/build.py')

if __name__=='__main__':
 (ROOT/'manifest.json').unlink(missing_ok=True)
 provenance=json.loads((ROOT/'source/provenance.json').read_text())
 for item in provenance['kaykit']['files']:
  assert hashlib.sha256((ROOT/'source'/item['path']).read_bytes()).hexdigest()==item['sha256'],'changed KayKit source'
 assert hashlib.sha256((ROOT/'source/guard-rig-actions.blend').read_bytes()).hexdigest()==provenance['guard']['sha256'],'changed original rig source'
 buildings()
 for t in ['teal','rust']:
  for r in ['hero','melee','ranged']:character(t,r)
 ground()
 (ROOT/'manifest.json').write_text(json.dumps({'schemaVersion':1,'style':'日照石径·青绿守望 vs 赭红入侵','qualityStatus':'candidate-needs-integrated-battle-review','coordinateSystem':'glTF Y-up, +Z forward, metres','assets':entries},ensure_ascii=False,indent=2)+'\n')
 print('BATTLE_EXPORT',len(entries),sum(x['bytes'] for x in entries))
