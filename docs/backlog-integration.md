# Playable backlog integration

Entry: `/candidate.html`; optional lighting: `/candidate.html?lighting=stylized-diffuse`. Normal `/` stays v10, including original HTML/CSS except one candidate link and the source entry reference. `default-source-manifest.json` pins every default source, shared asset and original HTML hash. The only default-source transformation redirects presentation imports to the exact frozen original presentation modules. Bundler content hashes separate changed candidate output from unchanged default assets.

Requested source order: e829968 → 003884b → cca9c5d → baecaf5 → 8ac7340 → 3f89df2 → 56f8e78 → 01e9568 → 89f0831 → 14cbe4c → ea7a064. Neither rejected 38f36d1 nor unrecoverable d0db3d7 is included. Basic page-input smoke is rebuilt against this combined tree; it is not the lost input-latency/frame-recording packet and cannot justify changing the default for feel.

Integration resolves terrain plus diffuse material/lifetime ownership; keyboard settings plus local-save pause/input/restore; content v11 plus deterministic saved replay. Old new-phase/5v5/material-family candidates are not included.

## Fixed-source headless gate

Run on the existing authorized receiver, **one GPU task at a time**, after actual process/lease preflight. Never terminate unknown owners. No visible windows or desktop input. Playwright page input is used only for smoke. From the exact clean candidate SHA:

```
npm ci
npm test
npm run build
npm run build:web
MOBA_SMOKE_SOURCE_SHA=<exact-40-character-sha> MOBA_SMOKE_RENDERER=gpu node tests/client/browser-smoke/run.mjs
```

The runner serves the built bytes on an owned loopback port, verifies build identity, checks both default v10 and candidate v11, layout, page-input movement/stop/camera/cast, real 3D assets and pixels, restart, key rebinding and save/reload/continue. Each run writes an exclusive `smoke-artifacts/<UTC>-<pid>/` directory. Keep raw renderer information, `gpu/software/unknown`, source identity, failure stage and own browser process exit / preview closure. Raw local process paths stay local; sanitize private paths before publishing any report. This is smoke, not a blind judgment, GPU screenshot comparison, listening check or input-to-feedback frame acceptance. No automatic renderer or sandbox fallback. Software requires a separately explicit `MOBA_SMOKE_RENDERER=software`; unknown renderer remains unknown.

A 180-second external receiver timeout must still close its owned runner/browser/preview and return actual exit receipts, not a cancelled Git label. Never merge main or update website before actual smoke passes. Reuse unchanged independent source reviews, but review the integration conflicts and test the final combined source.
