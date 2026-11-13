#!/usr/bin/env python3
"""Copy the portable showreel starter into a new empty project."""
import argparse,shutil
from pathlib import Path
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',type=Path);a=ap.parse_args()
p=a.project.expanduser().resolve()
if p.exists() and any(p.iterdir()):ap.error('Choose an empty folder; existing work is preserved.')
source=Path(__file__).resolve().parents[1]/'assets/starter'
shutil.copytree(source,p,dirs_exist_ok=True)
(p/'assets/images').mkdir(exist_ok=True);(p/'qa').mkdir(exist_ok=True);(p/'renders').mkdir(exist_ok=True)
print(f'Initialized {p}. Edit reel.json and replace the fictional placeholder artwork for your brief. Install dependencies and run npm run prepare-runtime before previewing.')
