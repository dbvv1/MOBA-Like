# Veyra death ground-contact candidates

Editable source candidates and rebuilt GLBs for the two Veyra faction exports (`veyra-teal`, `veyra-rust`) that remove the death foot penetration already acknowledged in [`../heroes/veyra-release/README.md`](../heroes/veyra-release/README.md).

**Status: source-rebuilt candidates.** `source/veyra-{teal,rust}.blend` are editable copies of the shipped sources with only the death `Root` location Y keyframes changed; `exported/veyra-{teal,rust}.glb` are exported from those files. The build runs in a background Python with the Blender `bpy` module (5.2.3 LTS, layered actions), uses no GUI/GPU/network, and reopens the saved source to prove the GLB rebuild is reproducible. The old binary-patch GLBs are kept in `runtime-fallback/` as fallback evidence. Nothing under `../heroes/` was modified.

## Adoption (these candidates are not loaded by the game)

The game loader does not see this directory. `src/render/battle-assets.ts` globs only `asset-pipeline/heroes/veyra-release/exported/*.glb` and resolves `heroManifest.assets[].file`; no code references `asset-pipeline/veyra-death-contact/`. Merging this unit therefore does **not** change the in-game death motion — it still plays the old clip until a separate adoption change lands. Adoption must do all of the following in one change, in this order.

### 0. Pin the `b489ed3` baseline before overwriting the heroes release

All offsets and contact checks are defined against the shipped `b489ed38` export. The adopted GLB cannot serve as its own baseline: `root_offsets(..., zero_from_frame=18)` forces every key at frame 18 and later to zero, so recomputing from an already fixed export yields offsets of at most **2.1e-9 m** (measured on this package), not a lift of the 0.000182 m tail. Rebuilding the old source with those near-zero offsets re-exports the unfixed clip and fails acceptance; rebuilding the fixed source is a no-op. Prepare the original files from the local Git object database, never from the mutable heroes release:

```sh
python asset-pipeline/veyra-death-contact/tools/baseline.py
python asset-pipeline/veyra-death-contact/tools/baseline.py --check-only
```

`baseline-lock.json` pins the original commit, manifest, both GLBs and both editable sources by SHA-256 and byte count. Preparation extracts that exact commit without fetching (including disabling Git lazy fetch), verifies every byte before publishing the directory, and verifies an existing snapshot without overwriting it. Missing local history, missing files or mismatched bytes fail with exit 2. The snapshot is ignored by Git; a fresh checkout needs preparation before selecting it. The check-only command needs no Git history.

All Python contact checks and both candidate builders verify the full baseline against this independent lock before consuming it. They now default to this prepared snapshot. Missing or changed snapshot files fail closed; no Python consumer in this package falls back to the heroes release or prepares/fetches files automatically. Hash identity is enforced, not filesystem write protection: edits to a snapshot are detected on the next use.

The manifest is required, not only the GLBs: every Python consumer in this package verifies all five files. `VEYRA_DEATH_BASELINE_DIR` can select another exact snapshot; relative values resolve from the repository root. `check_contact.py` and `build_candidates.py` also accept `--baseline-dir`. Overrides do not relax the hash checks. No environment variable is needed for the default prepared snapshot.

### 1. Copy the adopted artifacts and update the heroes manifest

```sh
cp asset-pipeline/veyra-death-contact/source/veyra-{teal,rust}.blend asset-pipeline/heroes/veyra-release/source/
cp asset-pipeline/veyra-death-contact/exported/veyra-{teal,rust}.glb asset-pipeline/heroes/veyra-release/exported/
```

Update `asset-pipeline/heroes/veyra-release/manifest.json` for both assets:

| id | `sha256` | `bytes` |
|---|---|---|
| `veyra-teal` | `32102965a65ea13248cbb88d28f522e3e3f8b9bd5ccf99dc9b3dedcf5ab60e12` | 164164 |
| `veyra-rust` | `80e0512ca0f57aed589c8a0aca9f5c1de4d0aa789f6dd43a0ab0a2beb1a2e921` | 165016 |

### 2. Do not rerun the heroes build recipe as-is

`asset-pipeline/heroes/veyra-release/tools/build.py` reopens `asset-pipeline/battle/source/hero-{team}.blend`, rewrites `source/veyra-{team}.blend`, and `retarget.py` re-exports it. Neither applies this card's death `Root` Y offsets, so running either after step 1 silently resets the fix.

The supported rebuild path for this card is this package's builder, run against the pinned baseline:

```sh
< bpy python > asset-pipeline/veyra-death-contact/tools/build_source_candidates.py
```

Then copy the rebuilt `source/` and `exported/` into the heroes release again and rerun the acceptance commands from step 5. The candidate and fallback manifests already point at the pinned baseline, with the original manifest, source and export hashes unchanged. The rebuild refreshes these provenance fields against the same verified snapshot. No manual environment or provenance edit is needed when adopting from the default snapshot. Overwriting only the GLB and then running the heroes recipe is not a supported path.

#### Optional: keep the heroes recipe canonical

If Veyra's heroes recipe must remain the canonical build (for example a later full-repo re-export), the offset step can be ported into it, but that is a separate pipeline change and not part of the copy-only adoption above. It must do all of the following, or it will produce a file set that looks correct while `npm test` still fails:

