import {lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root} from './common.mjs';
for(const pkg of ['studio','bb']) {
 const dir=join(root,'packages',pkg), modules=join(dir,'node_modules');
 try { if((await lstat(modules)).isSymbolicLink()) throw Error(`${modules} is a symlink. Preserve or move the link before setup; npm will not run against its target.`); } catch(e) { if(e.code!=='ENOENT') throw e; }
}
for(const pkg of ['studio','bb']) { const result=spawnSync('npm',['ci','--no-audit','--no-fund'],{cwd:join(root,'packages',pkg),stdio:'inherit'}); if(result.status!==0) process.exit(result.status ?? 1); }
