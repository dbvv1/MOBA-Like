# Battlefield daylight

## Source and licence

- **Kloppenheim 03 (Pure Sky)**, Greg Zaal and Jarod Guest, [Poly Haven source](https://polyhaven.com/a/kloppenheim_03_puresky).
- Original 1024 × 512 Radiance HDR; **CC0-1.0**, [Poly Haven licence](https://polyhaven.com/license). No commercial-game assets are included.
- Official download, byte count, MD5 and SHA-256 are recorded in `source.json`. The bundled HDR file is unmodified. Its loaded radiance receives the reproducible sky/sun separation described below. It is used as lighting through Three.js PMREM, not as a tone-mapped background image.

## One lighting layer

The intended hierarchy is warm light on stone/armour, a cool readable shadow side, subdued green surroundings, and stronger teal/rust team accents. The light direction and camera are shared across play and capture. No model, actor scale, map geometry, gameplay data or camera pose is changed.

`src/render/lighting.ts` owns the treatment:

- CC0 HDR → solar-neighbourhood separation in `sky-radiance.ts` → `PMREMGenerator.fromEquirectangular` → `scene.environment`. All current battle GLBs use glTF metallic/roughness materials without `KHR_materials_unlit`; the runtime loader produces `MeshStandardMaterial`. Ground/edge materials are also Standard, so the environment actually lights these surfaces.
- One warm directional sun; the sun-separated PMREM is the only fill (no extra hemisphere light); a 2048² shadow map follows the existing camera focus, not a new camera. This small lane view does not justify cascade infrastructure.
- Sky and distance fog share a muted blue-green colour, with fog starting at camera depth 48 m rather than inside the overhead battlefield. The overhead shot has no visible horizon; fog is deliberately restrained, not a replacement for future terrain/material work.
- Three.js's built-in GTAO at 75% pixel resolution, eight AO and eight denoise samples, 0.85 m contact radius and 0.7 blend intensity. The denoise noise texture is deterministic. There is no temporal jitter or accumulation.
- Linear half-float MSAA beauty → contact AO → one ACES/sRGB `OutputPass` for the world. The actual resolved world depth is then copied to the default framebuffer, and gameplay cues use their original direct-render material flags, including `toneMapped:false`. Cues do not cast AO, get darkened by AO, or lose world occlusion. The depth copy is one full-screen draw, not an extra geometry pass.
- No bloom, LUT, new postprocessing framework or package dependency. Fixed exposure is 1.06. Shared load, resize, render and idempotent disposal serve both ordinary play and capture. Failed HDR loading rejects initialization rather than silently claiming an environment-lighting result. Existing cancellation releases the completed world; it does not abort an in-flight HDR request.

## Evidence and limits

The comparison must use `first-tower`, seed 61, idle, time 101, frame 16 (sim time 101.26666666666667, tick 3038) at 1280 × 720. AI paint-over is direction only, not gameplay evidence. CPU tests/builds do not establish image quality, software-frame cost, GPU performance, or Q/VFX appearance. Actual output must be inspected and independently compared before adoption. The render counters now include all lighting passes, not only the final scene draw.

The first source test run after pipeline integration passed 331/332 tests; the one failure was the old capture test's GPU renderer double lacking `compile`. That suite now mocks only the new lighting boundary while retaining its original camera/consumer assertions; the dedicated lighting suite executes the real compositor/pass/visibility/depth-copy logic with HDR/PMREM I/O and rasterization replaced. These are source/lifecycle checks, not rendered-pixel validation.

## References read for this decision

- [Three.js MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html): environment mapping is the intended PBR lighting input.
- [Three.js PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html): prefilter HDR environment radiance for roughness-dependent lighting.
- [Three.js GTAOPass](https://threejs.org/docs/pages/GTAOPass.html) and the installed r186 source: bounded screen-space contact occlusion and denoise controls; no new AO framework is needed.
- [Three.js OutputPass](https://threejs.org/docs/pages/OutputPass.html): tone mapping and output colour conversion at the end of the world pass chain.
- [Riot, Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/): maintain gameplay hierarchy and avoid visual noise. This motivates preserving cue colour/depth semantics, not copying Riot content.

Checked 2026-10-27. The current scene still has broad, nearly flat terrain materials and small actor silhouettes; lighting alone cannot close those separate quality gaps.


## Revision after the first real-frame review

The `87ecdaa` candidate was **not accepted**: a non-author preferred it only slightly and found washed-out grass, weak ground contact and lower separation of pale troops from the lane. Tower detail improved, but that did not justify release. Matched real frames preserved the simulation/camera/viewport. Small fixed pixel-region samples corroborated the judgement: encoded-luma tower shadow/lit-road ratio rose from about 0.61 to 0.87, while near grass rose from 66 to 103. These are image-region observations, not physical illumination measurements.

The diagnosis does **not** claim shadows were disabled. Models cast shadows and the ground receives them; the tower lies inside the light frustum. The 48 m / 2048 shadow footprint is about 2.34 cm per texel. At the fixed camera, tower-ground depth is 30 m, below the old fog start of 34 m, so fog cannot explain the tower-front washout. Far-bank fog contributes slightly, but near grass has zero fog and was still much lighter. The source HDR contains an approximately 32,288-linear-luminance sun hotspot. Three's PMREM indirect term does not use the directional shadow visibility; feeding that hotspot to PMREM and then adding a directional sun leaves a large unshadowed solar contribution.

The new method is **separating direct sunlight from sky fill**, not raising AO or lowering every material's base colour:

1. On HDR load, find the brightest upper-hemisphere pixel. Use the per-channel median of the surrounding 5–8 degree sky ring to replace the inner 2 degree solar neighbourhood, smoothly feathering back to the original radiance at 5 degrees. Only 1,227 of the source's 524,288 pixels are touched; the rest, alpha and lower hemisphere are unchanged. No source file is rewritten, no screenshot is retouched, and there is no global radiance clamp. A sky without a clear bright hotspot is preserved.
2. Use this sky-only radiance for PMREM at 0.45 intensity and let the existing single shadowed directional light carry direct daylight. CPU integration estimates upward green cosine-weighted radiance changing from 1.268 to 0.594 before the 0.45 scale; this supports the diagnosis but is **not** a PMREM GPU readback or visual acceptance result.
3. Keep sun intensity, exposure and AO unchanged. Remove the extra hemisphere fill. Keep fog out of the close battlefield. Reduce shadow normal bias from 25 mm to 12 mm (and depth bias magnitude slightly) to avoid unnecessarily displacing small contact footprints; use Three r186's actual `PCFShadowMap`, not the removed `PCFSoftShadowMap` alias. No model is darkened, resized or replaced.

This follows [Riot's graphics-pipeline breakdown](https://www.riotgames.com/en/news/trip-down-lol-graphics-pipeline), which treats unit shadows as grounding and renders gameplay indicators separately; and the real-time solar separation described by [Sébastien Lagarde / Unity's HDRI workflow](https://seblagarde.wordpress.com/2016/08/28/siggraph-2016-an-artist-friendly-workflow-for-panoramic-hdri/) and [Poly Haven's Greg Zaal](https://blog.polyhaven.com/how-to-create-high-quality-hdri/). The art-directed rig is not an absolute reconstruction of the photographed sun's lux or solar angle.

**Cost:** the first actual candidate measured 455 render calls / 155,269 triangles versus 296 / 90,968 for the baseline (+53.7% calls, +70.7% submitted triangles), principally the AO normal/depth pass. Software frame time was not measured, and no GPU-performance claim follows. This revision adds only one-time HDR processing, no new render pass or geometry; the next real frame must confirm costs and show enough contact/readability benefit to justify them. It remains a candidate until that comparison.