- Apply the death `Root` location Y offsets from `reports/death-root-offsets.json` after the recipe has finished writing the rig/action data and before `retarget.py` exports the GLB. The heroes scripts still use the pre-5.0 `Action.fcurves` API; this package's builder uses the 5.x layered-action channelbag API, so the offset code cannot be copied verbatim.
- Update the pinned `sharedAssets` sha256 for `asset-pipeline/heroes/veyra-release/tools/build.py` and `asset-pipeline/heroes/veyra-release/tools/retarget.py` in `default-source-manifest.json` in the same change (step 3). `tests/client/default-entry.test.ts:7` hashes every listed path, including these two scripts, so editing them without refreshing their pins fails `npm test` even when the GLB, source and manifest hashes are all correct.
- Rerun step 5 and the package acceptance tests; confirm the ported recipe still reproduces the delivered death `Root` Y keys (baseline + offsets) and leaves the other four actions unchanged.

Until that port lands, treat the heroes recipe as superseded for this hero: a bare rerun rewrites the death action without the offsets and returns the old penetration.

### 3. Update every lock that pins the shipped GLB/source

Adoption is not complete while any of these still point at `b489ed3`:

- `default-source-manifest.json` — `sharedAssets` entries for `asset-pipeline/heroes/veyra-release/manifest.json`, both `exported/veyra-*.glb` and both `source/veyra-*.blend`; `tests/client/default-entry.test.ts:7` hashes every listed `path`.
- `default-source-manifest.json` — **only if the optional heroes-recipe port in step 2 was performed**, the `sharedAssets` entries for `asset-pipeline/heroes/veyra-release/tools/build.py` (currently pinned at `ae6ee8f1e8c7946bf5fef8fb8147bebd4c60a4387fcf358771f416f840c1a45f`) and `asset-pipeline/heroes/veyra-release/tools/retarget.py` (currently pinned at `617f6ac209e05dcb3ab5906c758eadb5a196f84d9df54617e103139e79105f5c`). Recompute each with `sha256sum` after the port and update them in the same change; leaving them stale fails the same `tests/client/default-entry.test.ts:7` hash check. A copy-only adoption leaves both scripts untouched and must not change their pins.
- `default-source-manifest.json` — `asset-pipeline/heroes/veyra-release/README.md` is also a pinned `sharedAssets` entry; refresh it only if adoption rewrites that file's known-defect paragraph.
- `asset-pipeline/quiet-family/standards/layout-manifest.json` — `entries[id=hero].sourceSha256` must be the new teal SHA; regenerate with `node tools/build-quiet-standards.mjs` (`tests/client/content-standards.test.ts:11`).
- `asset-pipeline/content-set/standard-set.json` — `files[id=veyra-teal].sha256`; then run `PYTHONUTF8=1 python asset-pipeline/content-set/normalize.py` to regenerate `reports/normalized-set.json` (`normalize.py::build` raises `Source changed` on a mismatch; the `PYTHONUTF8=1` prefix is needed where the locale is not UTF-8). The smaller GLB also changes `asset-pipeline/content-set/test_normalize.py`'s pinned `totalReferencedBytes` from 680900 to **663412** (680900 − (181652 − 164164) = 663412, a 17488-byte drop); `standard-set.json` references only `veyra-teal`, not `veyra-rust`, so don't count the rust delta. After the lock update, `PYTHONUTF8=1 python asset-pipeline/content-set/normalize.py` must print `Validated 14 locked files; 663412 bytes.` The teal triangle count stays 1189.

### 4. Re-baseline `tests/client/hero-source.test.ts`

The candidates were re-exported with Blender 5.2.3, which reorders scene children, skin joints and animation channels. Measured on the delivered files: the baseline bone traversal starts `Root,Torso,Head,…`, while the candidate starts `Root,Thigh_L,Shin_L,…`. Therefore:

- `bones(source.asset)` (line 30) must be compared as a sorted `name:parent` list (or as a set), not in traversal order; the bone names and parent names are unchanged.
- `a.tracks.map(t => t.name)` (line 34) must be matched by track name (build a name→track map), not by array index. `idle`, `walk`, `hurt` and `death` carry the same track names, and the values by name are identical except for `death` `Root.translation` Y. Index-wise comparison fails on all four clips even though the decoded data is unchanged.
- Re-baseline the death `Root.position` Y track (glTF `Root.translation`): candidate key = baseline key + the offset in `reports/death-root-offsets.json` (maximum **0.0518 m** at key frame 13; the worst half-frame foot contact is 13.5). Keep `1e-5` for every other track. The manifest hash assertion in the same test follows the updated `manifest.assets[].sha256`.
- Alternatively, rebuild `asset-pipeline/battle/exported/hero-teal.glb` in the same channel order and update `asset-pipeline/battle/manifest.json`. That path also changes two entries in `default-source-manifest.json` that `tests/client/default-entry.test.ts:7` hashes: `asset-pipeline/battle/exported/hero-teal.glb` (line 316) and `asset-pipeline/battle/manifest.json` (line 356). Update both `sha256` values (and any other changed battle file) before running `npm test`, or the default-entry case fails. Matching by name is the smaller change.

### 5. Run the full checks

```sh
python asset-pipeline/veyra-death-contact/tools/baseline.py --check-only
python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v
python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.01
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005
python asset-pipeline/veyra-death-contact/tools/build_candidates.py --check-only
PYTHONUTF8=1 python asset-pipeline/content-set/normalize.py
PYTHONUTF8=1 python -m unittest discover -s asset-pipeline/content-set -p 'test_*.py'
npm test
npm run build
```

These commands are the CPU portion of adoption acceptance: `npm test` covers `default-entry.test.ts`, `content-standards.test.ts` and `hero-source.test.ts`; the two Python discover commands cover the contact checks and content-set normalization.


