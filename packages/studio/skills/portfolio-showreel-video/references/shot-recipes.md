# Shot recipes

These are composable shots. Choose a useful sequence, not every recipe.

## Opening and website field

Place a concise promise above three partially cropped site panels. Stagger their vertical positions and give the group a slight diagonal. Start with visible content rather than a long blank entrance. Different inner pages may scroll subtly while the group travels. Screens can bleed; primary copy cannot.

For the perspective field, use 6–9 panels in a grid and a static stage with roughly 1200px perspective. The accepted portrait layout centers the camera field around x540/y1090. One world contains the panels with `transform-style: preserve-3d`. A single camera object holds x, y, z, rx and ry; one function writes `translate3d(...) rotateX(...) rotateY(...)`. Run it once at setup and start the first leg with `fromTo` for seeking.

A useful sequence is wide and tilted → lateral reposition → near-flat landing → short hold. At perspective1200, a starting z around−650 and landing near+110 produces a clear change of scale. These are starting poses, not a universal camera preset. Keep focal content away from the perspective plane; inspect the baked poses. Fade the headline before enlarged upper panels cross its zone.

## Scrolling website and responsive pair

Build the page from real HTML: small navigation, hero photo, exact headline and action, a lower content section, another image treatment and footer. A `.viewport` clips the `.page`; GSAP moves the page, while the browser frame stays fixed. Check both the initial and final content—scrolling must reveal enough to justify the movement.

Pair the desktop browser with a smaller phone that arrives after the viewer understands the page. A slight phone angle can contrast with a near-flat desktop. Keep the brand and hero consistent between devices. Avoid the phone covering the focal headline or action. The starter deliberately uses miniature UI as set dressing; visual review of it is still required.

## Brand system

Show one coherent identity across a wordmark panel, hero/campaign image, typography or color piece and optional phone. Enter pieces in different directions with one clear reading order. This should feel like one brand applied in several places, not unrelated tiles. Do not invent clients or metrics to make it credible.

## Search and AI-answer capability

Use only when relevant to the brief. Keep a large service heading (e.g. SEO or GEO) with a plain-language benefit. Below it, use a fictional search-result or answer interface with a small number of source cards. This can illustrate structured content and discovery; it must not pretend to prove a ranking, a platform recommendation or a result for the owner.

Author the UI as exact HTML. A search card can assemble query → result title → supporting links. An answer card can reveal a short answer and its source chips. Avoid a dense imitation of a real platform. Main benefit must be understandable without reading the miniature UI.

## Identity and ending

Use a supplied or accepted cutout, logo or clean name lockup. Preserve a real person's source image; do not generate a chain of replacement faces. In the approved portrait film, a one-line name let the face move higher without colliding with the service label.

Hold one final action for roughly two seconds or more, depending on copy. A small moving site strip can keep the frame alive, but the CTA itself should settle. Comments, website visits, booking and product trials are choices from the brief, choices for the current brief.
