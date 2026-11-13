---
name: portfolio-showreel-video
description: Create polished portfolio and service reels with website grids, camera fly-throughs, scrolling pages, responsive screens and brand identity. Use when the work itself should be the visual centerpiece; use kinetic-promo-video for primarily typographic promos.
metadata:
  version: "1.0.0"
---

# Portfolio Showreel Video

Show the work in motion. Build a sequence of original or supplied websites, products and brand pieces, then make the viewer understand whose work it is and what to do next. Use fictional or authorized source material and tailor each film to its brief.

## Make the film

Read the current brief and handoff. Infer routine creative choices from the supplied reference and materials. Default to 20–30 seconds, 1080×1920, 30 fps and music-led pacing when unspecified. Preserve explicit duration, language, identity and format. The starter supports portrait; adapt it deliberately for other formats.

1. Write a short progression: an opening promise, work in motion, relevant capability, identity and one action. Choose the shots the subject needs. SEO, GEO, a portrait, three websites and a comment CTA are optional. Use the local editorial skill when available for audience-facing copy.
2. Choose a visual system: one main typeface, restrained palette, coherent image direction and varied shot scale. Read [shot recipes](references/shot-recipes.md) for camera, scrolling, brand and search treatments.
3. Reuse supplied/accepted screenshots and brand assets when suitable. For invented website studies, generate separate hero photography through the installed image tool, then typeset exact UI locally. Record prompts and provenance. Do not use an image model to draw an entire legible website. Keep concept work distinct from actual client results.
4. Initialize with `python3 <skill>/scripts/init_project.py /absolute/new/project`. Read [the brief format](references/brief-format.md), replace `reel.json`, and copy images into `assets/images/`. Run `npm install --ignore-scripts` and `npm run prepare-runtime` in the initialized project, then `npm run build` to make deterministic HyperFrames scenes. The starter offers opening, grid, scrolling website, brand, optional identity and CTA shots. Author any additional scene in `build.py`; it is a starting kit, not a fixed eight-slide template.
5. Supply a licensed track or run `uv run --with numpy --with scipy --with soundfile python music.py .` for original synthesized music. Keep `audio` set to the local score. Run check, snapshots and render serially. Follow [verification](references/verification.md) through actual encoded phone review and delivery of MP4 plus editable source.

`<skill>` means this skill's directory. The initialized project includes local runtime and media helpers and does not depend on a private workspace. The bundled abstract SVGs are fictional placeholders; replace them with authorized media for the actual brief.

## Creative decisions that matter

- Let the screens carry the visual interest. Alternate a wide field, a decisive close-up and a readable hold. A four-second shot should have a visual event and somewhere to settle.
- A real page scroll reveals another section inside a fixed viewport. Moving a screenshot up the whole canvas is a different effect.
- Read at landings. Keep text the viewer must understand near-flat and held; flying miniature UI is texture. Move or fade the headline before the camera brings another heading underneath it.
- Maintain one camera state and transform writer. Put perspective on the static stage; do not flatten the 3D world with filters, opacity or clipping. Clip at the outer scene.
- At 1080×1920, start with primary copy inside x106–862/y290–1240. This is a conservative design guide, not a platform guarantee. Check the full face, including mouth/chin, and the final action in an encoded 360×640 view.
- Rewrite long copy before shrinking it. Keep opening and CTA prominent. Exact typography, palette and timing should fit the new subject rather than repeat the seed.

Preserve accepted masters and unrelated files. A reusable skill or reference does not authorize publishing, new purchases or transferring another client's identity. Update the existing task handoff with the exact final file and checks; a successful encode alone is not visual acceptance.

GSAP is installed separately at version 3.14.2. It is subject to the [GSAP Standard License](https://gsap.com/standard-license/), which has use restrictions; assess its terms for your application. The installed package is not covered by the license for this repository.
