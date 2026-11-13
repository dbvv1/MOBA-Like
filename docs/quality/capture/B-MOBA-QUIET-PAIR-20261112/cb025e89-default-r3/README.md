# B-MOBA-QUIET-PAIR-20261112 · default complete-flow smoke (cb025e89, r3)

Complete `default` browser smoke on the fixed base
`cb025e897b9d92f9db470d0a057098adb0404f87` (tree `96748ddd7c0061d901bd96195da0fb704b43c4ab`).
The web build was produced from a clean detached worktree of that commit;
`build-web-receipt/capture-build-identity.json` records `dirty:false`. No game
source, assets, defaults, dependencies, lockfile or security settings were changed.
`cb025e89` already contains the delivered v2 smoke harness, so this unit made no new
script patch: `run.mjs` SHA-256 `2c0cc303…`, `full-match.mjs` `8dadeb5d…`,
`full-match.test.ts` `cf1e9e61…`, identical to the accepted base files.

## Result

The run passed the complete sequence in one attempt: natural fresh match from tick 0
to tick 9010 (300.33 simulated seconds, `redWin`, `blueBaseDestroyed`), then the
ordinary Restart with further progression and real right-click movement, legacy v10,
entry initialization after choosing a fresh match at the save-choice prompt, HUD
layout at eight widths, movement stop, targeting, persistent effect, hero
selection/restart, keyboard remapping, save/resume, retired-lighting entry and
default-entry checks. `report.passed` is `true` and the outer wrapper exit code is 0.

| Field | Value |
|---|---|
| Outer UTC start–end | 2026-11-13T06:27:06Z → 2026-11-13T06:38:59Z |
| Runner report start–end | 2026-11-13T06:27:08.120Z → 2026-11-13T06:38:56.678Z |
| Full match observation | 2026-11-13T06:27:17.629Z → 2026-11-13T06:37:28.710Z |
| Outer exit code | 0 (`logs/default-smoke.exit`) |
| Browser process | exit 0, no signal (`report.processExit`) |
| Preview listener | closed (`report.previewClosed: true`) |
| Cleanup errors | none |
| Console/page/HTTP/request errors | 0 / 0 / 0 / 0 |

Natural terminal state: `status:redWin`, `endReason:blueBaseDestroyed`,
`winner:1`, blue base `alive:false hp:0`, red base `alive:true hp:2600`,
`contentVersion:11`.

## Environment

- Node v22.23.2, npm 10.9.8, Playwright 1.64.1.
- Chromium 156.0.8078.4, Playwright revision 1248, binary `chrome-win64/chrome.exe`
  SHA-256 `7f08161bbeb2853ffe1780a9ded4985087f52efb9725d7d8207aabdd42f7cfb9`.
- Headless, sandbox enabled, `--use-angle=swiftshader`,
  `ignoreDefaultArgs:['--enable-unsafe-swiftshader']`. The real browser and GPU
  process argv recorded during the run (`logs/chrome-process-argv.json`) contains
  `--use-angle=swiftshader` and contains neither `--no-sandbox` nor
  `--enable-unsafe-swiftshader`.
- Real renderer from `WEBGL_debug_renderer_info`:
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`
  → class `software`. This is a shared-host software result, not a hardware-GPU
  timing statement.
- Viewport 1280 × 900, device scale factor 1, canvas 1280 × 900.
- Entry `/`, variant `default`, content version 11, forest lighting.
- Materials start and end: `{requested:baseline, configured:baseline, active:baseline}`.

## Full-match frame observation

- 1225 observed RAF callbacks and 1225 distinct RAF timestamps;
  `sameFrameExtraCallbacks:0`.
- Frame-interval distribution (includes observer overhead): count 1224,
  mean 497.83 ms, p50 509.9, p95 540.1, p99 1070, max 2019.9, over 33.333 ms 1205.
- Callback CPU (excludes observer snapshots): count 1225, mean 43.30 ms,
  p50 12.9, p95 26.3, p99 1025.2, max 1521.8.
- `fullMatch.acceptanceReady` remains `false` by design. These are not GPU
  execution timings and this run is functional observation only.

## Build

`npm run build:web`, exit 0, `web-dist/build-identity.json`:
`{commit:cb025e89…, tree:96748ddd…, dirty:false}`. Receipt and per-file hashes:
`build-web-receipt/`. Tracked status before and after the build was clean
(`logs/worktree-pre-state.txt`, `logs/git-after-build.txt`).

## Regression

`npm test -- tests/client/browser-smoke/harness.test.ts tests/client/browser-smoke/full-match.test.ts`
passed 2 files / 20 tests, exit 0 (`logs/regression.log`). Veyra baseline was
verified first (`logs/veyra-baseline.log`). CPU checks do not establish a browser
pass; the browser result above is the separate executed evidence.

## Files

- `default-smoke/report.json`, `manifest.json`, `full-match-frames.json` and the
  six PNGs (`full-match-terminal.png`, `legacy-v10-canvas.png`, `canvas.png`,
  `page.png`, `diffuse-canvas.png`, `default-canvas.png`).
- `logs/`: wrapper start/end/exit, full smoke stdout, install/build/git receipts,
  real Chromium argv, environment, post-run resource check, Veyra baseline and
  regression logs. The wrapper recorded exit 0; no signal path was observed.
- `build-web-receipt/`: source identity, build log, build file hashes.
- `environment.json`: consolidated environment, report summary and sanitization map.
- `paths.json`: per-file original SHA-256 mapping. Five text files had local
  absolute paths replaced with `<repo>`, `<receiver-run>` or `<ms-playwright>`;
  their recorded SHA-256 is of the original bytes. All other files are
  byte-identical to the run output.

The unit does not merge to main, promote the default or deploy.
