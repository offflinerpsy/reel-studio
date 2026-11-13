---
name: kinetic-promo-video
description: Build original portrait social promos from a topic or brief using large kinetic typography, beat-synced motion, dimensional backgrounds, optional paper cutouts and music. Includes a reusable HyperFrames builder and checks; use for motion-led Reels/TikTok promos, not avatar explainers or website walkthroughs.
metadata:
  version: "1.0.0"
---

# Kinetic Promo Video

Turn the topic into a finished motion reel. Reuse mechanics, invent the argument and visual metaphor. The source mechanics were adapted from an earlier private production; its personal assets and content are not included.

## Fast path

Read current project instructions/handoff. Extract topic, audience, desired action, language, duration, facts and supplied media. Fill obvious gaps rather than interviewing the user again. With no format specified, use 1080×1920, 30 fps, 120 BPM, music-led, 20–30 seconds. Preserve explicit choices. The bundled renderer supports portrait 1080×1920; other formats or narration require a considered adaptation through the installed HyperFrames workflow.

1. Read [the brief/schema](references/brief-schema.md). Write one compact `reel.json`: one argument per beat, a strong opening, a useful progression and one final action. Choose a distinct palette, motion rhythm and motif. Use the required local editorial skill for copy; don't invent metrics, testimonials or endorsements.
2. Run `python3 <skill>/scripts/build.py init /absolute/new/project`. Put `reel.json` there, then run `npm install --ignore-scripts` and `npm run prepare-runtime` inside the project, followed by `python3 <project>/build.py <project>`. The generator handles sizing, glyph checks, social margins, scene timelines and background depth. It fails on unsupported or unreadable copy instead of silently shrinking it. Init requires an empty folder; rebuild touches only generated files tracked in its manifest.
3. When illustrations help, read [cutouts](references/cutouts.md), then use the current image tool/skill. Generate separate transparent assets; preserve supplied faces. Store them in the project, set each scene's `asset`, and rebuild. The minimal sample is a technical example, not permission to replace requested imagery with shapes.
4. For original synthesized deep house, run `uv run --with numpy --with scipy --with soundfile python <project>/music.py <project>`. Set `audio` to `assets/score.wav` and rebuild. Duration, tempo and deterministic seed vary from the brief. A supplied/licensed track may be copied instead. Retain provenance. Don't claim to have heard audio when the runtime cannot listen.
5. Run `npm run check` in the project. Inspect representative snapshots, entrances and CTA. Render serially: `npm run render -- --output renders/final.mp4 --fps 30 --quality high --workers 1`. Then `python3 <project>/verify.py <project> renders/final.mp4`. See [verification](references/verification.md) for the visual/delivery pass.
6. Deliver the MP4 plus editable archive from verification. Review encoded phone frames and a moving excerpt in the native browser; a script pass does not certify aesthetics. Record review and audio limitations in the existing handoff. Publication remains a separate requested action.

`<skill>` is this file's directory, not a literal shell token. Scripts have `--help`. Generated projects contain the builder, music generator, verifier and runtime assets; they do not depend on a private workspace.

## Art direction that transfers

- One focal idea per scene; fewer, larger words. Vary scale and rhythm according to meaning. Let key words settle. Don't make every scene the same slide with a different sentence.
- Use 3–6 second beats as a starting point, not a law. Budget a clear opening and held ending. Rewrite or split long phrases instead of shrinking them.
- Put depth behind the argument. A family of paper cutouts can carry concrete product detail. Exact words belong in local typography, not generated image text.
- Default copy area: x106–862 / y290–1240 on 1080×1920. This is a conservative guardrail, not a universal platform guarantee. Decorative edges may bleed; faces, meaning and CTA must survive phone-size overlay review.
- Arrows and metallic ornaments were rejected in the seed film. That's not a universal ban, but don't add decorative filler just because it can animate. Match the new brief.

## Economical execution and revisions

The main model keeps story/art direction and final acceptance. A smaller capable agent can fill the brief and run scripts. Don't start extra planners/designers/reviewers by default, change the selected model, or promise measured savings without measurements.

Usually read only this file and the schema; load other references when needed. Reuse accepted media and runtime. One full check after the final meaningful edit; expand only for real failures. Run check, snapshot and render **serially**. Don't regenerate a film to fix one scene.

The builder is a starting system, not a creative ceiling. For bespoke motion, work in a versioned copy and follow installed HyperFrames core/animation guidance. Don't patch generated HTML and then overwrite it with a rebuild. Read [troubleshooting](references/troubleshooting.md) only for an actual problem.

Improve this skill from concrete accepted changes: isolate a reusable fix, test it against the example and one different brief, then update the relevant script/reference. Don't accumulate entire conversations, client assets or one-off exceptions. Skill updates require the user's request; routine use doesn't silently change global instructions.

GSAP is installed separately at version 3.14.2. It is subject to the [GSAP Standard License](https://gsap.com/standard-license/), which has use restrictions; assess its terms for your application. The installed package is not covered by the license for this repository.
