# Battle sound palette

Four unmodified CC0 recordings from Kenney's official free downloads:

| File | Original pack / file | Game cue |
|---|---|---|
| swing.ogg | [RPG Audio](https://kenney.nl/assets/rpg-audio), knifeSlice.ogg | Committed hero basic attack, not a hit confirmation |
| cast.ogg | RPG Audio, cloth1.ogg | Resolved skill release, not a hit confirmation |
| hit.ogg | [Impact Sounds](https://kenney.nl/assets/impact-sounds), impactSoft_medium_000.ogg | Actual hero HP damage |
| shield.ogg | Impact Sounds, impactMetal_light_000.ogg | Shield-only absorbed damage |

Included original license files apply. Playback uses distance attenuation, stereo position, a short release envelope and a bounded voice count; the samples do not drive simulation. These are the first integrated comparison palette, not a claim of completed listening assessment. Compare an actual tower-front exchange at the default mix against the selected reference before calling the sound quality accepted.

License text copies use LF line endings with trailing whitespace removed; legal wording and attribution match the original packages. Original official archive SHA-256 values: RPG Audio `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b`; Impact Sounds `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`. The four runtime recordings are unchanged.

## Q/W release family candidate

Only `audio=critical-v1` uses `skill-q.ogg` for a real Q `castResolved` and
`skill-w.ogg` for W. Baseline and E/R retain `cast.ogg`. Slot identifies the
player's action, not a hit or hero identity: Veyra W is dash, Morrow W is shield.
The Q/W pair is an unaccepted sound-design candidate, not benchmark parity.

Both are derivatives of the shipped CC0 `cloth1.ogg`, with original procedural
oscillator layers. No additional recordings, model weights, or commercial game
sounds are used. The original RPG Audio license above also covers the source.
`python3 tools/build-skill-audio.py` checks its source hash, decodes through
FFmpeg, runs the editable standard-library recipe, and writes Vorbis quality 5
mono 48 kHz runtime files. FFmpeg with libvorbis is required; no network is used.

Shared rule: source texture plus a short oscillator layer, no impact/confirmation
cue; target source RMS 0.10, peak capped at 0.55, existing master gain 0.32.
Q uses a 3 ms attack, high-passed cloth, descending 920 Hz tone and 180 ms body.
W uses a 14 ms attack, low-passed cloth, 260–328 Hz rise plus 390 Hz layer and
310 ms body. These are design intentions, not listening results. The recipe's
rates, envelopes and source mix can be changed and both files rebuilt together.
Runtime retains the existing release envelope, spatial attenuation, priority,
25 ms critical scheduling gap, deduplication, pause/reset and voice limits.
Missing derivative samples fall back to the existing cast sample.

Private `outputs/skill-audio/` contains individual WAVs, before/after Q→W
excerpts with the same 25 ms scheduling gap, and measured source peak/RMS.
Encoded hashes may differ between FFmpeg builds; PCM and musical identity must
be checked separately. Neither offline PCM nor fake-device tests prove real-time
sound, perceived distinction, audio/video sync or actual-match mixing. Independent
listening and browser smoke remain required before publication or default change.
