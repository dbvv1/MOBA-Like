"""Original editable engineering standards; Blender background CPU only. Not adopted game art."""
import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
for folder in ['exported','source','previews']:(ROOT/folder).mkdir(parents=True,exist_ok=True)
PALETTE={'stone':(.40,.36,.28,1),'edge':(.55,.50,.39,1),'shadow':(.105,.145,.14,1),'team':(.035,.29,.22,1),'brass':(.36,.24,.09,1)}

def reset():
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0

def mat(name):
 m=bpy.data.materials.get(name)
 if m:return m
 m=bpy.data.materials.new(name);m.diffuse_color=PALETTE[name];m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=PALETTE[name];bs.inputs['Roughness'].default_value=.88
 return m

def cylinder(name,r,depth,z,material,n=8,top=None):
 bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r,radius2=r if top is None else top,depth=depth,location=(0,0,z));o=bpy.context.object;o.name=name;o.data.materials.append(mat(material));return o

def box(name,dim,pos,material,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat(material))
 if bevel:
  mod=o.modifiers.new('editable_edge_bevel','BEVEL');mod.width=bevel;mod.segments=1
 return o

def tower():
 cylinder('plinth',2.08,.26,.13,'shadow',8)
 cylinder('plinth_cap',1.98,.24,.38,'edge',8)
 cylinder('tapered_body',1.22,2.65,1.825,'stone',8,1.02)
 for i in range(4):
  a=i*math.pi/2; o=box('buttress_'+str(i),(.40,.45,2.05),(math.cos(a)*1.20,math.sin(a)*1.20,1.40),'edge',.055);o.rotation_euler.z=a
 cylinder('upper_band',1.44,.26,3.28,'shadow',8)
 cylinder('crown_floor',1.58,.24,3.53,'edge',8)
 cylinder('crown_body',1.30,.80,4.05,'stone',8,1.15)
 for i in range(4):
  a=math.pi/4+i*math.pi/2;o=box('crown_tooth_'+str(i),(.48,.48,.58),(math.cos(a)*1.04,math.sin(a)*1.04,4.53),'edge',.035);o.rotation_euler.z=a
 cylinder('team_pedestal',.66,.20,4.53,'shadow',8)
 cylinder('team_beacon_lower',.58,.38,4.82,'team',4,.38)
 cylinder('team_beacon_upper',.38,.29,5.155,'team',4,0)
 # Immutable 5.3 m height ceiling; no attack/reach/collision component.

def barracks():
 box('footing',(2.55,2.80,.18),(0,-.10,.09),'shadow',.035)
 box('wall',(2.28,2.50,1.60),(0,-.10,.98),'stone',.04)
 box('cornice',(2.56,2.78,.18),(0,-.10,1.87),'edge',.025)
 # Hipped roof, original footprint and +Z glTF front convention.
 verts=[(-1.28,-1.39,1.96),(1.28,-1.39,1.96),(1.28,1.19,1.96),(-1.28,1.19,1.96),(0,-.10,3.0)]
 mesh=bpy.data.meshes.new('roof');mesh.from_pydata(verts,[],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)]);mesh.materials.append(mat('team'));o=bpy.data.objects.new('roof',mesh);bpy.context.collection.objects.link(o)
 box('front_door',(0.70,.04,1.12),(0,-1.37,.75),'shadow')
 for x in [-.94,.94]:box('front_pier',(.20,.12,1.65),(x,-1.37,1.01),'edge',.015)

