import importlib.util
import math
from pathlib import Path
import unittest
import sys
sys.dont_write_bytecode = True

path = Path(__file__).resolve().parents[2] / 'tools/build-skill-audio.py'
spec = importlib.util.spec_from_file_location('recipe', path)
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)

class Recipe(unittest.TestCase):
    def test_pair_is_repeatable_bounded_and_distinct(self):
        source = [math.sin(i*.29)*.2 for i in range(24000)]
        q, w = [recipe.make(source,k) for k in ('q','w')]
        self.assertEqual(q,recipe.make(source,'q'))
        self.assertEqual(len(q),8640)
        self.assertEqual(len(w),14880)
        self.assertNotEqual(q,w[:len(q)])
        for data in (q,w):
            self.assertLessEqual(max(map(abs,data)),.55)
            self.assertTrue(all(math.isfinite(x) for x in data))
            self.assertEqual(data[0],0)
            self.assertLess(abs(data[-1]),.001)
    def test_invalid_input_is_rejected(self):
        for source,kind in (([], 'q'), ([float('nan')], 'w'), ([0.0], 'unknown')):
            with self.assertRaises(ValueError):recipe.make(source,kind)
    def test_silent_source_still_has_original_tone_layer(self):
        for kind in ('q','w'):
            data=recipe.make([0.0]*48000,kind)
            self.assertGreater(sum(x*x for x in data),0)

if __name__=='__main__':unittest.main()
