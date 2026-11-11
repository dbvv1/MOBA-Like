"""Fast failure-path tests; actual Blender recipe checks are separate."""
import contextlib
import io
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from recipe_options import parse_options, SOURCE_ROOT, REPO
from death_contact import corrected_values, root_y_curve, ContactError


class RecipeOptionsTests(unittest.TestCase):
  def test_default_preserves_the_shipped_output(self):
    self.assertEqual(parse_options([]), (SOURCE_ROOT,False))

  def test_contact_requires_isolated_explicit_output(self):
    self.assertEqual(parse_options(['--output-dir','outputs/recipe','--death-contact'],retarget=True),
                     (REPO/'outputs/recipe',True))
    for args in [['--death-contact'],['--output-dir','outputs'],['--output-dir','asset-pipeline/heroes/veyra-release'],
                 ['--output-dir','outputs/../asset-pipeline'],['--output-dir','outputs/recipe','--unknown']]:
      with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
        parse_options(args,retarget=True)

  def test_build_does_not_silently_accept_retarget_flag(self):
    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
      parse_options(['--output-dir','outputs/recipe','--death-contact'])


class RootContactTests(unittest.TestCase):
  def setUp(self):
    self.original=[(i+1,i/100) for i in range(31)]
    self.offsets=[0 if i==0 or i>=17 else .05 for i in range(31)]

  def test_lift_is_absolute_and_repeatable(self):
    values=corrected_values(self.original,self.original,self.offsets)
    self.assertEqual(values[0],self.original[0][1])
    self.assertEqual(values[17:], [v for _,v in self.original[17:]])
    self.assertAlmostEqual(values[10],.15)
    self.assertEqual(corrected_values([(i+1,v) for i,v in enumerate(values)],self.original,self.offsets),values)

  def test_missing_keys_and_changed_times_fail(self):
    for current in [[],self.original[:-1],[(f+.5,v) for f,v in self.original]]:
      with self.subTest(current=current),self.assertRaises(ContactError):
        corrected_values(current,self.original,self.offsets)

  def test_unrelated_edit_and_nonfinite_input_fail(self):
    for value in [.7,float('nan'),float('inf')]:
      current=list(self.original);current[8]=(9,value)
      with self.subTest(value=value),self.assertRaises(ContactError):
        corrected_values(current,self.original,self.offsets)
    for offset in [-.01,float('nan'),float('inf')]:
      offsets=list(self.offsets);offsets[8]=offset
      with self.subTest(offset=offset),self.assertRaises(ContactError):
        corrected_values(self.original,self.original,offsets)

  def test_missing_or_duplicate_root_curve_fails(self):
    curve=SimpleNamespace(data_path='pose.bones["Root"].location',array_index=1)
    self.assertIs(root_y_curve(SimpleNamespace(fcurves=[curve])),curve)
    for curves in [[],[curve,curve]]:
      with self.assertRaises(ContactError):root_y_curve(SimpleNamespace(fcurves=curves))


if __name__=='__main__':unittest.main()
