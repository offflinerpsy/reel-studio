import {readdir,readFile,lstat} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from './common.mjs';
import {inspectPublicContent} from './public-content.mjs';
// These are the intended public inputs, not a substitute for reviewing the exact Git tree.
const entries=['README.md','LICENSE','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md','package.json','.gitignore','.agents/plugins/marketplace.json','docs','.github','scripts','tests','packages','examples'];
const skip=new Set(['node_modules','dist','.git','.private','release']);
let count=0, files=0;
function check(name,data){files++;for(const label of inspectPublicContent(name,data)){console.error(`${name}: ${label}`);count++;}}
async function scan(path){let s;try{s=await lstat(path)}catch(e){if(e.code==='ENOENT')return;throw e;}const name=relative(root,path);if(s.isSymbolicLink()){console.error(`${name}: symlink excluded; inspect before publication`);count++;return;}if(s.isDirectory()){for(const e of await readdir(path)){if(!skip.has(e))await scan(join(path,e));}return;}if(s.isFile())check(name,await readFile(path));}
if(process.argv.includes('--staged')){const ls=spawnSync('git',['ls-files','--stage','-z'],{cwd:root});if(ls.status!==0)throw Error('Cannot inspect Git index; initialize the repository and stage the exact intended tree first.');for(const entry of ls.stdout.toString().split('\0').filter(Boolean)){const match=/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(entry);if(!match)throw Error('Unparseable index entry');const [,mode,hash,stage,name]=match;if(stage!=='0'||!['100644','100755'].includes(mode)){console.error(`${name}: unsupported staged mode or conflict`);count++;continue;}const blob=spawnSync('git',['cat-file','blob',hash],{cwd:root,maxBuffer:50*1024*1024});if(blob.status!==0)throw Error(`Cannot read staged blob: ${name}`);check(name,blob.stdout);}}else for(const entry of entries) await scan(join(root,entry));console.log(`Scanned ${files} files; ${count} finding(s).`);if(count)process.exitCode=1;
