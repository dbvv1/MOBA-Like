# Veyra death source in the existing combat trial

Date: 2026-11-06. Product base: `7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64`.
This isolated integration reuses the received consumer tests from `43af65e88598bad3ca9f9effea35902cf7bd07f8` and the already accepted source package. It does not regenerate assets or replace the default release.

## Product wiring

The existing Camera + Q/W entry, `/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1`, now selects the two source-rebuilt GLBs under `asset-pipeline/veyra-death-contact/canonical/exported/` in this candidate. No new entry, public parameter or fourth trial was added. This is part of the existing combat-feedback trial, not a new gameplay phase or a three-lane expansion.

The actual call chain is `client.ts` → `createPlayableWorld` → `createWorld` → `loadBattleAssets` → `heroPresentationAssets` → `createPresentation` → `createMotion`. The loader replaces the same two Veyra slots in manifest order and retains the existing ownership/cleanup code. Runtime fallback GLBs are not used. The world and CPU tests share the exact Veyra options, `torso-additive` and `firstDrawRelease: 0.1`.

Only the candidate page with all four unambiguous existing parameters selects the contact source. Default `/`, partial camera/audio combinations, standalone command-buffer, duplicate parameters and quiet material routes retain the old hero source. Initial fixed-capture worlds also force baseline. A contact-source world refuses content-standard mode rather than silently using the wrong pinned model. Changing the camera pose through `setCaptureView` after a contact world is created does not replace its assets; the fixed-capture client constructs its world with capture already set and therefore remains baseline.

If candidate initialization fails, the existing recovery path disposes its owned resources, loads the baseline renderer and keeps the visible recovery warning. Canvas2D diagnostics report `heroSource: null`; a 2D recovery does not count as playing the death animation. `heroSource` is configuration/source identity, not proof of a rendered frame or visual approval.

## Preserved boundaries

- `default-source-manifest.json` and all 266 pinned files/shared assets retain their hashes.
- Original `heroes/veyra-release`, received death source package, quiet family/layout manifest, content-set locks, frozen `default-src`, both HTML entry/link lists and `src/capture` are unchanged.
- Quiet standard source references retain their existing hashes; the content-set total remains 680900 bytes.
- No simulation, input rules, saves, audio, hero balance, map or stage B/C feature changes.
- The death-only reviewed base `a37421c` kept Gold `4d8408b` and Q/W `50fda56` separate. The continuation below explicitly receives those fixed results into this same isolated branch.

## Checks at the death-only base

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


## Receive the existing Gold and Q/W results in the same trial

The continuation is based on the already backed-up `a37421c9f8fac2fc8870aeae19bb488636b16136`, not on a new trial or a restarted worker. The original three relay branches remain unchanged. No new original-operation terminal receipt was available in the current cards.

- Gold `4d8408b` is reused without rewriting its runtime consumer: every actual client step feeds `goldAwarded` into the player-only, tick/ordinal-deduplicated receipt; HUD reads the latest two-second simulation-time reward. The six-file result applies without conflicts, including the necessary `save-lifecycle` dependency injection and unchanged assertions.
- Gold is visible in the shared HUD on ordinary and candidate routes in this branch. This is the intended new reward feedback, not a switch of the default hero source or a new parameter. Narrow-screen/low-height layout, reading order and actual visibility remain unverified.
- Q/W `50fda56` is reused as the same six continuous input scenarios. Both the primary run and replay now use the production command-frame envelope; every replay tick additionally compares full presentation events. The recorded command and trace hashes remain unchanged. This does not change the v12 rules or claim that Stop/death cancellation should cast.
- Three retained reward-boundary regressions cover actual terminal base-destruction team gold beside the victory message, other-recipient filtering/exact expiry, and incremental same-tick receipt batching. A real completed Simulation preserves the final receipt through attempted further steps. These are CPU/DOM checks, not a substitute for terminal-screen visibility.
- The combined candidate's full suite passes 93 files / 607 tests. The current cloud environment does not reproduce the original receiver's audio-skill failure; no audio implementation or assertion was changed.

The same main/browser/publication gates above still apply to the combined candidate. This receive-and-integrate step is not evidence that any original worker has exited, that the player has seen the feedback, or that main/the hosted game has changed.


## Existing-trial boundary correction after c967c1b