The real Three.js consumer test (`tests/client/veyra-contact-consumer.test.ts`) now consumes the original snapshot through `tests/veyra-baseline.ts`. Before parsing either GLB, it verifies all five files against `baseline-lock.json` by exact byte count and SHA-256 and retains those verified bytes. Its oracle no longer reads the mutable heroes release or its manifest. The same `VEYRA_DEATH_BASELINE_DIR` override rules apply. Fresh checkouts must explicitly run `python asset-pipeline/veyra-death-contact/tools/baseline.py` before `npm test`; missing or altered snapshots fail with an actionable error, with no preparation, fetch, fallback or skip in the tests. A shallow checkout without the pinned commit needs that local history or an exact external snapshot. `tests/veyra-baseline.test.ts` covers missing files, same-size tampering, changed sizes, a substituted candidate with a matching mutable manifest, and override resolution. This migration does not port the canonical heroes recipe, adopt runtime assets, or pass the visual gate.

## Reproduced defect

`tests/check_contact.py --mode reproduce` samples the shipped baseline GLBs at 31 integer frames plus 30 half frames (61 samples per team). Both teams reproduce the same defect:

| item | result |
|---|---|
| worst foot / body minimum | **-0.051905 m** at frame 13.5 (`Foot_L`) |
| frames below -0.01 m | 6–17 (integer keys), worst 13–16 at about -0.050 to -0.052 m |
| first frame | 0.000000 m |
| final frames | -0.0002 m (hand/arm support), feet lifted while lying |

The reported foot penetration is therefore real and reproducible; no source change is justified without that evidence.

## Source candidate method

For each team the builder opens the shipped editable `.blend` read-only, evaluates the same per-key lift as the fallback patcher, and adds it to the death `Root` location Y keyframes through the Blender 5.x layered-action channelbag API (`Action.fcurves` was removed in Blender 5.x):

- `source/veyra-{teal,rust}.blend` — editable copies; only the death `Root` location Y channel is touched (16 of the 31 keys carry a nonzero lift; the rest stay identical). All five actions, bone names/parents, bind pose, mesh, materials and team colours are untouched.
- `exported/veyra-{teal,rust}.glb` — re-exported with the recipe's original settings (`export_format='GLB'`, `export_animations=True`, `export_animation_mode='ACTIONS'`, `export_force_sampling=True`, `export_yup=True`).
- Frame 1 (key 0) and frames 18–31 (keys 17–30) stay at zero, preserving the original first stance and final lying pose. Keys are 0-based in `reports/death-root-offsets.json`; the README uses frames.
- Reopening a saved `source/*.blend` and re-exporting reproduces its `exported/*.glb` byte-for-byte (`--check-only` asserts this). The `.blend` container bytes themselves may differ between Blender saves, so the manifest records the delivered hashes. The shipped sources carry two unused legacy materials (`M_Joints`, `M_Main`) with no users; they are kept with fake users so the resave does not silently drop them.

Because the shipped `.blend` already contains the final rig/mesh/action data, the candidate does not rerun the heroes `build.py` / `retarget.py`; those files are read-only here and still use the pre-5.0 `Action.fcurves` API. The builder reproduces their export settings directly.

## Runtime fallback method

`tools/build_candidates.py` (stdlib only) computes the lowest **body** vertex per death key, excludes focus-only vertices, and adds `max(0, -minY)` to the `Root` node translation Y at that key. The lift mirrors the baseline penetration, so the feet stay in contact while falling; nothing is lowered. Only the 31 float Y words of the death `Root` translation accessor are rewritten (55 changed bytes per asset); the GLB JSON chunk and every other binary byte are copied verbatim. `runtime-fallback/manifest.json` records the byte-level diff.

Apart from the intended death `Root` Y lift, the shipped 4.3 export and the 5.2.3 rebuild decode to identical channels for all five actions when matched by node name, so the source path and the fallback land on the same numbers.

## Results

Both the source-rebuilt candidates and the runtime fallback pass `tests/check_contact.py` at 0.01 m and 0.005 m:

| metric | teal | rust |
|---|---|---|
| lowest body minimum | -0.000182 m (frame 31) | -0.000182 m (frame 31) |
| highest body minimum (support contact) | +0.014601 m (frame 17.5) | +0.014601 m (frame 17.5) |
| lowest foot minimum | -0.000127 m | -0.000127 m |
| lowest focus minimum | +0.050518 m | +0.050518 m |
| samples | 61 | 61 |

- Every sample has a shoe sole or body support surface inside the required -0.01…+0.02 m band; the clip never goes airborne.
- The focus never drops below its same-frame baseline minimum minus 0.01 m. Old weapon contact defects are not repaired.
- The first and last frames are bit-identical in skinned positions to the baseline; frames 30 and 31 are stable.
- Death duration is unchanged (keys 0.0333…1.0333 s at 30 fps).
- `idle`, `walk`, `attack` and `hurt` decode identically to the baseline by node name; node names, parent map, skin joint set, inverse bind matrices (by joint name), mesh positions/weights/indices (by material), rest-pose skinning, material definitions and team colours are preserved. The rebuilt container may reorder nodes/joints, which the card permits.
- The source-rebuilt GLBs differ from the baseline in decoded data only in the death `Root` translation Y keys: every one equals `baseline Y + offset` within 1e-6 m. The 5.2.3 container reorders scene nodes, skin joints and animation channels (and therefore `JOINTS_0` indices and accessor layout); bone names, parent map, per-bone skin weights, decoded values by track name and all other actions are equivalent.

## Failure paths covered

`tests/test_baseline.py` covers exact snapshot preparation and repeat verification, unavailable local Git history, corrupt Git bytes before any output is written, each missing/corrupt pinned file, corrected sources/exports paired with a matching mutable manifest, missing-snapshot CLI errors, and a file blocking the output parent. These tests work with either the original release or the explicitly selected snapshot.

