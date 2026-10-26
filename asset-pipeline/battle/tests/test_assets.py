"""Independent GLB byte inspection. Run with Python 3; no dependency installation."""
import hashlib,json,struct,unittest,copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def glb(path):
 b=path.read_bytes();magic,version,size=struct.unpack_from('<4sII',b)
 assert magic==b'glTF' and version==2 and size==len(b),'invalid GLB header'
 length,kind=struct.unpack_from('<I4s',b,12);assert kind==b'JSON'
 return json.loads(b[20:20+length]),b

def validate(manifest,root=ROOT):
 ids=set();total=0
 for a in manifest['assets']:
  assert a['id'] not in ids;ids.add(a['id'])
  path=root/'exported'/(a['id']+'.glb');j,b=glb(path);total+=len(b)
  assert len(b)==a['bytes'] and hashlib.sha256(b).hexdigest()==a['sha256'],'stale or tampered asset'
  assert a['license']=='CC0-1.0' and a['source'] and a['forward']=='+Z' and a['groundY']==0
  assert not any('uri' in v for key in ['buffers','images'] for v in j.get(key,[])),'GLB must be self-contained'
  tris=sum(j['accessors'][p['indices']]['count']//3 for m in j['meshes'] for p in m['primitives']);assert tris==a['triangles']
  assert all(m.get('alphaMode','OPAQUE')=='OPAQUE' for m in j.get('materials',[]))
  assert len(j.get('materials',[]))<=8,'too many materials'
  budget={'hero':15000,'minion':3000,'tower':8000,'barracks':8000,'base':8000}.get(a['kind'],3000)
  assert tris<=budget
  if a['kind']!='ground':assert abs(a['bounds']['min'][1])<.01,'rest feet/base must meet ground'
  if a['kind'] in ['hero','minion']:
   assert len(j['skins'])==1 and len(j['skins'][0]['joints'])==15
   names={x['name'] for x in j['animations']};assert set(a['clips'].values())<=names
   assert len(j['meshes'])==1,'one joined skinned mesh per unit'
   height=a['bounds']['max'][1]-a['bounds']['min'][1]
   assert (2<=height<=2.3) if a['kind']=='hero' else (1<=height<=1.3)
  limits={'tower':(6,2.4),'barracks':(3,2.6),'base':(6,4.5)}
  if a['kind'] in limits:
   h,r=limits[a['kind']];assert a['nominalHeight']<=h and a['footprintRadius']<=r
 assert total<=12*1024*1024
 assert {f'{role}-{team}' for role in ['hero','melee','ranged','tower','barracks','base'] for team in ['teal','rust']}<=ids
 return total
class Assets(unittest.TestCase):
 def test_real_glbs(self):self.assertGreater(validate(json.loads((ROOT/'manifest.json').read_text())),0)
 def test_reject_stale_hash(self):
  m=json.loads((ROOT/'manifest.json').read_text());m['assets'][0]['sha256']='0'*64
  with self.assertRaises(AssertionError):validate(m)
 def test_reject_missing_clip(self):
  m=json.loads((ROOT/'manifest.json').read_text());next(a for a in m['assets'] if a['kind']=='hero')['clips']['attack']='fake'
  with self.assertRaises(AssertionError):validate(m)
 def test_ground_is_only_seam_overlapping_road(self):
  m=json.loads((ROOT/'manifest.json').read_text());a=next(x for x in m['assets'] if x['id']=='lane-ground');j,_=glb(ROOT/'exported/lane-ground.glb')
  self.assertEqual(a['bounds']['min'][1],0)
  self.assertAlmostEqual(a['bounds']['min'][0],-6.03,places=4)
  self.assertAlmostEqual(a['bounds']['max'][0],6.03,places=4)
  self.assertNotIn('battle-grass',{x.get('name') for x in j['materials']})
  self.assertNotIn('soil-edge',{x.get('name') for x in j['nodes']})
 def test_source_hashes(self):
  p=json.loads((ROOT/'source/provenance.json').read_text())
  for row in p['kaykit']['files']:self.assertEqual(hashlib.sha256((ROOT/'source'/row['path']).read_bytes()).hexdigest(),row['sha256'])
  self.assertEqual(hashlib.sha256((ROOT/'source/guard-rig-actions.blend').read_bytes()).hexdigest(),p['guard']['sha256'])
if __name__=='__main__':unittest.main()
