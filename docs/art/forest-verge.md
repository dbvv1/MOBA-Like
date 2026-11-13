# Forest verge scene

`?scene=forest-verge-v1` selects one environmental composition; it can be combined with `materials=quiet-family-v1`. The default and player menu are unchanged.

The visual goal is a readable battle strip with irregular forest openings, warmer open earth and cooler forest margins rather than a uniform tree fence. The scene reuses the repository's licensed tree/rock assets, replaces their decoration layout with 118 clustered instances and applies a shared broad world-space color mask to road, forest and shoulder patches. No new assets, simulation rules, collision, navigation, combat cue colors are introduced; the optional environmental audio is described below. Ambient sky/ground colors and distance haze belong to the same scene option.

The mask runs after existing texture hooks, in fragment world space. Evaluating nonlinear variation at vertices of differently tessellated road and shoulder meshes can expose seams; both surfaces instead evaluate the same function per fragment. There are no additional textures, render targets or passes, but actual shader/frame cost still requires measurement.

CPU checks: `npx vitest run tests/client/forest-scene.test.ts tests/client/terrain-composition.test.ts tests/client/playable-world.test.ts`; web build: `npm run build:web`. Capture entry retains the scene query. Compare against the current default at the same camera and renderer before adoption. Browser shader compilation, full smoke, frame time, actual image quality and listening remain unverified; this is not a complete scene/audio quality pass.

## Forest sound bed

The same successful 3D scene selection enables an original procedural wind/leaf bed after a sound-unlock gesture. No third-party sound is copied. One eight-second mono loop feeds a separate environment gain bus into the existing master; combat samples keep their original routing and gain. Audible combat lowers only the bed, holds it for 450 ms and restores it gradually. Overlapping events extend the latest hold deadline, never shorten it. Settings, hidden tabs, mute, device suspension, completed matches and disposal suppress the environment. Failed creation releases partial nodes and leaves battle sound available; a renderer fallback never enables it.

At 48 kHz the idle bed through its actual gain × master measures −42.6 LUFS integrated / −28.7 dBFS true peak with FFmpeg `ebur128=peak=true`. An offline eight-second fixture mixing the idle bed with existing cast/hit/shield at 1.0/1.3/1.8 seconds, each at original master 0.32 and without ducking, measures −38.7 LUFS / −9.9 dBFS true peak. These fixtures do not prove live-browser mixing, all eight overlapping voices, masking, sound-device behavior or pleasant listening. The candidate has not been heard or approved for default use.
