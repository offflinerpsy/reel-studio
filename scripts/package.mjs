import {readFile, copyFile, mkdir, mkdtemp, rm, rename, access} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {root,version,hash,walk,assertNoSymlink} from './common.mjs';
import {studio,bb} from './files.mjs';
import {copyBundleLicenses} from './bundle-licenses.mjs';
import {inspectPublicContent} from './public-content.mjs';
const out=join(root,'release',`reel-studio-${version}`);
try { await access(out); throw Error(`Output already exists: ${out}. Move or remove it explicitly after review.`); } catch(e) { if(e.code!=='ENOENT') throw e; }
await mkdir(dirname(out),{recursive:true});
const stage=await mkdtemp(join(dirname(out),'.reel-package-'));
try {
 const studioMeta=JSON.parse(await readFile(join(root,'packages/studio/plugin.json'))), codexMeta=JSON.parse(await readFile(join(root,'packages/studio/.codex-plugin/plugin.json'))), studioPkg=JSON.parse(await readFile(join(root,'packages/studio/package.json'))), bbPkg=JSON.parse(await readFile(join(root,'packages/bb/package.json'))), rootPkg=JSON.parse(await readFile(join(root,'package.json')));
 if([rootPkg.version,studioMeta.version,codexMeta.version,studioPkg.version,bbPkg.version].some(v=>v!==version)) throw Error(`Version mismatch: workspace=${rootPkg.version}, expected=${version}, studio manifest=${studioMeta.version}, Codex manifest=${codexMeta.version}, studio package=${studioPkg.version}, BB=${bbPkg.version}`);
 for(const name of ['studio','bb']) { const lock=JSON.parse(await readFile(join(root,'packages',name,'package-lock.json'))); if(lock.version!==version||lock.packages?.['']?.version!==version) throw Error(`Version mismatch in ${name} lockfile`); }
 for(const [name,files] of [['studio',studio],['bb',bb]]) for(const file of files) { const from=join(root,'packages',name,file),to=join(stage,name,file); await assertNoSymlink(from); await mkdir(dirname(to),{recursive:true}); await copyFile(from,to); }
 for(const skill of ['kinetic-promo-video','portfolio-showreel-video']) { const dir=join(root,'packages/studio/skills',skill); for(const file of await walk(dir)) { const from=join(dir,file),to=join(stage,'studio/skills',skill,file); await mkdir(dirname(to),{recursive:true}); await copyFile(from,to); } }
 await copyBundleLicenses(join(stage,'licenses'));
 for(const name of ['LICENSE','README.md','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md']) await copyFile(join(root,name),join(stage,name));
 // Keep the reviewed language navigation usable in the standalone archive.
 for(const name of ['README.ru.md','README.es.md','README.de.md','README.zh-CN.md']) {
  const from=join(root,name);await assertNoSymlink(from);
  try {await copyFile(from,join(stage,name));} catch(e) {if(e.code!=='ENOENT')throw e;}
 }
 for(const folder of ['docs','examples']) for(const file of await walk(join(root,folder))) {const to=join(stage,folder,file);await mkdir(dirname(to),{recursive:true});await copyFile(join(root,folder,file),to);}
 const marketplace={name:'reel-studio-community',plugins:[{name:'reel-studio',source:{source:'local',path:'./studio'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]};
 await mkdir(join(stage,'.agents/plugins'),{recursive:true});await (await import('node:fs/promises')).writeFile(join(stage,'.agents/plugins/marketplace.json'),JSON.stringify(marketplace,null,2)+'\n');
 const hits=[], entries=[];
 for(const file of await walk(stage)) { const data=await readFile(join(stage,file)); for(const label of inspectPublicContent(file,data))hits.push(`${file}: ${label}`); entries.push({path:file.split('\\').join('/'),sha256:hash(data)}); }
 if(hits.length) throw Error(`Release scan blocked:\n${hits.join('\n')}`);
 await (await import('node:fs/promises')).writeFile(join(stage,'MANIFEST.json'),JSON.stringify({version,files:entries.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
 await mkdir(dirname(out),{recursive:true}); await rename(stage,out); console.log(`Packaged ${out}`);
} finally { await rm(stage,{recursive:true,force:true}); }
