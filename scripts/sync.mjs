import {readFile, mkdir, lstat, readdir} from 'node:fs/promises';
import {resolve, join, dirname, sep} from 'node:path';
import {root,version,digest,atomic} from './common.mjs';
const help=`Usage: npm run sync -- <plan|apply|import> --target PATH --adapter studio|bb
plan: report changes; apply: copy reviewed source files to target; import: copy target edits back only if the canonical file is unchanged since the last sync. Target must be dedicated to this adapter. No host reload.\n`;
const args=process.argv.slice(2); if(!args.length||args.includes('--help')) { console.log(help); process.exit(0); }
const [mode,...rest]=args; const get=k=>{const n=rest.indexOf(k);return n<0?null:rest[n+1]};
const targetArg=get('--target'), adapter=get('--adapter');
if(!['plan','apply','import'].includes(mode)||!targetArg||!['studio','bb'].includes(adapter)||rest.length!==4||new Set([rest[0],rest[2]]).size!==2||!rest.includes('--target')||!rest.includes('--adapter')) throw Error(help);
const target=resolve(targetArg), source=join(root,'packages',adapter), basePath=join(target,'.reel-studio-sync.json');
// Sync maintains editable source; runtime packaging is a separate allowlist.
const files=adapter==='studio'
 ? ['package.json','package-lock.json','plugin.json','mcp.json','THIRD_PARTY_LICENSES.txt']
 : ['package.json','package-lock.json','README.md','capabilities.json','app.tsx','server.ts','contract.ts','styles.css','tsconfig.json'];
const directories=adapter==='studio'?['.codex-plugin','assets','ui','server','scripts','tests','skills']:['src','tests'];
const excludedDirs=new Set(['node_modules','dist','.git','.private','.cache','release','coverage','renders']);
async function sourceTree(rel){for(const entry of await readdir(join(source,rel),{withFileTypes:true})){const name=entry.name,next=join(rel,name);if(excludedDirs.has(name)||name.startsWith('.')||/^(?:auth|credentials|secrets|tokens)(?:\.|$)/i.test(name))continue;if(entry.isSymbolicLink())throw Error(`Symlink not allowed: ${join(source,next)}`);if(entry.isDirectory())await sourceTree(next);else if(entry.isFile()&&/\.(?:mjs|js|ts|tsx|jsx|css|json|svg|md|txt|yaml|yml|py|sh|ttf|woff2)$/i.test(name))files.push(next);}}
for(const dir of directories)await sourceTree(dir);
files.sort();
const inside=(a,b)=>a===b||a.startsWith(b+sep);
if(inside(target,root)||inside(root,target)) throw Error('Target must not overlap this repository.');
// Disallow symlink components, including existing parent components and files.
async function safe(path){let p=resolve(path); for(;;){try{if((await lstat(p)).isSymbolicLink()) throw Error(`Symlink not allowed: ${p}`);}catch(e){if(e.code!=='ENOENT') throw e;}const parent=dirname(p);if(parent===p)break;p=parent;}}
await safe(target); await safe(basePath);
let base; try {base=JSON.parse(await readFile(basePath,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e; base=null;}
if(base && (base.version!==version||base.adapter!==adapter||typeof base.files!=='object'||Array.isArray(base.files))) throw Error('Target baseline does not match this adapter/version.');
if(base && Object.keys(base.files).some(file=>!files.includes(file))) throw Error('The tracked file set changed; reconcile removed files manually before continuing.');
if(mode==='import'&&!base) throw Error('Import requires a prior successful sync baseline.');
const steps=[], conflicts=[], snapshot={};
for(const file of files){const src=join(source,file),dest=join(target,file);await safe(src);await safe(dest);const s=await digest(src),d=await digest(dest),b=base?.files[file]??null; if(!s) throw Error(`Missing source file: ${src}`);snapshot[file]={s,d};
 if(mode==='import'){if(!b||!d){conflicts.push(`${file}: missing baseline or target`);continue;}if(s!==b&&d!==b){conflicts.push(`${file}: both source and target changed`);continue;}if(d!==b&&s===b) steps.push({file,from:dest,to:src});else if(s!==b&&d===b) conflicts.push(`${file}: source changed; apply first`);}
 else if(d!==s){if((!base&&d!==null)||(base&&d!==b)){conflicts.push(`${file}: target has untracked or changed content`);continue;} steps.push({file,from:src,to:dest});}}
for(const c of conflicts) console.error(`CONFLICT ${c}`);for(const s of steps) console.log(`${mode==='import'?'IMPORT':'COPY'} ${s.file}`);console.log(`${steps.length} change(s), ${conflicts.length} conflict(s)`);
if(conflicts.length) process.exit(2);if(mode==='plan') process.exit(0);
// Recheck the full preimage before the first write. No target deletions are performed.
for(const file of files){if(await digest(join(source,file))!==snapshot[file].s||await digest(join(target,file))!==snapshot[file].d) throw Error(`Changed during planning: ${file}`);}
await mkdir(target,{recursive:true});for(const step of steps) {const before=snapshot[step.file]; if(await digest(join(source,step.file))!==before.s||await digest(join(target,step.file))!==before.d) throw Error(`Changed during apply: ${step.file}; earlier files may already have been copied`); await atomic(step.to,await readFile(step.from));}
const state={};for(const file of files) state[file]=await digest(join(source,file));await atomic(basePath,JSON.stringify({version,adapter,files:state},null,2)+'\n');
