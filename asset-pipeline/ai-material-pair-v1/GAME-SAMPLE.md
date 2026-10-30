# First-tower material sample (off by default)

Built on 0a1d60b, retaining default v11 forest lighting, legacy-v10, candidate and buffer routes. Original generated files are taken unchanged from e95d9e4; no new image generation. Explicit `?materials=ai-pair-v1` on current client; omit parameter or use `materials=baseline` for unchanged materials. Unknown/duplicate values fail clearly. Legacy-v10 remains frozen and ignores this new parameter.

Small standard-piece test only: existing friendly outer tower at x=-28 and existing road triangles from x=-42 to -14. No added positions, indices, collision/nav surfaces, structure positions or simulator changes. Forest, other towers, base, barracks, catapult turret/arm, team flag/pole and units retain their original materials. The selected tower node is exactly `building_tower_catapult_green`; its material and geometry are privately cloned, only UV attributes changed. Source atlas and shared geometry remain untouched. The test does not claim a whole-scene material-layer improvement.

## World scale and budget

- Ground: source 512² WebP runtime, original road UV = xz/10m and texture repeat 2.5 → 4m tile. Existing road topology preserved; contiguous material groups add two draw calls, not one per triangle. Sample boundary is intentionally limited and may be visible; judge local standard pieces before expanding.
- Wall: source 512² WebP runtime, dominant local normal axis projection, 2m per texture tile. Existing tower positions/normals/indices unchanged. Box-projection corners may show seams, and source border is not pixel exact; inspect at the specified camera before acceptance.
- Both use sRGB color decoding, RepeatWrapping, LinearMipmapLinearFilter + LinearFilter, automatic mipmaps, anisotropy 4. No normal/AO/roughness maps synthesized. Existing lit shader class and roughness/metalness retained.
- 18,226 + 15,118 = 33,344 compressed bytes; estimated RGBA8+mips GPU memory 2 × 512² × 4 × 4/3 = 2.67 MiB (driver allocation not measured). Existing terrain textures remain loaded for unaffected road/forest. No source PNG is referenced by runtime.
- Texture pair failure disposes partial loads and retains baseline; capture metadata records requested vs active plus groundApplied/towerMeshesApplied. If base terrain fails, pair is not loaded. Loaded-but-not-applied tower is active:null, not accepted pair evidence. World shutdown/cancel disposes pair; per-sample cloned resources are owned by battlefield. No texture request when disabled.
- Reproduce export with `python asset-pipeline/ai-material-pair-v1/tools/export-runtime.py` (Pillow). Export only resizes/compresses actual AI pixels; source v2 PNGs stay unchanged.

## Required first capture

Same seed/time/input and source build for both:

- `capture.html?shot=first-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline`
- `capture.html?shot=first-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=ai-pair-v1`

Retain full renderer string/class, per-round directory/manifest, fixed resolution 1280×720, compare original plus 320px. Need actual headless smoke and independent visual judgement of tower/road scale, repetition, seams, readable team identity and hero silhouette before merge or expansion. CPU tests/build are not this evidence. No in-game image or asset adoption maturity claimed yet.

## CPU and independent code review

2026-10-30: 75 files / 482 tests passed; `npm run build`, `npm run build:web`, `npx tsc -p tsconfig.capture.json`, `npx vite build --config vite.capture.config.ts` passed. Existing chunk-size build warning remains. First regression pass exposed missing new parser/state method bindings in executable-client/renderer test doubles; those doubles now supply the real parser and explicit baseline material-state stub, all lifecycle tests pass. No simulation files modified.

Independent non-author code review inspected actual tower GLB material/node names and transforms, source ownership, road groups, old routes and failure/cancel paths. Reviewer reran capture typecheck and 14 focused tests; initial partial-application metadata and CLI evidence-binding issues fixed, no remaining code-review blocker. This is code review only, not visual judging. Run capture with `--shot first-tower --lighting forest-light-v1 --materials ai-pair-v1` (baseline uses `--materials baseline`) via the same approved cloud runner; CLI now asserts requested/active pair plus ground and one tower applied.
