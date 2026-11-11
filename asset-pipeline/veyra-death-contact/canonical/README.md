# Canonical Veyra death-contact trial

The existing complete Camera + Q/W combat trial consumes these two GLBs, rebuilt with Blender 4.3.2 through the original heroes build and UAL1 retarget recipe. This keeps the runtime candidate reproducible by the same editable pipeline as the shipped hero. Default, partial queries, quiet standards and capture standards still select the shipped heroes release. This is candidate-only source/CPU adoption, not a visual or default-release decision.

## Rebuild

From the repository root with Blender 4.3.2:

```sh
python asset-pipeline/veyra-death-contact/tools/baseline.py
blender -b --disable-autoexec --python-exit-code 1 --python asset-pipeline/heroes/veyra-release/tools/build.py -- --output-dir outputs/veyra-recipe-contact
blender -b --disable-autoexec --python-exit-code 1 --python asset-pipeline/heroes/veyra-release/tools/retarget.py -- --output-dir outputs/veyra-recipe-contact --death-contact
python asset-pipeline/veyra-death-contact/tests/check_contact.py --candidate-dir outputs/veyra-recipe-contact --tolerance 0.005
cmp outputs/veyra-recipe-contact/exported/veyra-teal.glb asset-pipeline/veyra-death-contact/canonical/exported/veyra-teal.glb
cmp outputs/veyra-recipe-contact/exported/veyra-rust.glb asset-pipeline/veyra-death-contact/canonical/exported/veyra-rust.glb
```

Both stages were actually run for both factions. `outputs/veyra-recipe-contact/source/` contains the rebuilt editable Blender sources and original UAL1 input; this directory is not shipped. The committed canonical package contains only the two consumer exports and their independent lock. Source inputs and recipe remain under `heroes/veyra-release/`, with the five-file original baseline verified before contact correction. Repeat the retarget command to confirm the correction does not accumulate; both exports remained byte-identical on the second run.

## Exact artifact contract

`manifest.json` pins the chosen paths, sizes and SHA-256 values. `src/render/veyra-contact-pin.ts` independently pins those same values and rejects manifest drift before loading. The actual downloader checks size and SHA-256, then gives those exact bytes to GLTFLoader. No runtime fallback or network rebuild is used. Changing either selected export requires an explicit manifest and runtime pin update plus renewed checks.

Compared with the original baseline, each GLB retains identical JSON/chunk layout and differs only in 55 bytes of the death Root Y keys. All 61 contact samples pass the 0.005 m tolerance; the final body still reaches -0.000182 m and the largest body clearance is 0.014602 m. This is not perfect contact or a claim about appearance.

The generated GLBs happen to be byte-identical to the older binary-patch `runtime-fallback` exports. Here they were obtained through the actual editable source recipe, not copied from fallback. A hash proves identity of bytes, not how they were made. The separate received Blender 5.2 source package stays unchanged; its real-consumer tests remain the reference for the corrected motion. `veyra-canonical-consumer.test.ts` checks canonical non-death tracks against the fixed original and all 15 bone world matrices against that accepted package at 61 death samples and a late frozen pose.

The original CC0 base and UAL1 licenses remain in the heroes source package. No new external material is introduced. Browser, visual, non-author play and death appearance acceptance are still required before any default adoption. Site v22 and content coverage 0/89 are unchanged.
