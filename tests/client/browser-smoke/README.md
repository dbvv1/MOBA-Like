# Browser smoke

From the repository root, `npm run smoke` builds the web client, starts a temporary loopback-only server, launches Playwright Chromium, and requires a live Three/WebGL2 canvas, advancing simulation, pointer movement and stop commands, camera controls, HUD, varied canvas pixels, and no browser errors. A fallback or initialization failure exits nonzero. It does not grade animation quality or game balance.

Install Chromium through `npx playwright install chromium` in an authorized environment, or explicitly set `MOBA_SMOKE_CHROMIUM` to an existing absolute executable path. The default keeps the Chromium sandbox enabled and uses software WebGL flags. `MOBA_SMOKE_CLOUD_NO_SANDBOX=1` is an explicit option only for an environment where that mode is authorized; the harness never retries with it automatically. Do not use overrides to work around an access denial.

`npm run smoke:serve` builds and serves the same files without launching a browser. It prints its actual `127.0.0.1` URL; Ctrl+C closes the listener.

Screenshots and `report.json` are local ignored files in `reports/`. Each run replaces its own previous evidence. Failures distinguish launch, HTTP load, initialization, WebGL, input/simulation, pixels, and browser errors; cleanup failures also fail the run. `npm test -- tests/client/browser-smoke/harness.test.ts` tests helper failure cases and real HTTP listener cleanup without launching a browser.
