# Stylized battlefield material family — optional candidate

Original AI-generated **base-color candidates**, not physically correct albedos: the stone images retain baked highlight/shadow cues. No normal or roughness maps were synthesized. Full prompts, original PNG SHA256, dimensions, byte counts and forest-v2 lineage are in `provenance.json`. No commercial images were inputs; KayKit licenses do not apply to these generated files. Original 1254×1254 PNGs are unmodified.

## Actual game consumer

`?environment-materials=v1` selects this family in `src/render/world.ts`. No query leaves the default appearance and image loading unchanged. The optional battlefield loader atomically waits for all three sources; decode/load failure leaves original materials and warns. World destruction cancels attachment; late settled textures are disposed. TextureLoader cannot abort an in-progress HTTP/image decode, so cancellation is logical rather than a promise to stop network work.

- Lane stone: every `stone-path` and `worn-edge-*` surface of the reused 12 m lane segments.
- Building stone: only original `worn-foundation` tower paving. KayKit building geometry/atlas, banners, wood, roofs and faction accents remain untouched.
- Forest **v2**: continuous ground and `GroundShoulderPatches` use one shared map/material. Grass blades/leaves remain independent authored geometry. Forest v1 is not bundled or loaded.

Runtime clones selected geometries and creates UVs; GLB source geometry, Blender output and original materials remain unchanged. World-XZ UVs give ground/shoulders/lanes continuous phase across the 3 cm overlapping lane edges. Tower foundations split indexed triangles and use dominant geometric-face planar mapping for top/side faces, preserving positions/normals and using world coordinates even under the existing team rotation. Mesh transforms must remain static after binding; this consumer never targets moving units.

Initial scales are 8 m/image for lane/forest (156.75 source texels/m) and 4 m/image for foundation (313.5 texels/m); these are candidates, not validated detail density. MirroredRepeatWrapping is intentionally used rather than naive repeat of mismatched image edges. It eliminates direct opposite-edge jumps in base-level sampling but creates a 2-tile mirror period and may expose symmetric joints/mip/oblique artifacts. **No claim of seamless tiling, in-game readability or visual improvement.** No seam-cover obstacles or nav/collision changes.

Exactly three shared sRGB textures and three white-base rough materials; no extra per-segment textures or shader sampling hooks. Selected cloned geometries are owned by the family; source GLB geometries/materials stay with BattleAssets, original generated ground resources with their existing owners. The family releases geometry/material/texture sets once; replay does not create another family within the same world.

Budget: three 1254² RGBA8+mip chains estimate 25,152,216 bytes (~24 MiB; driver allocation unmeasured), excluding decode copies. This exceeds the earlier 16 MiB runtime target: no downsampling/image edits were performed, so target memory is **not met**. Actual total PNG transfer bytes are in provenance. No claimed draw-call/GPU timings.

## Remaining acceptance

CPU tests decode all original PNGs and real game GLBs, verify finite world UVs and face area, unchanged atlases/positions/simulation hash, resource sharing, failure/cancellation and disposal. Build is not rendering evidence. Browser smoke, same-state fixed-camera GPU baseline/candidate/target comparison, close/far/min-window views, skill/unit readability, motion shimmer and non-author visual acceptance are still required. Default remains unchanged; this source candidate does not complete the game's environment art.
