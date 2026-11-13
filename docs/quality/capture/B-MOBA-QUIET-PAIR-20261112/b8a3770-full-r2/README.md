# B-MOBA-QUIET-PAIR-20261112 · b8a3770 full smoke pair (r2)

Paired default / quiet complete-match browser smoke on the fixed base
`b8a377078e15c0dd2fb7c367b0bf24adbee09468` (tree `66467272f24642230a31a7195b4b0b08a19bad82`).
The web build was produced from a clean checkout of that commit; `build-identity.json`
recorded `dirty:false`. No game source, assets, defaults, dependencies, lockfile or
security settings were changed.

## Environment

- Node v22.23.2, npm 10.9.8, Playwright 1.64.1.
- Chromium 156.0.8078.4, Playwright revision 1248, SHA-256
  `7f08161bbeb2853ffe1780a9ded4985087f52efb9725d7d8207aabdd42f7cfb9`.
- Headless, Chromium sandbox enabled, `--use-angle=swiftshader`; the reports record the
  real renderer as `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
- Viewport 1280 x 900, device scale factor 1, same as the existing smoke sequence.
- Build: `npm run build:web`, exit 0. Receipt and file hashes in `build-web-receipt/`.

## Harness changes (tests/client/browser-smoke only)

Two small `run.mjs` defects surfaced only when the full-match sequence was actually
completed and were fixed in that file. The fixes are cumulative patches on the `b8a3770`
`run.mjs`. The four attempts did not all use the same harness:

1. A full-match restart leaves a live match, so leaving the page autosaves a checkpoint.
   Returning to the selected entry then shows the ordinary save-choice dialog before boot
   can finish. The sequence now chooses a fresh match at that prompt; the dedicated
   save/resume check later in the sequence is unchanged.
2. `locator('footer details')` matched the Controls help and Runtime diagnostics blocks
   (strict-mode violation). The keyboard-settings step now selects the details block that
   contains `#keyboard-settings`.

Per-attempt `run.mjs` (SHA-256 of the file passed to Node):

| Attempt | `run.mjs` revision | SHA-256 |
|---|---|---|
| default first | `b8a3770` unpatched | `01de071663e8f8af706d71ae30a59fb5d8b614ab3b1b67a93e056b518e285c02` |
| default retry | v1 (item 1) | `dd1ebb090313d11841f3987ae2c52e3ef9f497bba4aa568a259a8dbb3b5be189` |
| quiet first | v1 (item 1) | `dd1ebb090313d11841f3987ae2c52e3ef9f497bba4aa568a259a8dbb3b5be189` |
| quiet retry | delivered v2 (items 1+2) | `2c0cc30345b2a1295cce56cb72106062b8b8d4ce29af14fd6266b98d4983f535` |

Only the quiet retry ran on the delivered v2 harness. The default entry never completed a
run on it: its first attempt failed at initialization with the v1 fix absent, and its retry
timed out at the readiness gate after v1. The per-attempt hashes are also in
`environment.json` (`harnessPatches`) and `script-patch-v{1,2}.sha256`.

Patch files: `script-patch-v1.diff` (item 1), `script-patch-v2.diff` /
`script-patch-delivered.diff` (items 1+2, identical bytes). CPU regression
`npm test -- tests/client/browser-smoke/harness.test.ts tests/client/browser-smoke/full-match.test.ts`
passed 20/20, exit 0 (see `logs/`).

### Delivered files

The delivered worktree carries three `tests/client/browser-smoke/` files. Their hashes are
in `deliverable-harness.sha256` (and `environment.json` → `harnessPatches`):

- `run.mjs`, SHA-256 `2c0cc303…`: `b8a3770` plus items 1+2 above.
- `full-match.mjs`, SHA-256 `8dadeb5d…`: unchanged from `b8a3770`; supplies the
  same-frame RAF callback contract that produces `sameFrameExtraCallbacks`.
- `full-match.test.ts`, SHA-256 `cf1e9e61…`: unchanged from `b8a3770`; tests that contract.

