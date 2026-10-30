# Woodland stone/earth material pair — asset-only candidate

Two original native image_gen material samples, generated 2026-10-30. Intended for the original MOBA woodland battlefield, not copied from a commercial game's assets. Existing repository earth/forest albedos were visually inspected for palette and frequency; neither was submitted as generation input. Prompts and exact edit requests are in prompts.json. Generation used the built-in image tool, not CLI/API or procedural noise. Each material received exactly one targeted second pass to remove baked directional bevel light.

## Selected samples

- source/ground-stone-earth-v2.png: broad embedded stones and muted olive patches on taupe earth.
- source/wall-stone-v2.png: broad hand-painted masonry in the same palette.
- v1 files retain the first generated results for process comparison.

Actual output: 1254 × 1254, 8-bit RGB PNG, opaque. Requested square 1024 but tool returned 1254; no resampling applied to source. No embedded ICC/sRGB metadata; intended importer interpretation is sRGB base-color, not measured/calibrated color. Do not use as linear data or normal map.

Provenance: original AI-generated content made with OpenAI native image_gen for this project under user authorization; no third-party asset input or commercial reference copied. Not a CC0/public-domain declaration and not an assertion of exclusive copyright. Native PNG provenance metadata retained. No added purchase/API fee was initiated.

## Asset inspection, not in-game acceptance

Source pixels, 320px thumbnails and 2×2 repetitions were visually inspected. First pass contained bevel-like bright/dark rims; second pass removes these substantially. Medium stone/earth groups remain readable at 320px without gravel speckle. Wall grout is now flat color. No text, logo, perspective or cast shadow seen. Broad painterly patches still have value variation; game-lighting validation must ensure these do not read as baked relief.

Edges are visually continuous at the inspected 320px repetition, but **not pixel-exact seamless**: raw opposite-border differences remain (see metrics.json). This is a small-sample candidate, not certified seamless production texture. Repetition of large stones and masonry courses is visible in 2×2: UV scale/orientation and battlefield readability must be checked in actual fixed-camera game images before adopting. The ground pair may still resemble stamped stones at inappropriate world scale; do not equate lower noise with better game art.

review/*-320.png and *-repeat-2x2.png are inspection derivatives only (Pillow resizing/tiling of actual generated pixels), not generated game screenshots. No renderer, default route, gameplay, or production asset reference changed. No game smoke or blind in-game verdict is claimed. Next step: same camera and lighting as accepted forest lighting, use small standard-piece comparison, then independent blind judgement; reject if readability or scene coherence worsens.
