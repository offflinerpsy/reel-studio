# Portfolio showreel example

An editable fictional studio study. The starter reuses the original Portfolio Showreel builder's website-grid, camera, scrolling-page, responsive-device and brand-shot mechanics. Its three abstract SVGs are placeholder artwork, not client case studies or finished film media. Provenance does not establish which model authored the original.

From the repository root, create a project in a new empty directory:

```sh
python3 packages/studio/skills/portfolio-showreel-video/scripts/init_project.py /tmp/my-portfolio-showreel
cp examples/portfolio-showreel/reel.json /tmp/my-portfolio-showreel/reel.json
cd /tmp/my-portfolio-showreel
npm install --ignore-scripts
npm run prepare-runtime
npm run build
npm run check
```

Edit `reel.json`, the starter's `assets/images/*.svg`, or replace those files and update the paths. See the bundled skill for the full brief schema, rendering and visual review. Python 3, Node/npm and network access to npm are required; rendering additionally needs HyperFrames and FFmpeg. GSAP 3.14.2 is installed separately under its [Standard License](https://gsap.com/standard-license/), which has use restrictions. Manrope uses the SIL Open Font License, with its notice in `assets/runtime`. An example build does not establish aesthetic or publication readiness.
