# Veyra death source in the existing combat trial

Date: 2026-11-06. Product base: `7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64`.
This isolated integration reuses the received consumer tests from `43af65e88598bad3ca9f9effea35902cf7bd07f8` and the already accepted source package. It does not regenerate assets or replace the default release.

## Product wiring

The existing Camera + Q/W entry, `/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1`, now selects the two source-rebuilt GLBs under `asset-pipeline/veyra-death-contact/exported/` in this candidate. No new entry, public parameter or fourth trial was added. This is part of the existing combat-feedback trial, not a new gameplay phase or a three-lane expansion.

The actual call chain is `client.ts` → `createPlayableWorld` → `createWorld` → `loadBattleAssets` → `heroPresentationAssets` → `createPresentation` → `createMotion`. The loader replaces the same two Veyra slots in manifest order and retains the existing ownership/cleanup code. Runtime fallback GLBs are not used. The world and CPU tests share the exact Veyra options, `torso-additive` and `firstDrawRelease: 0.1`.

Only the candidate page with all four unambiguous existing parameters selects the contact source. Default `/`, partial camera/audio combinations, standalone command-buffer, duplicate parameters and quiet material routes retain the old hero source. Initial fixed-capture worlds also force baseline. A contact-source world refuses content-standard mode rather than silently using the wrong pinned model. Changing the camera pose through `setCaptureView` after a contact world is created does not replace its assets; the fixed-capture client constructs its world with capture already set and therefore remains baseline.

If candidate initialization fails, the existing recovery path disposes its owned resources, loads the baseline renderer and keeps the visible recovery warning. Canvas2D diagnostics report `heroSource: null`; a 2D recovery does not count as playing the death animation. `heroSource` is configuration/source identity, not proof of a rendered frame or visual approval.

## Preserved boundaries

- `default-source-manifest.json` and all 266 pinned files/shared assets retain their hashes.
- Original `heroes/veyra-release`, received death source package, quiet family/layout manifest, content-set locks, frozen `default-src`, both HTML entry/link lists and `src/capture` are unchanged.
- Quiet standard source references retain their existing hashes; the content-set total remains 680900 bytes.
- No simulation, input rules, saves, audio, hero balance, map or stage B/C feature changes.
- Gold HUD candidate `4d8408b` and Q/W evidence candidate `50fda56` remain separate from this branch. This integration does not silently adopt either pending candidate.

## Checks

- Full Vitest suite after integration: 89 files, 585 tests passed. This includes actual client/Controls/LocalMatch Q→W releases on the default, full-trial and quiet-trial paths with controlled renderer/audio/navigation I/O.
- Real GLTFLoader plus production loader/definition mapping/presentation: both baseline and contact paths load 19 models, verify the two selected file hashes, play the actual death clip and retain source-resource ownership until loader disposal. No WebGL renderer is created by this test.
- Enhanced received consumer suite: 8 tests. Production and override configurations sample 61 death points per faction; non-death tracks, interpolation, topology and 28 poses per faction are checked. First-draw, control, additive hurt, cancellation, death override and cloned-instance isolation are covered.
- Fixed-baseline resolver: default, repo-relative and absolute overrides pass; selecting the candidate directory as baseline fails explicitly. The old-source assertions were retained, not weakened.
- Simulation build, Web typecheck/build, capture typecheck/build passed. Bundled GLBs contain both old and contact sources.
- Python death-source suite: 32 passed. Content-set source/lock suite: 7 passed.
- The earlier receiver's audio-skill failure was not reproduced in this cloud suite; no audio code or assertion was changed, and its original environment cause is not claimed fixed.

## Not yet accepted or published

This is a source/CPU integration candidate, not a main-branch or website delivery. The original receiver's invocation termination has no verified receipt. Its status label and result branch are not treated as termination evidence. No duplicate receiver run or denied process/browser operation was retried.

The current browser path remains unavailable after its recorded permission failure. No browser smoke, actual WebGL frame, fixed PNG, same-camera visual comparison, sound check or player feel judgment was performed. CPU contact minima are not visual approval.

Before receiving into main: obtain the permitted original-operation terminal receipt; review this fixed tree; run the common clean-build default and existing-trial browser gate from ready for at least 300 ticks with no additional uncaught application error. For death appearance acceptance, require actual WebGL consumption and same-view death-frame comparison, including baseline and contact, both factions, non-death actions and lifecycle recovery. Canvas2D alone only validates fallback/playability. Keep the default unchanged unless separately accepted. Deployment and the existing quiet publication outcome must be handled independently; neither was attempted here.
