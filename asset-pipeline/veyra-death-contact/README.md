# Veyra death ground-contact candidates

Editable source candidates and rebuilt GLBs for the two Veyra faction exports (`veyra-teal`, `veyra-rust`) that remove the death foot penetration already acknowledged in [`../heroes/veyra-release/README.md`](../heroes/veyra-release/README.md).

**Status: source-rebuilt candidates.** `source/veyra-{teal,rust}.blend` are editable copies of the shipped sources with only the death `Root` location Y keyframes changed; `exported/veyra-{teal,rust}.glb` are exported from those files. The build runs in a background Python with the Blender `bpy` module (5.2.3 LTS, layered actions), uses no GUI/GPU/network, and reopens the saved source to prove the GLB rebuild is reproducible. The old binary-patch GLBs are kept in `runtime-fallback/` as fallback evidence. Nothing under `../heroes/` was modified.

## Adoption (these candidates are not loaded by the game)

The game loader does not see this directory. `src/render/battle-assets.ts` globs only `asset-pipeline/heroes/veyra-release/exported/*.glb` and resolves `heroManifest.assets[].file`; no code references `asset-pipeline/veyra-death-contact/`. Merging this unit therefore does **not** change the in-game death motion — it still plays the old clip until a separate adoption change lands. Adoption must do all of the following in one change, in this order.

### 0. Pin the `b489ed3` baseline before overwriting the heroes release

All offsets and contact checks are defined against the shipped `b489ed38` export. The adopted GLB cannot serve as its own baseline: `root_offsets(..., zero_from_frame=18)` forces every key at frame 18 and later to zero, so recomputing from an already fixed export yields offsets of at most **2.1e-9 m** (measured on this package), not a lift of the 0.000182 m tail. Rebuilding the old source with those near-zero offsets re-exports the unfixed clip and fails acceptance; rebuilding the fixed source is a no-op. Snapshot the shipped files first:

```sh
mkdir -p asset-pipeline/veyra-death-contact/baseline/exported asset-pipeline/veyra-death-contact/baseline/source
cp asset-pipeline/heroes/veyra-release/exported/veyra-{teal,rust}.glb asset-pipeline/veyra-death-contact/baseline/exported/
cp asset-pipeline/heroes/veyra-release/source/veyra-{teal,rust}.blend asset-pipeline/veyra-death-contact/baseline/source/
cp asset-pipeline/heroes/veyra-release/manifest.json asset-pipeline/veyra-death-contact/baseline/manifest.json
```

The manifest is required, not only the GLBs: `tests/test_checks.py::test_baseline_hashes_match_the_upstream_manifest` reads it from the same directory. `tests/check_contact.py` and `tests/test_checks.py` read the `VEYRA_DEATH_BASELINE_DIR` environment variable; `tools/build_candidates.py` and `tools/build_source_candidates.py` use the same variable (the former also accepts `--baseline-dir`), and `tests/check_source_bpy.py` reads `<pin>/source`. Relative values resolve from the repository root:

```sh
export VEYRA_DEATH_BASELINE_DIR=asset-pipeline/veyra-death-contact/baseline
```

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

