import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createStudio} from '../dist/server.mjs';

const home=await mkdtemp(join(tmpdir(),'reel33-schema-smoke-'));
let app,client;
try{
  app=await createStudio({home,runtime:{close:async()=>{}}});
  client=new Client({name:'reel-native33-schema-smoke',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();await app.server.connect(b);await client.connect(a);
  const catalog=await client.listTools(),info=await app.invoke('reel_runtime_info',{});
  const source=await readFile(new URL('../server/index.mjs',import.meta.url));
  const files=['index.mjs','store.mjs','production-lines.mjs','owner-authority.mjs','external-jobs.mjs','codex-runtime.mjs','research.mjs','speech-providers.mjs','runtime-adoption.mjs','request-reconciliation.mjs','maintenance-api.mjs','owner-host/authority-verifier.mjs','owner-host/host_probe.py','owner-host-loader.mjs'];
  const sourceFiles={};for(const name of files)sourceFiles[name]=createHash('sha256').update(await readFile(new URL('../server/'+name,import.meta.url))).digest('hex');
  const runtime=info.structuredContent.runtimeInfo;
  const result={sourceVersion:runtime.version,sourceSha256:createHash('sha256').update(source).digest('hex'),sdkVersion:'1.32.1',sourceFiles,
    schemas:Object.fromEntries(catalog.tools.map(t=>[t.name,t.inputSchema])),
    nativeBuild:{entrySHA256:runtime.loadedEntrySHA256,ownerProtocol:runtime.ownerProtocol,platform:runtime.platform},
    isolatedSmoke:{platform:runtime.platform,version:runtime.version,workspaceURI:runtime.workspaceURI,tools:catalog.tools.length,productionCalls:0},
  };
  await writeFile(process.argv[2]||new URL('../CAPABILITIES.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({sourceVersion:result.sourceVersion,nativeBuild:result.nativeBuild,isolatedSmoke:result.isolatedSmoke}));
}finally{await client?.close();await app?.close();await rm(home,{recursive:true,force:true});}
