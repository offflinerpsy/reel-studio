import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm, symlink, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {studio,bb} from '../scripts/files.mjs';
import {version} from '../scripts/common.mjs';
import {inspectPublicContent} from '../scripts/public-content.mjs';

test('privacy rules reject concrete paths, common credential formats and instance dumps without echoing values',()=>{
 const rejected=[
  ['private path','/'+'Users'+'/someone/Documents/film.mp4'],
  ['private path','/'+'home'+'/someone/project'],
  ['private path','C:'+'\\Users\\someone\\video'],
  ['private path','C:'+'\\\\Users\\\\someone\\\\video'],
  ['credential','-----BEGIN '+'PRIVATE KEY-----'],
  ['credential','-----BEGIN '+'OPENSSH PRIVATE KEY-----'],
  ['credential','sk-'+'A'.repeat(30)],
  ['credential','ghp_'+'B'.repeat(35)],
  ['credential','github'+'_pat_'+'C'.repeat(50)],
  ['credential','AKIA'+'D'.repeat(16)],
  ['credential','AWS_SECRET_ACCESS_KEY='+'D'.repeat(40)],
  ['credential',JSON.stringify({apiKey:'D'.repeat(32)})],
  ['credential','AIza'+'E'.repeat(35)],
  ['credential','123456789'+':'+'F'.repeat(35)],
  ['private channel identifier','UC'+'A'.repeat(22)],
  ['private identifier','thr_'+'actualbinding123456'],
  ['private instance data',JSON.stringify({accounts:[{channel:'tiktok',account:'@private-person'}]})],
  ['private instance data',JSON.stringify({schema:4,revision:1,projects:[],accounts:[]})],
 ];
 for(const [label,value] of rejected){
  assert.ok(inspectPublicContent('examples/input.json',Buffer.from(value)).includes(label),label);
  assert.ok(inspectPublicContent('packages/studio/tests/input.test.mjs',Buffer.from(value)).includes(label),'test source has no blanket exemption: '+label);
 }
 assert.deepEqual(inspectPublicContent('docs/example.md',Buffer.from('Copyright Alex Yarosh; /Users/<username>/workspace; /home/<username>/workspace')),[]);
 assert.deepEqual(inspectPublicContent('packages/studio/tests/input.test.mjs',Buffer.from('thr_'+'fixture_privateid12345'+' UC'+'1234567890123456789012')),[]);
 assert.ok(inspectPublicContent('examples/input.txt',Buffer.from('thr_'+'fixture_privateid12345')).includes('private identifier'));
});

test('extracted runtime test helper allows only explicit synthetic identifiers',()=>{
 const helper='packages/studio/tests/runtime-adoption-fixtures.mjs';
 assert.deepEqual(inspectPublicContent(helper,Buffer.from('thr_'+'fixture_helper12345'+' proj_'+'fixture_helper12345'+' host_'+'fixture_helper12345')),[]);
 assert.ok(inspectPublicContent(helper,Buffer.from('thr_'+'actualbinding123456')).includes('private identifier'));
 assert.ok(inspectPublicContent(helper,Buffer.from('github'+'_pat_'+'G'.repeat(50))).includes('credential'));
 assert.ok(inspectPublicContent('packages/studio/tests/unreviewed-fixtures.mjs',Buffer.from('thr_'+'fixture_helper12345')).includes('private identifier'));
});