Then copy the rebuilt `source/` and `exported/` into the heroes release again and rerun the acceptance commands from step 5. The rebuild also refreshes this package's `manifest.json` and `reports/death-root-offsets.json` against the pinned baseline: `manifest.json`'s `basis.source`, `basis.manifestSha256`, each asset's `upstreamSource`, `upstreamSourceSha256` and `baseline`. Without it, `tests/test_checks.py::test_source_and_candidate_hashes_match_the_manifest` compares the adopted heroes source with the old recorded hash and fails. If Blender is unavailable, update those fields to the pinned baseline by hand instead: `basis.source` becomes the pinned directory, `basis.manifestSha256` the pinned manifest hash, and each `assets[].upstreamSource` / `assets[].baseline` the pinned `source/veyra-{teal,rust}.blend` / `exported/veyra-{teal,rust}.glb`; the matching `upstreamSourceSha256` and `baselineSha256` keep the `b489ed3` hashes. Leaving `assets[].baseline` pointing at the now-overwritten heroes export while `baselineSha256` still holds the old hash makes the record self-contradictory. Overwriting only the GLB and then running the heroes recipe is not a supported path.

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
export VEYRA_DEATH_BASELINE_DIR=asset-pipeline/veyra-death-contact/baseline
python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v
python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.01
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005
python asset-pipeline/veyra-death-contact/tools/build_candidates.py --check-only --baseline-dir "$VEYRA_DEATH_BASELINE_DIR"
PYTHONUTF8=1 python asset-pipeline/content-set/normalize.py
PYTHONUTF8=1 python -m unittest discover -s asset-pipeline/content-set -p 'test_*.py'
npm test
npm run build
```

Adoption is complete only when all of these pass: `npm test` covers `default-entry.test.ts`, `content-standards.test.ts` and `hero-source.test.ts`; the two Python discover commands cover the contact checks and content-set normalization.


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

`tests/test_checks.py` (32 tests) also exercises: missing GLB, missing animation clip, invalid tolerance (`0`, negative, `> 0.02`, `NaN`, boolean), zero penetration threshold on the CLI, a bind-pose skinning invariant, a negative control that copies the unfixed baseline and must fail the contact acceptance, the runtime-fallback byte-diff rule, source/candidate hash checks against the manifest, and repo-relative resolution of `VEYRA_DEATH_BASELINE_DIR`. Two `AdoptionDocTests` keep the adoption instructions consistent with the delivered files: the step 1 table's SHA-256 and byte counts must equal both the delivered GLBs and `manifest.json`, and because step 2 names the heroes recipe scripts (`build.py`, `retarget.py`), step 3 must place each script's path directly before its current `sharedAssets` sha256; the test reads those pins from `default-source-manifest.json` and fails when a pin is missing, malformed or stale. The mesh invariants also compare normals and nonzero skin influences by bone name, with mutation controls for both. Source-curve unit tests reject changed key frames, interpolation and counts without requiring bpy; these synthetic checks do not replace reopening the actual source. The source builder refuses a missing upstream file, an upstream hash mismatch, a wrong death key count, a source that does not reproduce its GLB, or a rebuilt GLB that fails either tolerance. `tools/build_candidates.py` accepts relative or repository-external `--baseline-dir` values and reports a `ContactError` (exit 2) instead of a traceback.

## Commands

From the repository root:

```sh
python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.01
python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005
python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v
python asset-pipeline/veyra-death-contact/tools/build_candidates.py            # runtime fallback
python asset-pipeline/veyra-death-contact/tools/build_candidates.py --check-only
```

After adoption overwrites the heroes export, prefix these commands (including the source rebuild and source diff below) with `VEYRA_DEATH_BASELINE_DIR=asset-pipeline/veyra-death-contact/baseline`, or pass `--baseline-dir` to `check_contact.py` / `build_candidates.py`. That pinned snapshot must contain `exported/`, `source/` and `manifest.json`; see Adoption step 0.

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
- `runtime-fallback/manifest.json` — fallback byte-diff summary.
- `reports/death-root-offsets.json` — the 31 Root Y offsets per team, ready to apply in a Blender pass.
- `tools/glb_contact.py` — GLB container, dependency-free skinning and contact sampling.
- `tools/build_source_candidates.py` — bpy source edit, save and GLB re-export.
- `tools/build_candidates.py` — stdlib runtime-fallback patcher.
- `tests/check_contact.py` — reproduce/verify CLI.
- `tests/check_source_bpy.py` — bpy source diff against the upstream `.blend` files.
- `tests/test_checks.py` — unit, invariant and negative tests.

## Not verified / next steps

- **In-game death silhouette and side-by-side quality judgment:** not run. This card forbids browsers and GPU work, and CPU contact numbers are not a substitute.
- **Old weapon contact defects:** intentionally out of scope; only the "not below baseline - 0.01 m" rule was checked.
- **Blender 4.3 compatibility of the delivered source:** not tested. The source files were saved by 5.2.3 LTS; reopen/export was verified only with that version. The GLB deliverables are version-independent.
- **Adoption:** not performed; no file under `../heroes/`, the battle export, the runtime renderer or `quality.md` was modified.
- **Heroes-recipe port:** the optional path in Adoption step 2 is documented but not implemented or tested. No recipe script was edited. Package checks cover candidate data and documentation consistency only; neither adoption path has been exercised end to end.

## Provenance and licence

- Baseline pin: commit `b489ed38592dc184fffe2ab9b3b186441c7dc9bb`; both baseline GLB SHA-256 values match `../heroes/veyra-release/manifest.json`.
- Derived from the existing CC0-1.0 Veyra exports; generators are original code. No new third-party assets were added. The preserved attack action includes the upstream Quaternius UAL1 CC0 derivation recorded in [`animationSource`](../heroes/veyra-release/manifest.json) and its [bundled licence](../heroes/veyra-release/source/UAL1-License.txt). No machine-specific content is included.
