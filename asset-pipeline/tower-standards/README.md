# Tower standards — experimental sidecar

Player entry: `candidate.html?standards=tower-standards`; omission or `standards=baseline` retains current candidate art. The main `index.html` and `default-src` are not changed. This is a three-piece engineering art sample, not an approved visual improvement.

## Original sources and scope

`tools/build.py` creates editable Blender sources, exports two self-contained GLBs and renders a procedural albedo on CPU. No commercial models or AI-generated bitmap textures are used. No new gameplay, terrain mesh, navigation, collision or enemy resources. Existing team teal semantic is retained; the enemy rust assets are untouched.

- Friendly tower at x -56 and -28, z 0. Bounds fit [-2.18,0,-2.18]..[2.18,5.3,2.18], 566 triangles, 4 draws.
- Friendly barracks at x -82,z 0. Bounds fit [-1.31704,0,-1.31704]..[1.31704,3,1.54764], 238 triangles, 4 draws.
- Continuous road retains its world-space 10 m UV period. New 512 px original albedo has sparse 1.16–1.84 m long irregular stone fragments in a low-contrast dirt ground. This replaces the rejected 2.5 m checkerboard control sample, not the live game texture. Forest/road meshes and UVs are untouched. At this resolution decoded RGBA is 1 MiB before mipmaps; compressed download size is not GPU memory savings.

Blender objects remain individually editable in generated `.blend` source; export joins static meshes by material only. `blender --background --python asset-pipeline/tower-standards/tools/build.py` rebuilds into `source`, `exported`, and `previews`. `-- --models-only` skips material and offline preview. The script explicitly uses CPU Cycles and disables unsupported denoising. Generated working sources/previews are local engineering outputs; the script is the distributable editable source.

## Runtime contract

Only explicit standards opt-in changes the two friendly asset URLs. Each rejected model load falls back to its exact existing asset. Failed candidate terrain-pair loading releases partial textures, then loads the existing pair; existing flat fallback remains if that also fails. World lifetime owns the resources and disposes them once. Snapshot/model simulation stays unchanged. Capture metadata records requested mode and actual candidate/fallback resources; fallback must not be represented as candidate evidence.

## Comparison still required

CPU GLTF/consumer tests and builds are engineering evidence only. No browser smoke, GPU comparison, professional target comparison or non-author visual preference has yet established improvement. The material remains a subdued schematic control sample with visible repeat risk; do not expand it to more assets before a real fixed-camera review and meaningful second revision.

## Prepared headless comparison (not yet run)

After independent review and a fixed clean commit, build `npx tsc -p tsconfig.capture.json && npx vite build --config vite.capture.config.ts`. Run `node tests/client/browser-smoke/standards.mjs` in the already-authorized capture environment; it uses the existing sandbox-preserving launch policy and never retries a denied configuration. It creates an exclusive directory and manifest, saves raw renderer metadata and PNG hashes, asserts actual candidate assets (no fallback), matching source/bundle/state/camera/viewport, and non-background pixels. It performs no keyboard/mouse or page-state mutation. A software renderer is smoke only, not GPU or visual-quality approval. The ordinary input smoke remains a separate prerequisite; this narrow harness does not replace it.

Pairs: `/capture.html?shot=first-tower&seed=1&t=10&input=march&frames=1&standards=baseline` versus `standards=tower-standards`; likewise `shot=barracks-road`. First tower is fixed (-28,24,18) looking at (-28,0,0); barracks-road is (-82,24,18) looking at (-82,0,0). Existing in-game fixed-step preroll and command tape produce the state. The same bundle contains both options; no saved-state injection or simulation teleport is used.

Optional GLB requests and each optional terrain texture have a 5-second wait bound. Candidate GLBs use a separate ordered queue so a stalled optional asset cannot block original GLBs. On timeout the consumer falls back; a successfully parsed late model/texture is disposed, not adopted. This does not abort transport or provide immediate world cancellation; original assets still use their existing loading/failure contract. If road succeeds near its limit and forest then times out, the optional pair can wait nearly 10 seconds before original-pair fallback. Metadata exposes fallback, which the comparison harness rejects as candidate evidence.
