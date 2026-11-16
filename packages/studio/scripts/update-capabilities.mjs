// Refresh BB's pinned contract from the actual public MCP server, without a CLI or provider request.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createStudio} from '../server/index.mjs';

const studio=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const home=await mkdtemp(join(realpathSync(tmpdir()),'reel-capabilities-'));
const app=await createStudio({home,env:{},paused:true,runtime:{close:async()=>{}}});
const client=new Client({name:'reel-capabilities',version:'1.0.0'});
try{
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 await app.server.connect(serverTransport);await client.connect(clientTransport);
 const {tools}=await client.listTools();
 const sourceFiles={};
 for(const file of ['server/index.mjs','server/store.mjs','server/settings.mjs','server/remote-config.mjs','server/mac-ui-relay.mjs','ui/media-transfer.mjs','server/claude-runtime.mjs','server/runtime-selection.mjs','server/connection-settings.mjs','server/setup-http.mjs','server/youtube-oauth.mjs','server/narration.mjs','server/dataforseo-direct.mjs','server/speech-providers.mjs'])sourceFiles[file.split('/').at(-1)]=createHash('sha256').update(await readFile(join(studio,file))).digest('hex');
 const {version:sourceVersion}=JSON.parse(await readFile(join(studio,'plugin.json'),'utf8'));
 const {version:sdkVersion}=JSON.parse(await readFile(join(studio,'node_modules/@modelcontextprotocol/sdk/package.json'),'utf8'));
 const schemas=Object.fromEntries(tools.map(t=>[t.name,t.inputSchema]));
 await writeFile(join(studio,'../bb/capabilities.json'),JSON.stringify({sourceVersion,sourceSha256:sourceFiles['index.mjs'],sdkVersion,sourceFiles,schemas},null,2)+'\n');
 console.log(`Updated BB contract for ${sourceVersion}: ${tools.length} MCP tools.`);
}finally{await client.close();await app.close();await rm(home,{recursive:true,force:true});}