`tests/test_checks.py` (32 tests) also exercises: missing GLB, missing animation clip, invalid tolerance (`0`, negative, `> 0.02`, `NaN`, boolean), zero penetration threshold on the CLI, a bind-pose skinning invariant, a negative control that copies the unfixed baseline and must fail the contact acceptance, the runtime-fallback byte-diff rule, source/candidate hash checks against the manifest, and repo-relative resolution of `VEYRA_DEATH_BASELINE_DIR`. Two `AdoptionDocTests` keep the adoption instructions consistent with the delivered files: the step 1 table's SHA-256 and byte counts must equal both the delivered GLBs and `manifest.json`, and because step 2 names the heroes recipe scripts (`build.py`, `retarget.py`), step 3 must place each script's path directly before its current `sharedAssets` sha256; the test reads those pins from `default-source-manifest.json` and fails when a pin is missing, malformed or stale. The mesh invariants also compare normals and nonzero skin influences by bone name, with mutation controls for both. Source-curve unit tests reject changed key frames, interpolation and counts without requiring bpy; these synthetic checks do not replace reopening the actual source. The source builder refuses a missing upstream file, an upstream hash mismatch, a wrong death key count, a source that does not reproduce its GLB, or a rebuilt GLB that fails either tolerance. `tools/build_candidates.py` accepts relative or repository-external `--baseline-dir` values and reports a `ContactError` (exit 2) instead of a traceback.

## Commands

From the repository root, prepare the ignored baseline once (and verify it on later runs):

```sh
python asset-pipeline/veyra-death-contact/tools/baseline.py
python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.01
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005
python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v
python asset-pipeline/veyra-death-contact/tools/build_candidates.py            # runtime fallback
python asset-pipeline/veyra-death-contact/tools/build_candidates.py --check-only
```

These commands keep using the original snapshot after adoption overwrites the heroes export. A fresh checkout must prepare it first; see Adoption step 0.

Source rebuild (background only; no GUI). Run it with a Python that provides the Blender `bpy` module — the same kind of interpreter that backs the `glbprep` command:

```sh
< bpy python > asset-pipeline/veyra-death-contact/tools/build_source_candidates.py
< bpy python > asset-pipeline/veyra-death-contact/tools/build_source_candidates.py --check-only
```

The normal run rewrites `source/`, `exported/`, `manifest.json` and `reports/death-root-offsets.json`; `--check-only` reopens the delivered sources, re-exports to a temporary file, compares SHA-256 with `exported/`, and reruns both tolerances without writing. `tests/check_source_bpy.py` additionally opens the upstream and delivered `.blend` files and proves that nothing outside the death `Root` location Y channel changed (and that each key equals upstream + the recorded offset):

```sh
< bpy python > asset-pipeline/veyra-death-contact/tests/check_source_bpy.py
```

The checks themselves use only the Python standard library: no Blender, browser, GPU, network, clock or machine-specific path.

## Files

