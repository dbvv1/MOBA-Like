# Critical battle audio candidate

Explicit opt-in: `candidate.html?commands=buffer-v1&audio=critical-v1` (v12), or `candidate.html?audio=critical-v1` (v11). No `audio` parameter, unknown values or duplicate parameters retain baseline. No new samples, mix gain, simulation rules, camera, input, saved state or replay formats change. This is a CPU-verified candidate, not an adopted sound-quality result.

## Bounded scheduling contract

- Keep existing cue routing, distance attenuation, hit duplicate suppression and weighted priority `hit4/shield3/cast2/swing1 × strength`; stable ties preserve event order. Keep the original highest-weight foreground event, plus independent player skill releases and hits involving the player. Other NPC cues remain coalesced. No invented sound for cast start, cancellation or death.
- Separate critical events can use the same existing sample but get separate event-keyed playback plans. Q and W remain the same cast timbre: independent plans do **not** establish that listeners can distinguish the skills.
- Global onset gap remains25ms and total live/scheduled voices remains8. At most4 future source starts, at most100ms ahead of current AudioContext time. At capacity/deadline, drop the new event with a reason; do not grow a queue or preempt an earlier plan. Weight ordering applies inside each sync; later catch-up ticks do not reorder already submitted plans.
- Reject events older than3 simulation ticks (100ms at30Hz) relative to their supplied snapshot, or from its future. This age guard and100ms scheduling horizon are separate bounds. In normal client each catch-up tick submits its own snapshot, so it cannot measure that event's wall-clock age before receipt; no such latency claim is made.
- The finite queue is Web Audio's scheduled sources, not JavaScript timers or a polling backlog. Starts are submitted immediately and spaced; no gain increase or simultaneous onset is added. Samples may overlap, as baseline voices already can. A stalled render loop cannot cause a later JS timer to drain a backlog.
- Keyboard settings/hidden pause, sound-off, device state leaving running and dispose stop current/future candidate voices and clear reservations. Resume does not replay consumed keys; only fresh events can schedule. Restart creates a new owner and dedup cursor. Default baseline pause behavior stays unchanged. Blur alone only clears game input under the existing client contract, so it does not represent game pause here.
- Unavailable device/sample, inactive owner, density, voice cap, pending cap, deadline, event age and reset cancellation are distinguishable in a bounded64-entry read-only `inspect()` trace. The trace is diagnostic, not a new HUD or save payload.

## CPU before/after evidence

`npx vitest run tests/client/audio-diagnostic.test.ts tests/client/audio-critical.test.ts tests/client/keyboard-client.test.ts` emits local JSON to ignored outputs/audio-{diagnostic,critical}/report.json.

Same real LocalMatch seed1, Veyra, Q tick1/W tick2:

| Case | Baseline | Candidate planned AudioContext times |
|---|---|---|
| v11 Q (W rejected by gameplay) | one cast at5/30s | unchanged |
| v12 Q+W resolve tick5 | one cast at5/30s | Q5/30s, W5/30+25ms |
| isolated actual hit+W tick16 | hit only at16/30s | higher-weight hit16/30s, W+25ms |
| isolated real Q/W and subsequent Q hit, same slow callback ticks3–9 | cast1.000s, tick8hit dropped | Q1.000s, W1.025s, hit1.050s |

Isolated cases use the existing test helper only to place heroes at0/5; events are produced by unchanged simulation. Before/after state hashes match. Separate synthetic remapped-event fixtures test overload/age/dedup and are labelled; they are not legal rapid recast gameplay. Fake AudioContext records actual production `source.start/stop` calls. It does not decode/play OGG or measure device latency, output amplitude, perceived rhythm or audio/video alignment.

Overload tradeoff: sustained critical bursts beyond the bounded budget can still lose cues, with recorded reason. The candidate intentionally adds up to100ms of **planned** delay and may overlap samples. These are explicit conservative experiment bounds, not benchmark-calibrated best rhythm. No higher-volume mix, unbounded backlog or new audio system was introduced.

Actual listening, production browser audio-output capture and audio/video synchronization remain unverified. No browser run or publishing is part of this local candidate. Existing rejected/pending publication actions are unrelated and untouched.
