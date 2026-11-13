# Forest verge scene

`?scene=forest-verge-v1` selects one environmental composition; it can be combined with `materials=quiet-family-v1`. The default and player menu are unchanged.

The visual goal is a readable battle strip with irregular forest openings, warmer open earth and cooler forest margins rather than a uniform tree fence. The scene reuses the repository's licensed tree/rock assets, replaces their decoration layout with 118 clustered instances and applies a shared broad world-space color mask to road, forest and shoulder patches. No new assets, simulation rules, collision, navigation, combat cue colors or audio are introduced. Ambient sky/ground colors and distance haze belong to the same scene option.

The mask runs after existing texture hooks, in fragment world space. Evaluating nonlinear variation at vertices of differently tessellated road and shoulder meshes can expose seams; both surfaces instead evaluate the same function per fragment. There are no additional textures, render targets or passes, but actual shader/frame cost still requires measurement.

CPU checks: `npx vitest run tests/client/forest-scene.test.ts tests/client/terrain-composition.test.ts tests/client/playable-world.test.ts`; web build: `npm run build:web`. Capture entry retains the scene query. Compare against the current default at the same camera and renderer before adoption. Browser shader compilation, full smoke, frame time, actual image quality and audio remain unverified; this is not a complete scene/audio quality pass.