- `source/veyra-{teal,rust}.blend` — editable source candidates (Blender 5.2.3 LTS).
- `exported/veyra-{teal,rust}.glb` — GLBs rebuilt from the source candidates (primary deliverable).
- `runtime-fallback/exported/veyra-{teal,rust}.glb` — binary-patched GLBs kept as fallback evidence.
- `manifest.json` — baseline GLB, upstream source, delivered source and candidate hashes, per-key offsets, contact summary, export settings and editable-source status.
- `runtime-fallbac…7824 tokens truncated…ode:any)=>{
    if(!node.isSkinnedMesh)return;
    const material=materialName(node);
    const skinIndex=node.geometry.attributes.skinIndex;
    const skinWeight=node.geometry.attributes.skinWeight;
    const classes:VertexClass[]=[];
    for(let index=0;index<skinIndex.count;index+=1){
      let best=0,bestWeight=-1;
      for(let slot=0;slot<4;slot+=1){
        const weight=skinWeight.getComponent(index,slot);
        if(weight>bestWeight){bestWeight=weight;best=slot;}
      }
      const bone=node.skeleton.bones[skinIndex.getComponent(index,best)].name as string;
      const foot=bone==='Foot_L'||bone==='Foot_R';
      const weapon=isWeapon(material,bone);
      classes.push({bone,foot,weapon});
    }
    parts.push({mesh:node,material,classes});
  });
  return parts;
}

function contact(root:any,parts:Part[]){
  root.updateMatrixWorld(true);
  const point=new Vector3();
  let body=Infinity,foot=Infinity,bodyBone='',footBone='';
  for(const {mesh,classes} of parts){
    for(let index=0;index<classes.length;index+=1){
      mesh.getVertexPosition(index,point);
      point.applyMatrix4(mesh.matrixWorld);
      const y=point.y;
      if(!classes[index].weapon&&y<body){body=y;bodyBone=classes[index].bone;}
      if(classes[index].foot&&y<foot){foot=y;footBone=classes[index].bone;}
    }
  }
  return {body,foot,bodyBone,footBone};
}

function deathFrames(){
  const rows:{frame:number;sourceTime:number;deathElapsed:number}[]=[];
  for(let frame=1;frame<=31;frame+=0.5){
    rows.push({frame,sourceTime:frame/30,deathElapsed:(frame-1)/30});
  }
  return rows;
}

function boneHierarchy(asset:GLTF){
  const rows:string[]=[];
  asset.scene.traverse(node=>{if(node.type==='Bone')rows.push(`${node.name}:${node.parent?.name??''}`);});
  return rows.sort();
}

function boneWorld(root:any){
  root.updateMatrixWorld(true);
  const pose=new Map<string,number[]>();
  root.traverse((node:any)=>{if(node.isBone)pose.set(node.name,node.matrixWorld.toArray());});
  return pose;
}

function poseDelta(left:Map<string,number[]>,right:Map<string,number[]>){
  let worst=0;
  expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
  for(const [name,matrix] of left){
    const other=right.get(name)!;
    for(let index=0;index<matrix.length;index+=1)worst=Math.max(worst,Math.abs(matrix[index]!-other[index]!));
  }
  return worst;
}

// Decoded mesh identity by material name: positions, normals and skin
// influences keyed by bone name (candidate containers reorder joints, so raw
// JOINTS_0 indices cannot be compared).
function meshSignature(asset:GLTF){
  const groups=new Map<string,{vertices:number;triangles:number;records:string[]}>();
  asset.scene.traverse((node:any)=>{
    if(!node.isMesh)return;
    const material=materialName(node);
    const group=groups.get(material)??{vertices:0,triangles:0,records:[]};
    groups.set(material,group);
    const position=node.geometry.attributes.position;
    const normal=node.geometry.attributes.normal;
    const index=node.geometry.index;
    expect(normal,'every primitive must keep NORMAL').toBeDefined();
    expect(normal.count).toBe(position.count);
    group.vertices+=position.count;
    group.triangles+=(index?index.count:position.count)/3;
    const skinIndex=node.geometry.attributes.skinIndex;
    const skinWeight=node.geometry.attributes.skinWeight;
    for(let vertex=0;vertex<position.count;vertex+=1){
      const influences:string[]=[];
      if(skinIndex&&skinWeight){
        for(let slot=0;slot<4;slot+=1){
          const weight=skinWeight.getComponent(vertex,slot);
          if(weight===0)continue;
          influences.push(`${node.skeleton.bones[skinIndex.getComponent(vertex,slot)].name}=${weight.toFixed(6)}`);
        }
        influences.sort();
      }
      group.records.push([
        position.getX(vertex).toFixed(5),position.getY(vertex).toFixed(5),position.getZ(vertex).toFixed(5),
        normal.getX(vertex).toFixed(4),normal.getY(vertex).toFixed(4),normal.getZ(vertex).toFixed(4),
        influences.join(','),
      ].join('|'));
    }
  });
  return groups;
}

const motionOptions={recoilLayer:'override' as const};

function summary(motion:any){
  return motion.inspect().map((action:any)=>`${action.clip}:${action.tracks}:${action.weight.toFixed(6)}:${action.time.toFixed(6)}`).sort();
}

function driveNonDeath(motion:any,clip:'idle'|'walk'|'attack'|'hurt',time:number){
  if(clip==='idle'||clip==='walk'){motion.play(clip);motion.advance(time);motion.sample({time:0});return;}
  if(clip==='hurt'){motion.sample({time:0.2+time,hurtAt:0.2});return;}
  motion.sample({time,attack:{castId:null,startedAt:0,windup:0,resolvedAt:0,cancelledAt:null}});
}

describe('received Veyra death-contact candidates through the production consumer',()=>{
  it('excludes focus materials independently of the dominant bone',()=>{
    for(const material of ['battle-wood','battle-focus']){
      for(const bone of ['Hand_L','Foot_L','Root',''])expect(isWeapon(material,bone)).toBe(true);
    }
    for(const material of ['battle-gold','battle-teal','battle-rust']){
      expect(isWeapon(material,'Hand_L')).toBe(true);
      expect(isWeapon(material,'Foot_L')).toBe(false);
    }
    expect(isWeapon('','Hand_L')).toBe(false);
    expect(isWeapon('battle-cloth','Hand_L')).toBe(false);
  });

  it('uses the source-rebuilt two-faction GLBs as fixtures and keeps the runtime fallback separate',()=>{
    expect(candidateManifest.kind).toBe('source-rebuilt-candidate');
    expect(candidateManifest.editableSource.status).toBe('produced');
    expect(fallbackManifest.kind).toBe('runtime-fallback');
    expect(fallbackManifest.editableSource.status).toBe('superseded');
    teams.forEach((team,index)=>{
      const candidate=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const fallback=fallbackManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      expect(candidate.file).not.toContain('runtime-fallback');
      expect(fallback.file).toContain('runtime-fallback');
      expect(sha256(candidates[index]!.bytes)).toBe(candidate.sha256);
      expect(candidates[index]!.bytes.length).toBe(candidate.bytes);
      expect(sha256(fallbacks[index]!.bytes)).toBe(fallback.sha256);
      expect(sha256(fallbacks[index]!.bytes)).not.toBe(candidate.sha256);
      const pin=baselineLock.files.find(file=>file.path===`exported/veyra-${team}.glb`)!;
      expect(sha256(baselines[index]!.bytes)).toBe(pin.sha256);
      expect(baselines[index]!.bytes.length).toBe(pin.bytes);
    });
  });

  it('applies every candidate death Root Y key through createMotion, not just GLB metadata',()=>{
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      const entry=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const offsets=entry.deathOffsets.map(offset=>offset.offsetY);
      const baselineTrack=clipOf(baseline,'death').tracks.find(track=>track.name==='Root.position')! as any;
      const candidateTrack=clipOf(candidate,'death').tracks.find(track=>track.name==='Root.position')! as any;
      expect(candidateTrack.times.length).toBe(31);
      expect(Array.from(candidateTrack.times)).toEqual(Array.from(baselineTrack.times));
      const root=clone(candidate.scene),motion=createMotion(root,candidate,motionOptions);
      const shift=Math.min(...clipOf(candidate,'death').tracks.map(track=>track.times[0]!));
      let worst=0;
      for(let key=0;key<31;key+=1){
        motion.sample({time:0,deathElapsed:candidateTrack.times[key]-shift});
        const actual=root.getObjectByName('Root')!.position.y;
        const expected=baselineTrack.values[key*3+1]!+offsets[key]!;
        worst=Math.max(worst,Math.abs(actual-expected));
      }
      expect(worst).toBeLessThan(1e-5);
      // The largest lift (key 12, +0.0518 m) must survive the shift/mixer.
      motion.sample({time:0,deathElapsed:candidateTrack.times[12]-shift});
      expect(root.getObjectByName('Root')!.position.y).toBeCloseTo(baselineTrack.values[12*3+1]!+offsets[12]!,5);
      motion.dispose();
    });
  });

  it('matches the source package check_contact world-space foot and body minima at 0/25/50/75/100% and the last frame',()=>{
    // Source frames for 0/25/50/75/100% of the 30-interval death clip.
    const sampleFrames=[1,8.5,16,23.5,31];
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      const entry=candidateManifest.assets.find(asset=>asset.id===`veyra-${team}`)!;
      const candidateRoot=clone(candidate.scene),candidateParts=skinnedParts(candidateRoot);
      const baselineRoot=clone(baseline.scene),baselineParts=skinnedParts(baselineRoot);
      const candidateMotion=createMotion(candidateRoot,candidate,motionOptions);
      const baselineMotion=createMotion(baselineRoot,baseline,motionOptions);
      const rawRoot=clone(candidate.scene),rawParts=skinnedParts(rawRoot);
      const rawMixer=new AnimationMixer(rawRoot),rawAction=rawMixer.clipAction(clipOf(candidate,'death'));
      // Match the production death path: one shot clamped at the final key, so
      // sampling at 100% does not wrap back to frame 1.
      rawAction.setLoop(LoopOnce,1);rawAction.clampWhenFinished=true;rawAction.play();rawAction.paused=true;
      const rawAt=(sourceTime:number)=>{
        rawAction.time=Math.min(rawAction.getClip().duration,sourceTime);
        rawMixer.update(0);
        return contact(rawRoot,rawParts);
      };

      const candidateRows=new Map<number,{body:number;foot:number;bodyBone:string;footBone:string}>();
      const baselineRows=new Map<number,{body:number;foot:number;bodyBone:string;footBone:string}>();
      for(const row of deathFrames()){
        candidateMotion.sample({time:0,deathElapsed:row.deathElapsed});
        candidateRows.set(row.frame,contact(candidateRoot,candidateParts));
        baselineMotion.sample({time:0,deathElapsed:row.deathElapsed});
        baselineRows.set(row.frame,contact(baselineRoot,baselineParts));
      }
      expect(candidateRows.size).toBe(61);
      for(const row of deathFrames()){
        const candidateRow=candidateRows.get(row.frame)!;
        const baselineRow=baselineRows.get(row.frame)!;
        expect(candidateRow.body,`${team} frame ${row.frame} must not fall below the pinned original baseline`).toBeGreaterThanOrEqual(baselineRow.body-1e-6);
        expect(candidateRow.foot,`${team} frame ${row.frame} foot tolerance`).toBeGreaterThanOrEqual(-0.005);
        expect(candidateRow.body,`${team} frame ${row.frame} body tolerance`).toBeGreaterThanOrEqual(-0.01);
        expect(candidateRow.body,`${team} frame ${row.frame} must not float`).toBeLessThanOrEqual(0.02);
        // Direct THREE.AnimationMixer sampling of the original (unshifted)
        // clip at source-frame time is the same CPU pose as the production
        // consumer at its shifted deathElapsed.
        const rawRow=rawAt(row.sourceTime);
        expect(rawRow.body).toBeCloseTo(candidateRow.body,5);
        expect(rawRow.foot).toBeCloseTo(candidateRow.foot,5);
      }

      const lowestBody=Math.min(...[...candidateRows.values()].map(row=>row.body));
      const lowestFoot=Math.min(...[...candidateRows.values()].map(row=>row.foot));
      const highestBody=Math.max(...[...candidateRows.values()].map(row=>row.body));
      const baselineWorst=Math.min(...[...baselineRows.values()].map(row=>row.body));
      const lowestBodyRow=[...candidateRows].reduce((left,right)=>right[1].body<left[1].body?right:left);
      const lowestFootRow=[...candidateRows].reduce((left,right)=>right[1].foot<left[1].foot?right:left);
      const baselineWorstRow=[...baselineRows].reduce((left,right)=>right[1].body<left[1].body?right:left);
      // Source package values (check_contact / manifest) reproduced through the
      // real consumer in the same +Y-up world space, including which frame and
      // which bone owns each extreme.
      expect(lowestBody).toBeCloseTo(entry.contactAtFrameAndHalf.lowestBodyMinY,4);
      expect(highestBody).toBeCloseTo(entry.contactAtFrameAndHalf.highestBodyMinY,4);
      expect(lowestFoot).toBeCloseTo(-0.000127,4);
      expect(baselineWorst).toBeCloseTo(-0.051905,4);
      expect(highestBody).toBeCloseTo(0.014601,4);
      expect(lowestBodyRow[0]).toBe(31);
      expect(lowestBodyRow[1].bodyBone).toBe('Hand_R');
      expect(lowestFootRow[0]).toBe(15.5);
      expect(lowestFootRow[1].footBone).toBe('Foot_L');
      expect(baselineWorstRow[0]).toBe(13.5);
      expect(baselineWorstRow[1].bodyBone).toBe('Foot_L');
      // First and last frames are unchanged by the candidate (zero offsets).
      expect(candidateRows.get(1)!.body).toBeCloseTo(baselineRows.get(1)!.body,6);
      expect(candidateRows.get(31)!.body).toBeCloseTo(baselineRows.get(31)!.body,6);
      // 100% of the clip and the real final frame are the same pose; the
      // production death path clamps beyond the duration (freeze).
      candidateMotion.sample({time:0,deathElapsed:candidateMotion.deathDuration});
      const lastFrame=contact(candidateRoot,candidateParts);
      const lastRootY=candidateRoot.getObjectByName('Root')!.position.y;
      expect(lastFrame.body).toBeCloseTo(candidateRows.get(31)!.body,5);
      expect(lastFrame.foot).toBeCloseTo(candidateRows.get(31)!.foot,5);
      candidateMotion.sample({time:0,deathElapsed:candidateMotion.deathDuration+5});
      expect(contact(candidateRoot,candidateParts).body).toBeCloseTo(lastFrame.body,6);
      expect(candidateRoot.getObjectByName('Root')!.position.y).toBeCloseTo(lastRootY,6);
      // The fraction samples are exactly the source frames 1 / 8.5 / 16 /
      // 23.5 / 31 (0/25/50/75/100% of the 30-interval clip).
      for(const frame of sampleFrames){
        candidateMotion.sample({time:0,deathElapsed:(frame-1)/30});
        const sample=contact(candidateRoot,candidateParts);
        expect(sample.body).toBeCloseTo(candidateRows.get(frame)!.body,5);
        expect(sample.foot).toBeCloseTo(candidateRows.get(frame)!.foot,5);
        const raw=rawAt(frame/30);
        expect(raw.body).toBeCloseTo(sample.body,5);
        expect(raw.foot).toBeCloseTo(sample.foot,5);
      }
      rawMixer.stopAllAction();rawMixer.uncacheRoot(rawRoot);
      candidateMotion.dispose();baselineMotion.dispose();
    });
  });

  it('keeps bones, NORMALs, skin weights and non-death clips identical to the pinned original release',()=>{
    teams.forEach((team,index)=>{
      const candidate=candidates[index]!.asset,baseline=baselines[index]!.asset;
      expect(boneHierarchy(candidate)).toEqual(boneHierarchy(baseline));
      expect(boneHierarchy(candidate)).toHaveLength(15);
      // Candidate containers reorder nodes/joints; the hierarchy is compared
      // as a sorted name:parent set, never by traversal index.
      const candidateSignature=meshSignature(candidate),baselineSignature=meshSignature(baseline);
      expect([...candidateSignature.keys()].sort()).toEqual([...baselineSignature.keys()].sort());
      for(const [material,signature] of candidateSignature){
        const shipped=baselineSignature.get(material)!;
        expect(signature.vertices,material).toBe(shipped.vertices);
        expect(signature.triangles,material).toBe(shipped.triangles);
        expect(signature.records,material).toEqual(shipped.records);
      }
      for(const name of ['idle','walk','attack','hurt']){
        const candidateClip=clipOf(candidate,name),baselineClip=clipOf(baseline,name);
        expect(candidateClip.duration).toBeCloseTo(baselineClip.duration,6);
        const shippedTracks=new Map(baselineClip.tracks.map(track=>[track.name,track as any]));
        expect([...candidateClip.tracks.map(track=>track.name)].sort()).toEqual([...shippedTracks.keys()].sort());
        for(const track of candidateClip.tracks as any[]){
          const shipped=shippedTracks.get(track.name)!;
          expect(Array.from(track.times)).toEqual(Array.from(shipped.times));
          expect(track.getInterpolation()).toBe(shipped.getInterpolation());
          expect(track.values.length).toBe(shipped.values.length);
          for(let value=0;value<track.values.length;value+=1)expect(Math.abs(track.values[value]-shipped.values[value])).toBeLessThan(1e-5);
        }
      }
      // The production consumer must show the same pose for all four non-death
      // clips, not merely identical decoded tracks.
      const cases:[('idle'|'walk'|'attack'|'hurt'),number][]=[['idle',0.37],['walk',0.42],['attack',0.1],['hurt',0.1]];
      for(const [clip,time] of cases){
        const candidateRoot=clone(candidate.scene),baselineRoot=clone(baseline.scene);
        const candidateMotion=createMotion(candidateRoot,candidate,motionOptions);
        const baselineMotion=createMotion(baselineRoot,baseline,motionOptions);
        driveNonDeath(candidateMotion,clip,time);driveNonDeath(baselineMotion,clip,time);
        expect(summary(candidateMotion)).toEqual(summary(baselineMotion));
        expect(candidateMotion.inspect().some((action:any)=>action.clip==='death.full')).toBe(false);
        expect(poseDelta(boneWorld(candidateRoot),boneWorld(baselineRoot))).toBeLessThan(1e-9);
        candidateMotion.dispose();baselineMotion.dispose();
      }
    });
  });

  it('keeps cloned bones and action state isolated when an instance dies, is destroyed and a new one is created',async()=>{
    const teal=candidates[0]!.asset,rust=candidates[1]!.asset;
    let sourceDisposals=0;
    for(const asset of [teal,rust])asset.scene.traverse((node:any)=>{
      if(!node.isSkinnedMesh)return;
      node.geometry.addEventListener('dispose',()=>{sourceDisposals+=1;});
      for(const material of Array.isArray(node.material)?node.material:[node.material])material.addEventListener('dispose',()=>{sourceDisposals+=1;});
    });
    const assets={blue:teal,amber:rust,byDefinition:{veyra:{blue:teal,amber:rust}}};
    const sim=await makeSim(10,61),base=sim.snapshot();
    const bAt=(x:number)=>({...structuredClone(base.heroes[1]!),position:{x,z:base.heroes[1]!.position.z}});
    const aAt=(alive:boolean)=>({...structuredClone(base.heroes[0]!),alive});
    const cAt=(alive:boolean)=>({...structuredClone(base.heroes[0]!),id:11,team:0,alive,position:{x:-80,z:0}});
    const snapshot=(tick:number,time:number,heroes:any[])=>({...structuredClone(base),tick,timeSeconds:time,events:[],heroes});
    const view=createPresentation({catalog:sim.catalog,assets,heroesOnly:true});
    const reference=createPresentation({catalog:sim.catalog,assets,heroesOnly:true});

    const step=(presentation:any,snapshot:any,tick:number)=>{
      presentation.sync(snapshot);
      presentation.advance(tick,1);
    };
    const materialNames=(root:any)=>{const names=new Set<string>();root.traverse((node:any)=>{if(node.isSkinnedMesh)names.add(materialName(node));});return [...names].sort();};

    // tick 0: both alive, candidate teams selected by definition.
    step(view,snapshot(0,0,[aAt(true),bAt(94)]),0);
    step(reference,snapshot(0,0,[bAt(94)]),0);
    const aRoot=view.root.getObjectByName('hero-9'),bRoot=view.root.getObjectByName('hero-10');
    expect(aRoot).toBeDefined();expect(bRoot).toBeDefined();
    expect(aRoot).not.toBe(bRoot);
    expect(aRoot!.getObjectByName('Root')).not.toBe(bRoot!.getObjectByName('Root'));
    expect(materialNames(aRoot)).toContain('battle-teal');
    expect(materialNames(aRoot)).not.toContain('battle-rust');
    expect(materialNames(bRoot)).toContain('battle-rust');
    expect(materialNames(bRoot)).not.toContain('battle-teal');

    // tick 1-2: A dies, B keeps moving.
    step(view,snapshot(1,1,[aAt(false),bAt(96)]),1);
    step(view,snapshot(2,2,[aAt(false),bAt(98)]),2);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===9)?.action).toBe('death');
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');
    expect(view.motionState().find((entry:any)=>entry.id===9)!.actions.map((action:any)=>action.clip)).toEqual(['death.full']);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>action.clip).sort()).toEqual(['walk.lower','walk.upper']);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.some((action:any)=>action.clip==='death.full')).toBe(false);
    expect(aRoot!.getObjectByName('Root')!.position.y).toBeCloseTo(0.733078,4);
    expect(bRoot!.getObjectByName('Root')!.position.y).not.toBeCloseTo(0.733078,4);

    // tick 3: A is destroyed; B still walks and no source resource is disposed.
    step(view,snapshot(3,3,[bAt(100)]),3);
    expect(view.root.getObjectByName('hero-9')).toBeUndefined();
    expect(view.root.getObjectByName('hero-10')).toBeDefined();
    expect(view.motionState().some((entry:any)=>entry.id===9)).toBe(false);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');

    // tick 4: a new instance C is created while B keeps moving.
    step(view,snapshot(4,4,[bAt(102),cAt(true)]),4);
    const cRoot=view.root.getObjectByName('hero-11');
    expect(cRoot).toBeDefined();
    expect(cRoot).not.toBe(bRoot);
    expect(cRoot!.getObjectByName('Root')).not.toBe(bRoot!.getObjectByName('Root'));
    expect(view.inspect().heroes.find((hero:any)=>hero.id===11)?.action).toBe('idle');
    expect(view.motionState().find((entry:any)=>entry.id===11)!.actions.map((action:any)=>action.clip).sort()).toEqual(['idle.lower','idle.upper']);
    const bSkeletons:any[]=[],cSkeletons:any[]=[];
    bRoot!.traverse((node:any)=>{if(node.isSkinnedMesh)bSkeletons.push(node.skeleton);});
    cRoot!.traverse((node:any)=>{if(node.isSkinnedMesh)cSkeletons.push(node.skeleton);});
    expect(bSkeletons[0]).not.toBe(cSkeletons[0]);
    expect(bSkeletons[0]!.bones[0]).not.toBe(cSkeletons[0]!.bones[0]);
    expect(new Set([...bSkeletons[0]!.bones,...cSkeletons[0]!.bones]).size).toBe(bSkeletons[0]!.bones.length+cSkeletons[0]!.bones.length);
    expect(aRoot!.getObjectByName('Root')).not.toBe(cRoot!.getObjectByName('Root'));

    // tick 5-6: C dies while B moves; C has no effect on B's pose or actions.
    step(view,snapshot(5,5,[bAt(104),cAt(false)]),5);
    step(view,snapshot(6,6,[bAt(106),cAt(false)]),6);
    expect(view.inspect().heroes.find((hero:any)=>hero.id===11)?.action).toBe('death');
    expect(view.inspect().heroes.find((hero:any)=>hero.id===10)?.action).toBe('walk');
    expect(view.motionState().find((entry:any)=>entry.id===11)!.actions.map((action:any)=>action.clip)).toEqual(['death.full']);
    expect(cRoot!.getObjectByName('Root')!.position.y).toBeCloseTo(0.733078,4);

    // Reference presentation: only B on the same timeline. Its final pose and
    // actions must be bit-identical, proving no bone/action state crossed from
    // A's death or C's creation/death.
    for(let tick=1;tick<=6;tick+=1)step(reference,snapshot(tick,tick,[bAt(94+2*tick)]),tick);
    expect(poseDelta(boneWorld(view.root.getObjectByName('hero-10')),boneWorld(reference.root.getObjectByName('hero-10')))).toBeLessThan(1e-9);
    expect(view.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>`${action.clip}:${action.weight}:${action.time}`))
      .toEqual(reference.motionState().find((entry:any)=>entry.id===10)!.actions.map((action:any)=>`${action.clip}:${action.weight}:${action.time}`));

    view.dispose();reference.dispose();
    expect(sourceDisposals).toBe(0);
  });
});
