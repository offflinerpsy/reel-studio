# Verification and delivery

Use the generated project folder for these commands. Requirements are Node/npm, Python3, FFmpeg/ffprobe and the indicated Python dependencies. HyperFrames is pinned to0.8.36. Keep check, snapshot and render serial.

```sh
npm run build
npm run check
npx --yes hyperframes@0.8.36 snapshot . --at 1.8,5.8 --no-end --describe false
npm run render -- --output renders/final.mp4 --fps 30 --quality high --workers 1
uv run --with pillow python verify.py . renders/final.mp4
```

Choose snapshot timestamps from qa/build.json; the sample command is not valid for every brief. Inspect entrances, camera landings, scroll endpoints, identity and CTA. Keep a main heading from crossing another heading during a dive. Do not suppress a real collision to make check pass.

Canonical subcompositions use `#root`, not class-only root styling. The starter uses leaf overlap marks for tight headline line boxes and marks only miniature website/device/brand interiors as decorative. Those interiors still need pixel inspection; their axis-aligned boxes and sampled contrast during perspective motion are poor proxies for appearance. Don't extend the exemption to primary service copy, identity or CTA.

For original music, run `uv run --with numpy --with scipy --with soundfile python music.py .`, then set `audio` to `assets/score.wav` and rebuild. The renderer muxes source audio with AAC384k/PNSoff/MSoff and verifies that the encoded video stream is unchanged. Use a new output filename; accepted masters are preserved.

The verifier probes the actual file, fully decodes it, measures loudness/true peak, extracts every scene at phone size, builds a guide-overlay sheet and packages source with media. Check actual input_* loudness fields, not hypothetical normalized output_*. Metrics do not prove musical taste; listen through a supported route when available and report any unperformed listening review honestly.

For native phone review:

```sh
python3 review.py . --movie renders/final.mp4 --port 3033
```

Open the printed localhost URL in the existing browser profile. Review360×640 with the guide on/off, including the whole face and final action, and play a moving excerpt. Pause and close the owned tab and stop this server afterwards. Do not change global devices, browser profiles or personal tabs.

`qa/RECEIPT.json` initially says visual_review=pending. Record actual visual acceptance with the exact MP4 hash after viewing. The archive is renders/editable.zip. Before delivery, check ZIP CRC and that its extracted project reproduces the generated HTML. Include any newly authored source modules or images in verify.py's packaging list. Deliver MP4 plus editable source and update the existing handoff. A local render is not publication.
