# Beacon Guard reaction source

The playable presentation uses this original Beacon Guard source for blue, and
reuses only its reaction tracks on the existing amber rig after exact binding
checks. Amber keeps its own geometry and materials. This is not a retargeter.

`author_reactions.py` extends the existing editable
`../../placeholder/assets/blue.blend`, preserving idle/walk/attack and authoring
hurt/death. It was adopted from `dbvv1/a1dbv` commit
`53ec27626c15ad08377f4979cb7ea41489f138f7`, `experiments/character-animation`.
The source and derived Blend/GLB remain the repository's original resource under
[its resource-specific CC0 dedication](../../placeholder/LICENSE.txt), not a
third-party asset. This does not license the entire repository.

With Blender 4.3.2, from the repository root, generate into a **new** output path:

```sh
blender -b --factory-startup --disable-autoexec --threads 2 --python-exit-code 1 \
  --python asset-pipeline/characters/beacon-guard/author_reactions.py -- \
  --input asset-pipeline/placeholder/assets/blue.blend \
  --output asset-pipeline/characters/beacon-guard/generated-next --fall-frames 24
```

The output includes editable Blend, runtime GLB and recipe (source hash, preserved
action/structure fingerprints, durations). Change the pose angles in the `hurt`
and `death` branches to author a pose. Change `--fall-frames 24` to `36` for a slower
fall, retaining the six-frame hold and the other four actions. Do not rename the
15-bone rig or change its bind transforms if amber will reuse the tracks. Review
the result, then deliberately replace `assets/`; generated-next is local-only.

The game currently adopts **death only** from these new reactions: an observed
alive→dead snapshot starts the clip, followed by a one-second visual hold, then
hides the corpse. Initial dead snapshots do not invent a death transition.
Respawn/restart discards the old pose. Simulation death, HUD, targeting and respawn
timing remain authoritative and do not wait for animation. Hurt and attack are
available source clips, **not yet driven by gameplay events**. The renderer does
not infer hits from HP deltas or cooldowns.
