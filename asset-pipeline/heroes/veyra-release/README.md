# Veyra · Botanical focus release

Veyra's 5.2 m basic attack uses a physical focus and an extended casting hand rather than a sword swinging at empty space. The two faction exports share one fifteen-bone contract; Morrow and all troops retain their adopted sources.

## Editable source and rebuild

`source/veyra-{teal,rust}.blend` contains the mesh, skin, materials and five actions. Run Blender 4.3 with `--background --disable-autoexec --python asset-pipeline/heroes/veyra-release/tools/build.py`, then the same command with `asset-pipeline/heroes/veyra-release/tools/retarget.py`, from the repository. The second step consumes the included original CC0 `source/UAL1_Standard.glb`. The recipe reads the adopted original `battle/source/hero-*.blend` and reuses its mesh helpers without writing the battle directory. Source hashes and exported GLB hashes are in `manifest.json`.

The original body, idle/walk/hurt/death curves and rig remain unchanged. The sword and shield islands are replaced by a short forked focus and a casting bracer; attack adopts UAL1 Enter → Shoot → Exit: preparation reaches an extended ready stance; the committed pulse and exit follow. The ready stance itself is not a hit or a resolve event. True `castStarted`/`castResolved` still determine cast phases. The instantaneous version-10 `basicAttack` begins at the release section, never inventing a preparation before damage. The optional release-time recoil layering is described below; death remains highest priority.

The focus was shortened after a whole-clip floor check found the first long shaft crossing the floor during death. The adopted body already has some foot penetration in that action; this export does not claim to remove that older defect.

## Source choice

- Owned CC0 base: [fixed adopted guard source](https://github.com/dbvv1/MOBA-Like/tree/a7d66054ae5885e38af43f88c4472a58cb765d89/asset-pipeline/battle/source). Derived source and exports retain CC0; repository generators remain original code.
- [Riot: Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) and the actual battle footage on [How to Play](https://www.leagueoflegends.com/en-us/how-to-play/) inform readable main poses, weapon silhouette and hierarchy, not asset copying or a universal timing rule.
- [Quaternius Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) was inspected from the official free download. Its Standard ZIP SHA-256 is `4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68`; the actual 43 clips do not include casting. Its overhand throw is not relabelled as a spell, and no downloaded Quaternius assets are shipped here.

- Selected for this author comparison: [UAL1 Standard](https://quaternius.itch.io/universal-animation-library), original package SHA-256 `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`. Its actual 43 clips include the three spell phases. The original GLB and license are included as offline rebuild inputs, not runtime downloads. The source-specific upper-body bake maps sides by bind-position signs, not suffixes: this owned rig's Right is UAL1's left. No source root or leg movement is copied. Source phase durations are resampled into the existing 13/5/17-frame visual contract; gameplay cast time/commit remains authoritative.

Normal-camera source comparisons are a selection aid. Actual battle review, not the number of clips or a close-up, decides adoption.

## Consumer author comparison

Only Veyra selects the definition-specific source and relative-torso recoil policy. During the already committed short release, ordinary HP recoil uses the existing hurt source relative to idle at 0.3 weight rather than replacing both arms. Real control and death remain higher priority. After the short release the ordinary hurt policy resumes; this is not stagger resistance or a damage change.

If drawing skipped the current committed action's main pose, the consumer can sample its 0.1-second release pose once on an actual draw, only within the existing strike+recovery lifetime. Sync alone does not confirm presentation. Control, death, cancellation, replacement and expiry discard this opportunity; no event queue or gameplay delay is introduced. Normal and 7/8-tick cadence counterexamples are author checks, not proof of visual quality.
