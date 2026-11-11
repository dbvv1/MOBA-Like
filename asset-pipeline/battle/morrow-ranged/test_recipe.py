"""Fail-closed recipe entry tests. Requires installed Blender 4.3.2."""
import subprocess, tempfile, unittest
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]
SCRIPT=Path(__file__).with_name('build.py')
class EntryTests(unittest.TestCase):
 def run_bad(self,args,needle):
  result=subprocess.run(['blender','-b','--disable-autoexec','--python-exit-code','1','--python',str(SCRIPT),'--',*args],cwd=REPO,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  self.assertNotEqual(result.returncode,0);self.assertIn(needle,result.stdout)
 def test_missing_output(self):self.run_bad([],'--output-dir')
 def test_protected_output(self):self.run_bad(['--output-dir','asset-pipeline/battle/exported'],'Output must be')
 def test_missing_source(self):
  with tempfile.TemporaryDirectory() as d:self.run_bad(['--output-dir','outputs/morrow-failure','--source-dir',d],'FileNotFoundError')
 def test_changed_source(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'hero-teal.blend').write_bytes(b'not a source')
   self.run_bad(['--output-dir','outputs/morrow-failure','--source-dir',d],'Source hash mismatch')
if __name__=='__main__':unittest.main()
