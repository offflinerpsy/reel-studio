import {mkdtemp,cp,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {root,version} from './common.mjs';
const original=resolve(process.argv[2]||join(root,'release',`reel-studio-${version}`));
const tmp=await mkdtemp(join(tmpdir(),'reel-package-smoke-'));
try{
 await cp(join(original,'studio'),join(tmp,'studio'),{recursive:true});await cp(join(original,'bb'),join(tmp,'bb'),{recursive:true});
 await symlink(join(root,'packages/bb/node_modules'),join(tmp,'bb/node_modules'),'dir');
 for(const name of ['remote-config','owner-authority','codex-runtime','compute-router','mac-ui-relay']) await import(pathToFileURL(join(tmp,'studio/server',name+'.mjs')).href);
 const {createReelGateway}=await import(pathToFileURL(join(tmp,'bb/src/reel-gateway.mjs')).href);
 const env={...process.env,REEL_STUDIO_HOME:join(tmp,'data')};delete env.REEL_REMOTE_CONFIG;
 const gateway=createReelGateway({root:join(tmp,'studio'),env});
 try{const workspace=await gateway.workspace();if(workspace.version!==version||workspace.backendVersion!==version||!workspace.html.includes('<html'))throw Error('Packaged workspace response invalid');console.log(`Packaged Studio ${workspace.version}: BB validated actual tool catalog and loaded workspace.`);}finally{await gateway.dispose();}
}finally{await rm(tmp,{recursive:true,force:true});}
