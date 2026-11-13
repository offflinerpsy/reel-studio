# Compact brief

Required: `title`, `language`, `bpm`, `palette`, `scenes`. Optional: `seed` (42), `background` (`tunnel`, `panels`, `rings`), `audio` (relative local file), `brief` (audience, purpose, facts/provenance), `fonts` (`auto`, `Anton`, `Manrope`). Duration is `sum(beats) * 60 / bpm`, 6–120 seconds. Match requested exact duration: 60 seconds at 120 BPM = 120 beats. The builder reports actual duration before rendering.

Palettes: `acid` (ink/ivory/lime/lavender), `cobalt` (navy/cream/blue/pale blue), `ember` (espresso/cream/orange/blush), `editorial` (black/paper/yellow/gray). Or dict with `ink`, `light`, `accent`, `soft`, each `#RRGGBB`.

Example scene:
```json
{"beats":8,"kind":"type","lines":["MAKE ROOM","FOR IDEAS."],"tone":"ink","motion":"slide","emphasis":1,"motif":"disc"}
```

- `beats`: 4–24; 8 beats at 120 BPM = 4 seconds. Leave a readable hold. A 20-second reel might have five 8-beat scenes; a minute might use varied 8/12-beat scenes. No mandatory count.
- `kind`: `type` (one to three giant lines), `stack` (three spaced arguments), `cutout` (one/two lines and illustration), `portrait` (one/two identity lines and tall photo), `cta` (one/two question lines and action card).
- `lines`: 1–3 nonempty strings; max 2 for cutout/portrait/cta. Prefer 1–4 words per line. No HTML. The builder checks glyphs and font advances; if a line can't fit at 78px, rewrite or split. Metrics don't replace pixel review.
- `tone`: `ink`, `light`, `accent`, `soft`. Vary purposefully; avoid repeated full-frame flashing.
- `motion`: `slide`, `slam`, `rise`, `hinge`. Deterministic beat-grid entrance followed by hold.
- `emphasis`: optional zero-based line index; accent used only when contrast passes.
- `motif`: `none` (default), `disc`, `bars`, `stamp`; background accents, not substitutes for required product imagery.
- `asset`: required for cutout/portrait, relative local path like `assets/coffee.png`. PNG/WebP/JPEG; transparent PNG preferred. No implicit downloads or generation; no traversal outside the project.
- `alt`: optional factual image description.
- `action`: required for cta, 1–2 short lines, e.g. `["BOOK A","STUDIO TOUR"]`. No invented price, URL or offer.

`fonts:auto` uses Anton if all glyphs exist, otherwise bundled Manrope (full Cyrillic). Unsupported scripts fail explicitly. For another script, use the custom-composition path and an appropriate licensed font; never deliver missing-glyph boxes.

Start from `assets/example-reel.json`, but rewrite its concept, structure and copy. Before building, decide what changes from first shot to last, which images would make abstract claims concrete, what the viewer should do, and whether it works muted.
