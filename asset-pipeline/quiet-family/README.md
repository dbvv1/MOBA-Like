# quiet-family-v1 — opt-in material family

`?materials=quiet-family-v1` on the current 3D client or capture client. Absent, malformed and legacy routes retain existing materials; no candidate texture requests by default. Three textures load once atomically; any failure disposes partial assets and retains the original material family. Runtime source is in `src/render/quiet-family.ts`, `quiet-buildings.ts`, `quiet-stone.ts`.

- Earth/forest preserve 10 m / 12 m world-XZ scale. Both original road and forest meshes plus shoulder patches use the same 0.8 m boundary transition, matching existing one-metre sampled road geometry and clearings; no mesh/index/UV/layout/navigation change.
- Six tower/barracks/base bodies use explicit original atlas stone-cell selection, never whole-atlas replacement. Original team/roof/window/wood/catapult/banner pixels remain. Stone uses 4 m asset-space triplanar mapping; original diagnostic UVs and geometry remain. Models are 1:1 metres in battlefield instances. Existing rigged heroes and lighting are unchanged.
- Runtime download 428,628 bytes; RGBA8 base 18,870,192 bytes, full mip estimate 25,152,216 bytes. Only albedo, no baked lighting or generated normal-map claim.

## Reproduce

`bash asset-pipeline/quiet-family/convert-runtime.sh` converts the retained final PNG edits (ImageMagick WebP quality 90/method 6, no resize). Prompts, original PNGs, first edits, corrected edits, hashes and limitations are in `source/generation-manifest.json`; image generation itself is not deterministic.

`node --import tsx tools/quiet-stone-manifest.ts` checks actual six GLB hashes and selected/protected triangle counts. `source/stone-regions.json` is the explicit protected-region contract, not a Blender claim. Shared dominant-plane UV conflicts are recorded; runtime uses triplanar to avoid that seam source.

CPU contracts are not shader compilation or rendered-image evidence. Remaining small brush facets and visible repeated motifs need all four named-camera comparison. Seamless tiling, visual improvement, gameplay readability, browser smoke and dual non-author preference remain unverified. Candidate is not published or default.

Capture entry (after a working approved cloud browser is established): existing `tools/capture.mjs` now accepts `--materials quiet-family-v1 --shot all` and refuses a fallback/partial six-building family as candidate evidence. This change does not relax its original browser launch policy and was not run this session.

## Five source standards

`node tools/build-quiet-standards.mjs` rebuilds `standards/source-lineup.glb` and its source-hashed layout manifest: original road-edge section, tower, barracks, base and Veyra rigged hero at unchanged physical scale. Independent GLTFLoader CPU parse finds five roots, 17 meshes, six skinned meshes and five animation clips. This is a source-reference same-frame scene, **not** five newly adopted game props: original building atlases and hero are retained, shoulder reference is neutral. Actual quiet-family shaders and all-camera game readability remain to be rendered. No Blender run or rendered same-frame acceptance is claimed.

## Production-material standard capture consumer (CPU-only continuation)

Based on `e91d555a100be7aa746baf0a50417db6972bf1bf`, the existing five source slots now have an explicit capture-only consumer, rather than treating `source-lineup.glb` as a shader-bearing runtime asset. After browser recovery, use the existing runner with `--standards quiet-five-v1 --shot spawn --materials quiet-family-v1` (and its existing renderer/lighting/ownership options). The artifact identifies itself as `content-standards` / `standards-quiet-five-v1`, not a fifth normal game camera; all four gameplay cameras remain unchanged. Baseline comparison omits the material override but keeps the same standards switch.

The consumer reuses the production world's light, post-processing, verified building prototypes and selective stone hooks, plus the original Veyra rig and motion consumer. The road shoulder uses the production road cross-section and terrain blend; shader sampling subtracts only the lineup translation, preserving source-world texture periods and road boundaries. The hero's idle bones advance through the production animation clock while its placement root stays fixed. Normal play makes no standards request or activates a standards scene. This is a dedicated capture entrance, not an arbitrary live-game hot-switch feature: existing impact tails may resume and interpolation may bridge old/new state if manually switched back. The normal capture never switches back. Exit hygiene restores original visibility and resynchronizes the latest snapshot without replaying its events; owned cloned skeletons and shoulder buffers are released without disposing shared game assets.

CPU acceptance: 81 files / 529 tests, web types/build and capture types/build passed. Actual GLB source hashes, five slots, protected stone hooks, shifted sampling coordinates, real bone motion, default isolation, submission-gated activation, context loss, switch-back and teardown are covered. Three seed matches and three replays produce byte-identical JSON to the parent (SHA-256 `7c973b993b930a304706486452b0f6d98581aaf4111f06299be832d541aed0ce`). Non-author review identified and corrected a missing animation-clock advance and stale state on switch-back. No browser was launched: shader compilation, framing, shadows, visual coherence and dual-review preference remain unverified. This local continuation is not uploaded, deployed, or counted as five new props or increased quality coverage.
