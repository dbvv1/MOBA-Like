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

## Withdraw orders dropped before a simulation step

A continuation of `886726b0ded1c7114260ffbdd3ebfec1bcf858f3` fixes the other
end of this lifetime. Opening keyboard settings, hiding the page or blurring the
window already discarded the client's pending commands. If a Q click happened
before that interruption and before the next simulation step, the HUD still
claimed “Command queued.” Three real-client regressions reproduced this on the
base; all three fail there before the fix.

The existing queue owner now tells Controls which commands it is discarding.
Controls withdraws its own receipt only if the exact referenced command is still
in that batch. An order already delivered to Simulation keeps its receipt; dropping
a later shop order cannot retract an earlier delivered movement receipt. Current
message matching preserves newer instructions or authoritative results. The queue
also reports admission: its existing 32-command cap cannot replace the receipt
with a refused 33rd pointer order. A refused Q stays aimed, so a fresh click can
cast after the pending batch drains. Closed trial routes retain the old handling.
This uses
only the existing local queue and full combat-trial gate; simulation, save formats,
assets, entry selection and default/quiet behavior are unchanged.

The new client regressions cover all three interruptions, a fresh Q after return,
already-delivered orders, an unrelated pending purchase and closed trial routes.
They run real client/Controls/LocalMatch with controlled renderer/audio/navigation
I/O. The final full suite passes 93 files / 659 tests; simulation and Web builds,
Web/capture type checks, all 266 default-source pins and the public scan pass.
Independent review passes 90 focused repository tests and 14 additional real-client
cases, including the queue-cap reproduction. These checks do not establish real
browser focus behavior or visual clarity.

One isolated Canvas2D browser-gate attempt on the unmodified `886726b` build failed
before any page/context opened: sandboxed Chromium exited with `socket()` EPERM.
The launched browser exited with SIGABRT and the owned loopback server closed.
No flags were weakened and no retry or alternate launch was attempted. This
continuation still needs its own isolated-context/error-listener gate and the
original receiver's terminal receipt before adoption. No screenshot, score,
product-main or hosted-site change is claimed.