The combined branch had also enabled the Gold receipt and input-notice/life cleanup on the default page. These behaviors are now gated by the same exact entry predicate as the existing death-source trial. Only the full Camera + Q/W URL above enables all three. The predicate is shared, accepts an explicit single `materials=baseline`, and rejects partial, duplicate, default-page and quiet queries. There is no fourth trial or new public parameter.

With the trial closed, the HUD does not create a reward line, no receipt is consumed, and Controls preserves the shipped cancellation, death/respawn and dead attack-move behavior. With it open, reward feedback and the reviewed life-scoped aiming fixes remain active, including when rendering falls back to Canvas2D. Simulation, save format, default-source pins, asset bytes and HTML links remain unchanged.

Validation of this boundary change: 93 files / 636 tests pass, including 15 new closed-entry client regressions. Simulation, web and capture builds pass. Independent source review and stepwise Controls/HUD comparisons check the closed path against main and the enabled path against c967c1b. These are CPU/DOM checks. The earlier c967c1b browser observations apply only to that fixed build; they do not validate a build containing this correction. Fresh browser acceptance remains required before adoption or deployment.

## Continue the same candidate with pinned contact exports

The continuation from `00f82c7` includes accepted main `aade37c`: the original five-file snapshot verifier and the isolated heroes recipe are now available to this same combat trial. Merge resolution retains the candidate's production motion options, full 61-point contact sampling, mesh topology checks and command-frame replay, while adopting main's complete baseline-byte verification and observable Escape-cancel regression. No original-operation terminal receipt was supplied by those commits.

Previously, this trial selected the source-rebuilt exports by a mutable manifest path, but the actual downloader did not check that the bytes reaching `GLTFLoader` were the selected exports. At that stage, `src/render/veyra-contact-pin.ts` fixed the two received Blender 5.2 export IDs, paths, byte counts and SHA-256 values; the canonical continuation below updates those pins. The existing ordered loader verifies the downloaded buffer and passes that same buffer to the parser. A missing/changed manifest entry fails before downloads; truncated or same-size changed bytes fail before parsing that model. Missing Web Crypto fails the candidate rather than skipping the check. Other successfully loaded models are disposed through the existing failure path, and the existing playable-world recovery can still load the original heroes release without contact verification.

That continuation closed the candidate's **selected-file → verified downloaded bytes → real parser** gap. It did not replace the original `heroes/veyra-release` exports, their default/content-standard locks, or the source-rebuilt candidate with the separate Blender 4.3 recipe outputs. No default, quiet-family entry, public switch or deployment changed in that continuation. Full default adoption still requires the source/manifest/standard-set pin changes in the package's Adoption section, after the outstanding browser and visual gates.

Reproduce the CPU portion after preparing the original snapshot:

```sh
python3 asset-pipeline/veyra-death-contact/tools/baseline.py
npm test -- --run tests/client/death-source-loader.test.ts tests/client/veyra-contact-consumer.test.ts tests/client/playable-world.test.ts
npm test
npm run build
npm run build:web
```

The actual-loader tests use real exports and the production parser/animation data with CPU PNG decoding, not a WebGL renderer. They cover both fixed source exports, same-size byte replacement, truncation, missing crypto, changed/missing manifest entries and loading the old release after failure. Main adoption, actual WebGL death frames, both-faction same-view comparison, default/full-trial smoke, sound and feel remain unverified. The original unknown invocation and prior browser/DevTools denials remain unchanged.

## Canonical source recipe used by this trial

The trial now consumes actual Blender 4.3.2 `build.py` → UAL1 `retarget.py --death-contact` outputs. [Rebuild commands and exact artifact boundary](../../asset-pipeline/veyra-death-contact/canonical/README.md) keep the original sources, received 5.2 package and default release untouched. Both exported GLBs preserve the original JSON and non-death channels; only 55 binary bytes in the death Root Y track change per faction. Repeating retarget yields identical exports.

The production loader tests now verify the canonical download buffers, and `veyra-canonical-consumer.test.ts` independently compares all non-death track values/times/interpolation with the fixed original baseline. It samples the real production mixer at 61 death times plus a late frozen pose against the received source-rebuilt 5.2 package. This connects the canonical recipe to a playable trial path, not visual acceptance: browser/GPU/death appearance, deployment and default adoption remain unverified.
