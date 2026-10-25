"""Real Blender subprocess checks; outputs isolated below asset-pipeline/.test-work."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.test-work'
WORK.mkdir(exist_ok=True)
env = dict(os.environ, BLENDER_USER_CONFIG=str(WORK / 'config'), BLENDER_USER_EXTENSIONS=str(WORK / 'extensions'))
base = ['blender', '-b', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1']


def run(label, tail, expected, message=None):
  result = subprocess.run(base + tail, capture_output=True, text=True, env=env)
  (WORK / (label + '.log')).write_text(result.stdout + result.stderr)
  assert result.returncode == expected, (label, result.returncode, result.stdout[-1500:])
  if message:
    assert message in result.stdout + result.stderr, label
  print(f'{label}: exit {result.returncode} (expected {expected})')
  return {'case': label, 'exit_code': result.returncode, 'expected': expected}


def check(label, source, output, expected, material='Accent', message=None):
  return run(label, ['--python', str(ROOT / 'scripts/preflight.py'), '--', '--source', str(source), '--output', str(output), '--material', material], expected, message)


results = []
results.append(run('generate', ['--python', str(ROOT / 'scripts/make_fixture.py'), '--', str(WORK / 'fixture.blend')], 0))
results.append(check('normal', WORK / 'fixture.blend', WORK / 'normal', 0))
results.append(check('missing', WORK / 'missing.blend', WORK / 'missing-output', 1, message='source file missing'))
(WORK / 'corrupt.blend').write_bytes(b'not a blend file')
results.append(check('corrupt', WORK / 'corrupt.blend', WORK / 'corrupt-output', 1, message='File format is not supported'))
results.append(check('wrong-material', WORK / 'fixture.blend', WORK / 'wrong-output', 1, material='DoesNotExist', message='target material missing'))
results.append(run('make-no-actions', ['--python-expr', "import bpy; bpy.ops.wm.open_mainfile(filepath=" + repr(str(WORK / 'fixture.blend')) + ", use_scripts=False); [bpy.data.actions.remove(a) for a in list(bpy.data.actions)]; bpy.ops.wm.save_as_mainfile(filepath=" + repr(str(WORK / 'no-actions.blend')) + ", compress=True)"], 0))
results.append(check('no-actions', WORK / 'no-actions.blend', WORK / 'no-actions-output', 1, message='requires mesh, armature and animation actions'))
for folder in ['missing-output', 'corrupt-output', 'wrong-output', 'no-actions-output']:
  assert not (WORK / folder).exists(), 'failed input created outputs'
results.append(check('failed-rerun', WORK / 'missing.blend', WORK / 'normal', 1, message='source file missing'))
assert not (WORK / 'normal/report.json').exists(), 'stale success receipt survived a failed rerun'
(ROOT / 'derived/test-results.json').write_text(json.dumps(results, indent=2) + '\n')
print('All expected outcomes passed; logs remain ignored in .test-work.')
