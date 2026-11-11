# Morrow ranged source candidate

A source-only edit of the existing CC0 battle hero, not a new runtime route or an accepted visual upgrade. Preserve the shield sentinel silhouette and team crests; replace the sword blade and crossguard with a three-pronged wooden thorn focus on the retained grip. Only attack rotations of Torso, UpperArm_R, Forearm_R and Hand_R change. All fifteen bones, body vertices/weights, other action source curves and remaining attack curves stay intact.

Blender 4.3.2, from the repository root:

```sh
blender -b --disable-autoexec --python-exit-code 1 --python asset-pipeline/battle/morrow-ranged/build.py -- --output-dir outputs/morrow-ranged
python asset-pipeline/battle/morrow-ranged/test_recipe.py
npx vitest run tests/client/morrow-ranged-source.test.ts
```

The script verifies both original blend SHA-256 values before writing and only accepts a named repository outputs subdirectory. It writes editable blends, GLBs and a manifest there. Published exports here are isolated authoring deliverables; no runtime manifest, default asset, Veyra, simulation, HTML or deployment changes. Editable blends remain local because their embedded metadata has not been cleared for publication. Original source and license: ../source/BATTLE-LICENSE.txt and ../tools/build.py.

At 30 fps the existing attack source runs frames 1–36. Source frames 14/19/36 correspond to normalized 13/30, 18/30, 35/30 seconds in reactionClip. The existing attackSample maps authoritative basic-attack resolution to 18/30 seconds. The new source pose follows that contract; it does not change events or emit damage. Spell consumers still share attack. Source curve preservation is exact; unchanged exported quaternion components can differ by approximately 1e-8 from the older GLBs through resampling, and CPU comparison bounds that difference below 1e-6.

Actual production: both factions exported using Blender 4.3.2, repeated GLBs byte-identical; protected source curves and retained body weights checked inside the recipe. Teal has 1057 triangles, rust 1065, below their original budgets, with the same five material slots. Real GLTFLoader/createMotion tests cover rig, non-target tracks, forward hand release, death override and reset. Fail-closed tests cover absent output, protected destination, missing source and changed source. These are source/CPU checks, not browser, visual, sound or feel acceptance. Source design remains a candidate pending independent review and eventual existing-trial integration.
