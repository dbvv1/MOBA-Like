"""Actual-file negative cases for the new placeholder revision contract."""
import importlib.util
import json
from pathlib import Path
import bpy

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('guard_validation',ROOT/'validate.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
work=ROOT/'.test-work';work.mkdir(exist_ok=True)
results=[]
base=v.inspect(ROOT/'assets/blue.blend')
long=v.inspect(ROOT/'assets/blue-long.blend')
v.compare_revision(base,long)
results.append('normal weapon-length revision accepted')
# Change a real mesh outside the allowed blade edit and save/reopen it.
bpy.data.objects['Coat'].data.vertices[0].co.x+=.08
bpy.ops.wm.save_as_mainfile(filepath=str(work/'wrong-body.blend'),compress=True)
wrong=v.inspect(work/'wrong-body.blend')
try:
  v.compare_revision(base,wrong)
except AssertionError as e:
  assert 'outside blade vertices' in str(e)
  results.append('real off-scope torso edit rejected')
else:raise AssertionError('off-scope edit accepted')
try:
  v.inspect(work/'missing.blend')
except RuntimeError:
  results.append('missing source rejected by Blender')
else:raise AssertionError('missing source accepted')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blue.blend'),use_scripts=False)
bpy.data.actions.remove(bpy.data.actions['walk'])
bpy.ops.wm.save_as_mainfile(filepath=str(work/'missing-walk.blend'),compress=True)
try:
  v.inspect(work/'missing-walk.blend')
except AssertionError:
  results.append('real file without walk rejected')
else:raise AssertionError('missing walk accepted')
(ROOT/'test-results.json').write_text(json.dumps({'status':'passed','cases':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