test('source and packaged privacy gates reject the same examples and do not promote rejected output',async()=>{
 const root=await fixture();
 try{
  await mkdir(join(root,'examples'),{recursive:true});const file=join(root,'examples','private.json');
  for(const [label,value] of [
   ['private path','/'+'home'+'/someone/private'],
   ['credential','github'+'_pat_'+'Q'.repeat(50)],
   ['private channel identifier','UC'+'Z'.repeat(22)],
   ['private instance data',JSON.stringify({connections:{youtube:{account:'@private-person'}}})],
  ]){
   await writeFile(file,value);const source=run(root,'scan-public.mjs'),packaged=run(root,'package.mjs');
   assert.equal(source.status,1,label);assert.match(source.stderr,new RegExp('examples/private.json: '+label));
   assert.notEqual(packaged.status,0,label);assert.match(packaged.stderr,new RegExp('examples/private.json: '+label));
   assert.ok(!source.stderr.includes(value));assert.ok(!packaged.stderr.includes(value));
   await assert.rejects(access(join(root,'release',`reel-studio-${version}`)));
  }
  await rm(file);const packaged=run(root,'package.mjs');assert.equal(packaged.status,0,packaged.stderr);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('only exact reviewed font paths and bytes pass in source and package layouts',async()=>{
 const path='studio/skills/kinetic-promo-video/assets/runtime/Manrope.ttf';
 const bytes=await readFile(join(src,'packages',path));
 assert.deepEqual(inspectPublicContent('packages/'+path,bytes),[]);
 assert.deepEqual(inspectPublicContent(path,bytes),[]);
 assert.deepEqual(inspectPublicContent('examples/Manrope.ttf',bytes),['unexpected binary']);
 assert.deepEqual(inspectPublicContent(path,Buffer.from([0,1,2,3])),['unexpected binary']);
});
const src=process.cwd();
async function fixture(){const root=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'reel-tool-test-'));await cp(join(src,'scripts'),join(root,'scripts'),{recursive:true});for(const [name,files] of [['studio',studio],['bb',bb]]) for(const f of files){const path=join(root,'packages',name,f);await mkdir(dirname(path),{recursive:true});await writeFile(path,'safe fixture\n');}for(const f of ['package.json','packages/studio/package.json','packages/studio/plugin.json','packages/studio/.codex-plugin/plugin.json','packages/bb/package.json']) await writeFile(join(root,f),JSON.stringify({version}));for(const name of ['studio','bb']){await mkdir(join(root,'packages',name,'tests'),{recursive:true});await writeFile(join(root,'packages',name,'package-lock.json'),JSON.stringify({version,packages:{'':{version}}}));}await mkdir(join(root,'packages/studio/ui'),{recursive:true});await writeFile(join(root,'packages/studio/ui/app.jsx'),'original UI');await writeFile(join(root,'packages/studio/server/store.mjs'),'original store');for(const s of ['kinetic-promo-video','portfolio-showreel-video']){const p=join(root,'packages/studio/skills',s,'SKILL.md');await mkdir(dirname(p),{recursive:true});await writeFile(p,'Safe example');}for(const dep of ['react','react-dom','lucide-react','@modelcontextprotocol/sdk','@modelcontextprotocol/ext-apps','@openai/mcp-extensions','zod','esbuild']){const p=join(root,'packages/studio/node_modules',dep,'LICENSE');await mkdir(dirname(p),{recursive:true});await writeFile(p,'Test license');}await writeFile(join(root,'README.md'),'Test');await writeFile(join(root,'LICENSE'),'MIT test');return root;}
function run(root,script,args=[]){if(script==='package.mjs'){const dir=join(root,'packages/studio/node_modules/esbuild');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'esbuild',version:'0.28.2',main:'index.cjs'}));writeFileSync(join(dir,'index.cjs'),'exports.build=async()=>({metafile:{inputs:{}}});');for(const file of ['CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md'])writeFileSync(join(root,file),'Safe fixture');for(const folder of ['docs','examples']){mkdirSync(join(root,folder),{recursive:true});writeFileSync(join(root,folder,'fixture.md'),'Safe fixture');}}return spawnSync(process.execPath,[join(root,'scripts',script),...args],{cwd:root,encoding:'utf8'});}
test('sync reports conflicts, preserves edits, and imports only a target-only change',async()=>{const root=await fixture(), target=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'reel-target-test-'));try{const args=['--target',target,'--adapter','bb'];const initial=run(root,'sync.mjs',['apply',...args]);assert.equal(initial.status,0,initial.stderr);const targetFile=join(target,'app.tsx'),sourceFile=join(root,'packages/bb/app.tsx');await writeFile(targetFile,'edited target');assert.equal(run(root,'sync.mjs',['apply',...args]).status,2);assert.equal(await readFile(targetFile,'utf8'),'edited target');assert.equal(run(root,'sync.mjs',['import',...args]).status,0);assert.equal(await readFile(sourceFile,'utf8'),'edited target');await writeFile(targetFile,'target again');await writeFile(sourceFile,'source again');assert.equal(run(root,'sync.mjs',['import',...args]).status,2);assert.equal(await readFile(sourceFile,'utf8'),'source again');}finally{await rm(root,{recursive:true,force:true});await rm(target,{recursive:true,force:true});}});
test('Studio sync transfers maintained UI and store source, blocks conflicts and symlinks',async()=>{const root=await fixture(),target=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'reel-studio-sync-')),outside=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'reel-outside-'));try{const args=['--target',target,'--adapter','studio'];assert.equal(run(root,'sync.mjs',['plan',...args]).status,0);await assert.rejects(access(join(target,'ui/app.jsx')));const first=run(root,'sync.mjs',['apply',...args]);assert.equal(first.status,0,first.stderr);assert.equal(await readFile(join(target,'ui/app.jsx'),'utf8'),'original UI');assert.equal(await readFile(join(target,'server/store.mjs'),'utf8'),'original store');await assert.rejects(access(join(target,'dist/server.mjs')));await assert.rejects(access(join(target,'node_modules')));await writeFile(join(target,'ui/app.jsx'),'edited UI');assert.equal(run(root,'sync.mjs',['import',...args]).status,0);assert.equal(await readFile(join(root,'packages/studio/ui/app.jsx'),'utf8'),'edited UI');await writeFile(join(target,'server/store.mjs'),'target store');await writeFile(join(root,'packages/studio/server/store.mjs'),'source store');assert.equal(run(root,'sync.mjs',['import',...args]).status,2);assert.equal(await readFile(join(root,'packages/studio/server/store.mjs'),'utf8'),'source store');assert.equal(await readFile(join(target,'server/store.mjs'),'utf8'),'target store');await rm(join(target,'ui'),{recursive:true});await symlink(outside,join(target,'ui'));assert.notEqual(run(root,'sync.mjs',['apply',...args]).status,0);await assert.rejects(access(join(outside,'app.jsx')));}finally{await rm(root,{recursive:true,force:true});await rm(target,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}});
test('package checks versions, excludes test files and blocks private material',async()=>{const root=await fixture();try{const testFile=join(root,'packages/bb/tests/private.test.mjs');await mkdir(dirname(testFile),{recursive:true});await writeFile(testFile,'private fixture');await writeFile(join(root,'packages/bb/package.json'),JSON.stringify({version:'0.1.0'}));assert.match(run(root,'package.mjs').stderr,/Version mismatch/);await writeFile(join(root,'packages/bb/package.json'),JSON.stringify({version}));await writeFile(join(root,'packages/bb/app.tsx'),'/'+'Users'+'/private-person/private');assert.match(run(root,'package.mjs').stderr,/Release scan blocked/);await writeFile(join(root,'packages/bb/app.tsx'),'safe');assert.equal(run(root,'package.mjs').status,0);const manifest=JSON.parse(await readFile(join(root,`release/reel-studio-${version}/MANIFEST.json`)));assert.ok(manifest.files.some(f=>f.path==='bb/app.tsx'));assert.ok(!manifest.files.some(f=>f.path.includes('tests/')));}finally{await rm(root,{recursive:true,force:true});}});
test('staged scan examines index blobs rather than edited worktree files',async()=>{const root=await fixture();try{assert.equal(spawnSync('git',['init','-q'],{cwd:root}).status,0);const secret='github'+'_pat_'+'A'.repeat(50);await writeFile(join(root,'outside-known-set.txt'),secret);assert.equal(spawnSync('git',['add','outside-known-set.txt'],{cwd:root}).status,0);await writeFile(join(root,'outside-known-set.txt'),'safe working copy');const result=run(root,'scan-public.mjs',['--staged']);assert.equal(result.status,1);assert.match(result.stderr,/outside-known-set.txt: credential/);assert.ok(!result.stderr.includes(secret));}finally{await rm(root,{recursive:true,force:true});}});
test('source scan includes examples',async()=>{const root=await fixture();try{await mkdir(join(root,'examples'),{recursive:true});await writeFile(join(root,'examples/example.json'),'/'+'Users'+'/private-person/private');const result=run(root,'scan-public.mjs');assert.equal(result.status,1);assert.match(result.stderr,/examples\/example.json: private path/);}finally{await rm(root,{recursive:true,force:true});}});
test('release registry matches source registry and points to packaged Studio',async()=>{const root=await fixture();try{const r=run(root,'package.mjs');assert.equal(r.status,0,r.stderr);const source=JSON.parse(await readFile(join(src,'.agents/plugins/marketplace.json'))),out=join(root,`release/reel-studio-${version}`),packaged=JSON.parse(await readFile(join(out,'.agents/plugins/marketplace.json')));assert.equal(source.plugins[0].source.path,'./packages/studio');assert.equal(packaged.plugins[0].source.path,'./studio');source.plugins[0].source.path='./studio';assert.deepEqual(packaged,source);await access(join(out,packaged.plugins[0].source.path,'plugin.json'));for(const p of ['README.md','CONTRIBUTING.md','docs/fixture.md','examples/fixture.md'])await access(join(out,p));const manifest=JSON.parse(await readFile(join(out,'MANIFEST.json')));assert.ok(manifest.files.some(f=>f.path==='.agents/plugins/marketplace.json'));}finally{await rm(root,{recursive:true,force:true});}});
test('Studio sync excludes common credentials and generated dependency directories',async()=>{const root=await fixture(),target=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'reel-sync-exclusions-'));try{const dir=join(root,'packages/studio/server');await writeFile(join(dir,'.env'),'not for sync');await writeFile(join(dir,'credentials.json'),'not for sync');await mkdir(join(dir,'node_modules'),{recursive:true});await writeFile(join(dir,'node_modules/dependency.js'),'not for sync');const result=run(root,'sync.mjs',['apply','--target',target,'--adapter','studio']);assert.equal(result.status,0,result.stderr);for(const path of ['server/.env','server/credentials.json','server/node_modules/dependency.js','dist/server.mjs'])await assert.rejects(access(join(target,path)));}finally{await rm(root,{recursive:true,force:true});await rm(target,{recursive:true,force:true});}});
