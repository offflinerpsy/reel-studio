import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root} from './common.mjs';
for(const [pkg,cmd] of [['studio','build'],['bb','typecheck']]) { const r=spawnSync('npm',['run',cmd],{cwd:join(root,'packages',pkg),stdio:'inherit'}); if(r.status!==0) process.exit(r.status ?? 1); }
