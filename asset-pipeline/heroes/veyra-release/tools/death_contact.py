"""Apply the pinned contact lift without accumulating it on repeated retargets."""
import sys
import math
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[3] / 'veyra-death-contact'
sys.path.insert(0, str(PACKAGE / 'tools'))
from baseline import resolve_baseline_dir, verify_baseline
from glb_contact import Asset, ContactError, root_offsets


def root_y_curve(action):
  curves = [curve for curve in action.fcurves
            if curve.data_path == 'pose.bones["Root"].location' and curve.array_index == 1]
  if len(curves) != 1:
    raise ContactError('death action must have exactly one Root location Y curve')
  return curves[0]


def corrected_values(current, original, offsets):
  """Validate the entire curve before returning absolute corrected keys."""
  if not len(current) == len(original) == len(offsets) == 31:
    raise ContactError('death contact requires the original 31 Root Y keys')
  corrected = []
  for index, ((frame, value), (old_frame, old_value), offset) in enumerate(zip(current, original, offsets)):
    if not all(math.isfinite(v) for v in (frame,value,old_frame,old_value,offset)) or offset < 0:
      raise ContactError('death contact keys and lift must be finite; lift must be nonnegative')
    if frame != old_frame or frame != index + 1:
      raise ContactError('death Root Y key times differ from the pinned source')
    expected = old_value + offset
    if min(abs(value - old_value), abs(value - expected)) > 1e-6:
      raise ContactError('death Root Y was edited outside the pinned contact recipe')
    corrected.append(expected)
  return corrected


def apply_contact(team):
  import bpy
  if team not in ('teal', 'rust'):
    raise ContactError('unknown Veyra faction')
  baseline = resolve_baseline_dir()
  verify_baseline(baseline)
  action = bpy.data.actions.get('death')
  if action is None:
    raise ContactError('source has no death action')
  curve = root_y_curve(action)
  offsets, _details = root_offsets(Asset(baseline / 'exported' / f'veyra-{team}.glb'),
                                  clip='death', zero_from_frame=18)
  # Load only the original action, not another scene or another rig. This gives
  # source-space keys, not glTF-space translations transformed by export.
  with bpy.data.libraries.load(str(baseline / 'source' / f'veyra-{team}.blend'), link=False) as (source, target):
    if 'death' not in source.actions:
      raise ContactError('pinned editable source has no death action')
    target.actions = ['death']
  original = target.actions[0]
  try:
    values = corrected_values([tuple(p.co) for p in curve.keyframe_points],
                              [tuple(p.co) for p in root_y_curve(original).keyframe_points], offsets)
  finally:
    bpy.data.actions.remove(original)
  for point, value in zip(curve.keyframe_points, values):
    point.co[1] = value
    point.handle_left[1] = value
    point.handle_right[1] = value
  curve.update()
