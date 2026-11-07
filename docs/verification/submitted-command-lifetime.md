# Submitted-command receipt lifetime in the existing combat trial

The candidate based on `90d4fad0885847d53aa96a33debb766b9237c28b` retained
“Command queued.” after a natural player death. A confirmed click had already
ended the targeting mode, so the existing aim-only lifecycle cleanup skipped it.
A real client/Controls/LocalMatch regression fails on that base with the stale text.

The full existing Camera + Q/W trial now withdraws only its own submitted-command
receipt when the player dies or the match ends. A newer authoritative rejection
or terminal announcement takes precedence. Natural respawn requires a fresh input,
and that input can show a new receipt and release a Q normally.

The default page, partial/duplicate queries and quiet-material path retain their
shipped behavior. This patch does not alter input commands, simulation, balance,
saves, asset bytes, source pins, entry links or trial selection. It does not clear
accepted-command receipts merely because the tab blurs.

Validation includes natural death/respawn and recast, terminal-result precedence,
closed-route behavior, and a real Q rejection immediately before a natural death.
All 93 test files / 644 tests pass. Simulation, Web and capture type checks/builds
pass. Independent source review and 21 additional focused controls checks found
no blocker. The public-content scan passes.

This is CPU/DOM and build evidence only. No browser context, pageerror listener,
WebGL frame, screenshot, sound check or visual-quality review was performed.
The isolated-context and complete uncaught-error gate for the earlier candidate
remains open; it must also run on this exact continuation before adoption.
Main/default selection and the hosted site are unchanged.
