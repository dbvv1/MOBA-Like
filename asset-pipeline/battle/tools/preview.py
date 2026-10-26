"""CPU preview at owner camera; local files only, not acceptance of playable battle."""
import bpy, math, sys, argparse
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--candidates',type=Path);p.add_argument('--assets-root',type=Path);p.add_argument('--landmarks-only',action='store_true');p.add_argument('--label',default='battle-v3');a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
if a.assets_root:ROOT=a.assets_root
bpy.ops.wm.read_factory_settings(use_empty=True)
def add(id,x,y,rot=0):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'exported'/f'{id}.glb'));obs=set(bpy.context.scene.objects)-before
 empty=bpy.data.objects.new(id,None);bpy.context.collection.objects.link(empty)
 for o in obs:
  if id=='lane-ground' and o.type=='MESH':o.visible_shadow=False
  if o.parent not in obs:o.parent=empty
 empty.location=(x,y,0);empty.rotation_euler.z=rot
 return empty
for x in [-24,-12,0,12,24]:add('lane-ground',x,0)
# Background context is preview-only. Runtime owner provides continuous terrain beyond lane.
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.035));o=bpy.context.object
m=bpy.data.materials.new('context-grass');m.diffuse_color=(.021219,.072272,.056128,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=m.diffuse_color;m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=1;o.data.materials.append(m)
add('tower-teal',-8,-2);add('tower-rust',15,1,math.pi)
for side in [-1,1]:
 team='teal' if side<0 else 'rust'
 add('hero-'+team,side*2,0,side*math.pi/2)
 for i in range(3):add('melee-'+team,side*(4+i*.7),-2+i*1.5,side*math.pi/2)
 for i in range(2):add('ranged-'+team,side*7,2+i*1.4,side*math.pi/2)
for x,y in [(-13,-7),(-11.5,-8.5),(-14,-9.5),(12,-8),(13.6,-9.4),(15,-7.6),(-15,8),(-13.5,9.2),(4,8),(5.7,9),(20,8)]:add('tree',x,y)
for x,y in [(-11,-7),(3,-7),(7,7),(-4,8),(17,8)]:add('rock',x,y)
def lightcam(name,center=(0,0,0),offset=(0,-24,18),res=(1280,720)):
 bpy.ops.object.camera_add(location=Vector(center)+Vector(offset));cam=bpy.context.object;cam.rotation_euler=(Vector(center)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=24/(2*math.tan(math.radians(22.5))); bpy.context.scene.camera=cam
 bpy.ops.object.light_add(type='AREA',location=(-10,-10,20));bpy.context.object.data.energy=2300;bpy.context.object.data.size=8
 bpy.ops.object.light_add(type='SUN',location=(-10,-10,20));bpy.context.object.rotation_euler=(math.radians(28),math.radians(-25),math.radians(-35));bpy.context.object.data.energy=2.1;bpy.context.object.data.angle=.08
 s=bpy.context.scene;s.world=bpy.data.worlds.new('Sky');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.38,.47,.56,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.45
 s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=False;s.render.resolution_x=res[0];s.render.resolution_y=res[1];s.render.resolution_percentage=100;s.view_settings.view_transform='AgX';s.render.image_settings.file_format='PNG';s.render.filepath=str(a.output/f'{name}.png')
 bpy.ops.wm.save_as_mainfile(filepath=str(a.output/f'{name}.blend'),compress=True);bpy.ops.render.render(write_still=True)
lightcam(a.label,center=(-4,0,0) if a.landmarks_only else (0,0,0),offset=(0,-24,18),res=(1280,900) if a.landmarks_only else (1280,720))
if a.landmarks_only:sys.exit(0)
# Detailed hero/troop readability sheet at the same elevation, not a replacement for battle scale.
bpy.ops.wm.read_factory_settings(use_empty=True)
for i,(role,team) in enumerate([(r,t) for t in ['teal','rust'] for r in ['hero','melee','ranged']]):add(role+'-'+team,(i-2.5)*2,0)
add('lane-ground',0,0)
lightcam('units-v3',center=(0,0,1),offset=(0,-10,7),res=(1280,640))
if a.candidates:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 add('barracks-teal',-4,0)
 # Assemble Kenney's actual modular wall, roof and floor pieces at their native 1m grid.
 base=a.candidates/'kenney/Models/GLB format'
 def raw(name,loc,rot=0):
  before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(base/f'{name}.glb'))
  es=set(bpy.context.scene.objects)-before;e=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(e)
  for o in es:
   if o.parent not in es:o.parent=e
  e.location=((loc[0]-3.5)*1.5+3.5,loc[1]*1.5,loc[2]*1.5);e.scale=(1.5,1.5,1.5);e.rotation_euler.z=rot
 for rot in [0,math.pi,math.pi/2]:raw('wall-window-round',(3.5,.5,0),rot)
 raw('wall-door',(3.5,.5,0),-math.pi/2)
 raw('roof-high-point',(3.5,.5,1))
 add('lane-ground',0,0)
 lightcam('actual-free-candidates',center=(0,0,1),offset=(0,-14,10),res=(1280,640))