def export_model(name,build):
 reset();build();bpy.context.view_layer.update()
 bpy.data.texts.load(str(Path(__file__).resolve()))
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'{name}.blend'),compress=True)
 for ob in list(bpy.context.scene.objects):
  if ob.type=='MESH':
   bpy.context.view_layer.objects.active=ob
   for modifier in list(ob.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
 bpy.ops.object.select_all(action='DESELECT')
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 for ob in meshes:ob.select_set(True)
 bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join()
 bpy.ops.export_scene.gltf(filepath=str(ROOT/'exported'/f'{name}.glb'),export_format='GLB',export_yup=True,export_animations=False,export_apply=True)

export_model('tower-teal',tower);export_model('barracks-teal',barracks)
if '--models-only' in sys.argv:sys.exit(0)
# Editable repeating road material source, original geometry rendered to albedo.
# Orthographic emission-only bake: no baked light, perspective or external images.
reset()
# 10 m periodic dirt field with sparse elongated stones: no checkerboard grid.
# All geometry is original and editable. Tiles are repeated at boundaries.
PALETTE.update({'earth':(.285,.265,.21,1),'stone_soft':(.335,.32,.265,1),'stone_light':(.37,.35,.29,1)})
base=box('earth',(10,10,.01),(0,0,-.01),'earth')
for row in range(9):
 for col in range(4):
  key=row*4+col
  if key%7==3:continue
  cx=-5+(col+.5)*2.5+(.45 if row%2 else -.15)
  cx+=.21*math.sin(key*1.83)
  cy=-5+(row+.5)*(10/9)+.21*math.cos(key*2.17)
  length=1.5+.34*math.sin(key*2.3);width=.30+.13*(.5+.5*math.cos(key*1.7))
  for ox in [-10,0,10]:
   for oy in [-10,0,10]:
    x,y=cx+ox,cy+oy
    verts=[(x-length/2,y-width*.32,0),(x-length*.32,y-width*.58,0),(x+length*.44,y-width*.42,0),(x+length/2,y+width*.26,0),(x+length*.30,y+width*.52,0),(x-length*.43,y+width*.46,0)]
    mesh=bpy.data.meshes.new(f'stone_{key}_{ox}_{oy}');mesh.from_pydata(verts,[],[tuple(range(6))]);mesh.materials.append(mat('stone_soft' if key%3 else 'stone_light'));ob=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(ob)
for m in bpy.data.materials:
 bs=m.node_tree.nodes.get('Principled BSDF');out=m.node_tree.nodes.get('Material Output');em=m.node_tree.nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value=m.diffuse_color;m.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
camdata=bpy.data.cameras.new('albedo_ortho');cam=bpy.data.objects.new('albedo_ortho',camdata);bpy.context.collection.objects.link(cam);cam.location=(0,0,15);cam.rotation_euler=(0,0,0);camdata.type='ORTHO';camdata.ortho_scale=10;bpy.context.scene.camera=cam
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.use_denoising=False;s.cycles.samples=1;s.render.resolution_x=s.render.resolution_y=512;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=0;s.view_settings.gamma=1;s.render.film_transparent=False
bpy.data.texts.load(str(Path(__file__).resolve()));bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/road-material.blend'),compress=True)
s.render.filepath=str(ROOT/'exported/road-albedo.png');bpy.ops.render.render(write_still=True)

# Strip private render metadata only; IDAT pixels and colour chunks remain byte-identical.
def public_png(path):
 data=path.read_bytes();out=data[:8];offset=8
 while offset<len(data):
  size=int.from_bytes(data[offset:offset+4],'big');end=offset+12+size;kind=data[offset+4:offset+8]
  if kind not in [b'tEXt',b'zTXt',b'iTXt',b'eXIf']:out+=data[offset:end]
  offset=end
 path.write_bytes(out)
public_png(ROOT/'exported/road-albedo.png')

# CPU offline array, explicitly not the game renderer/camera.
reset();tower_objects=[]
for name,x in [('tower-teal',-3),('barracks-teal',3)]:
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'exported'/f'{name}.glb'))
 for o in set(bpy.context.scene.objects)-before:
  if o.parent is None:o.location.x+=x
floor=box('preview_floor',(18,12,.1),(0,0,-.08),'stone')
# Label as geometry text so the render is self-identifying.
for body,z,size in [('ENGINEERING DRAFT',6.5,.6),('CYCLES CPU / NOT GAMEPLAY / NOT ADOPTED',5.8,.22)]:
 bpy.ops.object.text_add(location=(-5.1,1.2,z));o=bpy.context.object;o.data.body=body;o.data.size=size;o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(mat('shadow'))
camdata=bpy.data.cameras.new('offline_array');cam=bpy.data.objects.new('offline_array',camdata);bpy.context.collection.objects.link(cam);cam.location=(10,-16,12);target=Vector((0,0,2.4));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=15;bpy.context.scene.camera=cam
ld=bpy.data.lights.new('key','AREA');lo=bpy.data.objects.new('key',ld);bpy.context.collection.objects.link(lo);lo.location=(-4,-6,12);lo.rotation_euler=(Vector((0,0,2))-lo.location).to_track_quat('-Z','Y').to_euler();ld.energy=1900;ld.size=8
s=bpy.context.scene;s.world=bpy.data.worlds.new('preview_world');s.world.color=(.24,.24,.24);s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.use_denoising=False;s.cycles.samples=32;s.render.resolution_x=1200;s.render.resolution_y=900;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='Standard';s.render.filepath=str(ROOT/'previews/offline-array.png');bpy.ops.render.render(write_still=True)
