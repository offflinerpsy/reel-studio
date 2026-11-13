# Kinetic promo example

An editable fictional typography promo. It reuses the original Kinetic Promo builder's beat-based scene timing, typographic entrances, Three.js background and generated-file protection. The copy is a generic study. No personal film or media is included. Provenance does not establish which model authored the original.

From the repository root, create a project in a new empty directory:

```sh
python3 packages/studio/skills/kinetic-promo-video/scripts/build.py init /tmp/my-kinetic-promo
cp examples/kinetic-promo/reel.json /tmp/my-kinetic-promo/reel.json
cd /tmp/my-kinetic-promo
npm install --ignore-scripts
npm run prepare-runtime
python3 build.py .
npm run check
```

Edit `reel.json`, then rebuild. See the bundled skill for schema, rendering and visual review. Python 3, Node/npm and network access to npm are required; rendering additionally needs HyperFrames and FFmpeg. GSAP 3.14.2 is installed separately under its [Standard License](https://gsap.com/standard-license/), which has use restrictions. Three.js is MIT; bundled fonts use the SIL Open Font License, with notices in `assets/runtime`. An example build does not establish aesthetic or publication readiness.