Relative to the relay branch (`aabc47b`), all three differ, but `full-match.mjs` and
`full-match.test.ts` are the fixed `base_ref`'s own versions brought into this worktree,
not additional edits (see `logs/inputs-before.sha256`, which records those hashes before the
build). The only authored edits are the two `run.mjs` items above, within the card's
allowed scope of `tests/client/browser-smoke/` and its direct tests. These three files and
this capture directory are uncommitted in the worktree (`git status`: `M` for the three
files, `??` for the capture directory).

## Attempts

| Entry | Attempt | UTC start–end | Runner exit | Result |
|---|---|---|---|---|
| default | first (`default-smoke/`) | 03:20:36–03:31:35 | 1 | Full match reached tick 9010 (`redWin`, `blueBaseDestroyed`); failed at entry initialization because the save-choice dialog blocked boot. |
| default | retry (`default-smoke-retry/`) | 03:36:52–03:39:23 | 1 | Timed out at the initial readiness gate (15 s). No page, console or HTTP error; the host was shared and heavily loaded. Handed back without a third attempt. |
| quiet | first (`quiet-smoke/`) | 03:42:55–03:54:47 | 1 | Full match reached tick 9010; failed in keyboard-and-resume on the ambiguous footer selector (fixed). |
| quiet | retry (`quiet-smoke-retry/`) | 03:58:14–04:10:18 | 0 | Passed the complete sequence: natural match, restart/input, HUD, save/resume, retired-lighting and default-entry checks. |

Times in this table are the `logs/*.start` / `logs/*.end` receipts (UTC). A run's
`report.json` `finishedAt` can be a few seconds earlier because the receipt is written
after cleanup; for quiet first, for example, the report says 03:54:45.640 while the
receipt says 03:54:47.

All three attempts that booted a natural match (default first, quiet first, quiet retry)
started at tick 0 from a fresh match and ended naturally at tick 9010 (300.33 simulated
seconds, red base won by destroying the blue base). The observer retained raw RAF
callbacks; `sameFrameExtraCallbacks` is 0 in all three. Only quiet retry also completed the
rest of the sequence. `report.processExit` describes the owned Chromium process (exit 0, no
signal); the runner exit codes are the ones in the table and in `logs/*.exit`.

Observed frame intervals (include observer overhead; software renderer on a shared host,
not GPU timings and not a comparison against another renderer):

- default first, 1243 frames: mean 489.5 ms, p50 490.1, p95 550, p99 1540, max 1850.
- quiet first, 1225 frames: mean 527.1 ms, p50 530, p95 580.1, p99 1120.1, max 2110.1.
- quiet retry, 1261 frames: mean 502.1 ms, p50 510, p95 570.1, p99 1350, max 2069.9.

`fullMatch.acceptanceReady` remains `false` by design. This unit does not promote the
default, does not merge to main and does not deploy. The quiet retry passed the complete
sequence on the delivered v2 harness; the default entry has no complete passing run on
that harness, so the pair is not a promotion gate.

## Collection

`paths.json` maps the 59 collected run and build files to their original location and
records the SHA-256 of the original bytes; `README.md`, `environment.json` and `paths.json`
itself are authored alongside the collection. Sixteen entries are marked
`sanitized: true` and had local absolute paths replaced with `<repo>`, `<ms-playwright>`
and `<receiver-run>`:

- the four `report.json` files (`default-smoke/`, `default-smoke-retry/`, `quiet-smoke/`,
  `quiet-smoke-retry/`);
- `logs/browser-smoke-tests.log`, `logs/browser-smoke-tests-r1.log`,
  `logs/browser-smoke-tests-v2.log`, `logs/default-smoke.log`,
  `logs/default-smoke-retry.log`, `logs/quiet-smoke.log`, `logs/quiet-smoke-retry.log`;
- `logs/chromium.sha256`;
- `script-patch-v1.sha256`, `script-patch-v2.sha256`;
- `default-first-failure.sha256`, `quiet-first-failure.sha256`.

Sanitizing changes their bytes, so these 16 files do not hash to the `sha256` recorded in
`paths.json`; that value is the pre-sanitization original. The other 43 entries are marked
`sanitized: false` (images, manifests, `full-match-frames.json`, `FIRST-FAILURE.txt`, diffs,
build receipts, build/install logs, input and harness hash receipts, start/end/exit
receipts) and are byte-identical to the run output, matching their recorded hashes.
`logs/` holds the full build, install, regression and smoke stdout/stderr plus
start/end/exit receipts.
