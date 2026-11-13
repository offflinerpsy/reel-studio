# Known remedies

- Competing check/snapshot/render processes caused Chromium timeouts. Run serially; reconcile existing job before retry. No duplicate preview controllers.
- Sub-composition URLs/fonts resolve from project root: `assets/...`, not `../assets/...`. IDs start with letters. One paused registered timeline per composition; don't manually nest a paused child.
- Canvas/Three must draw from timeline time and `hf-seek`, not wall-clock RAF. Otherwise snapshots and renders disagree.
- An old animation-map helper lacked a runtime dependency. Use native full check plus encoded frames instead of retrying an unchanged helper failure or installing another framework.
- Music: `uv run --with numpy --with scipy --with soundfile`. Never persist a temporary uv interpreter path after its process exits.
- AAC once caused above-zero reconstructed peak despite a clean WAV. Measure decoded output. Tested remedy: 384 kbps, `-aac_pns 0 -aac_ms 0`, conservatively mastered WAV. Final metrics remain authoritative.
- macOS Documents evicted files to iCloud (`compressed,dataless`). Don't regenerate accepted media. Use supported FileManager download + NSFileCoordinator, then stage/deliver to verified local `~/Movies/<project>`. No global storage changes. Verify readback.
- A server lacking HTTP Range may seek a valid movie back to zero. Use native preview/Range server and encoded ffmpeg frames to distinguish server failure from file failure.

Lineage: reusable mechanics from an earlier private production; private media and project data are excluded. It does not claim universal artistic quality or measured token savings.
