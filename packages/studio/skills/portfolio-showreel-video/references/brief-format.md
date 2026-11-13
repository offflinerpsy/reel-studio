# Brief and starter

The starter is a portable editing base, not a promise that every brief fits without art direction. Replace its fictional names, copy and media paths. Do not deliver the example unchanged.

`reel.json` contains title, language, bpm (90–140), seed, a four-color palette (ink/light/accent/soft), sites and scenes. Optional audio is a project-relative file path. Copy actual images into the project; URLs, symlinks and outside-project paths are not portable.

Each site needs a unique lowercase `id`, `name`, `hero`, `eyebrow`, headline lines, `cta`, section_title lines and section_copy. Style can be editorial, serene or bold; edit website.css for another direction. Optional nav is a list of navigation labels; address defaults to the reserved `.example` domain. Hero supports PNG/JPEG/WebP/SVG. The bundled abstract SVGs are fictional placeholders; replace them when the brief requires specific imagery.

Each scene needs kind, beats, lines and optional tone (one of the palette keys). One beat is60/bpmseconds. The total and every boundary must align to30fps frames. Optional support is a short secondary line; rewrite if it collides with the main title.

| Kind | Additional fields | Purpose |
|---|---|---|
| opening | support optional | Three moving site strips under the opening copy |
| grid | support optional | Wide tilted grid, camera landing, headline exit |
| scroll | site ID; phone defaults true; scroll defaults525px | Real page scroll and optional responsive pair |
| brand | site ID | Wordmark, image, color/type piece and phone |
| identity | asset path, optional alt/support | Supplied cutout or transparent identity image |
| cta | action1–2lines; optional signature | Held action and moving footer strip |

Choose a different sequence, shorten it or add a custom kind in build.py. Search/answer panels are optional bespoke shots described in shot-recipes.md. For a portrait identity, prefer a one-line name and inspect the actual face position; the helper cannot infer facial landmarks. If using two lines, explicitly move the service label and media to avoid collisions. Main line sizing uses bundled font metrics and refuses overly long copy instead of silently shrinking it below90px.

The starter's default example totals26seconds. A30second brief is60beats at120BPM. A12second test can use20beats at100BPM. Changing the brief changes music duration/tempo/seed when regenerated; it does not rewrite the artistic composition for you.
