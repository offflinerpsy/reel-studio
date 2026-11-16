import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {access,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,normalize,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import expected from '../capabilities.json' with {type:'json'};

export const VERSION=expected.sourceVersion;
export const REEL_ROOT=resolve(process.env.REEL_STUDIO_ROOT || join(dirname(fileURLToPath(import.meta.url)),'../../studio'));
export const MAX_INPUT_BYTES=15_000_000;
export const MAX_TOOL_BYTES=6*1024*1024;
export const UI_TOOLS=Object.freeze([
  'reel_open','reel_account_add','reel_account_archive','reel_account_verify_prepare',
  'reel_approve','reel_board','reel_browser_prepare','reel_cancel','reel_compute_check',
  'reel_compute_select','reel_create','reel_dispatch_record','reel_export','reel_generate',
  'reel_line_assign','reel_line_create','reel_line_reorder','reel_line_status',
  'reel_metadata','reel_models','reel_profile_assign','reel_profile_save','reel_project',
  'reel_publish','reel_reconcile','reel_release_plan','reel_release_plan_approve',
  'reel_release_plan_create','reel_release_plan_dispatch_prepare',
  'reel_release_plan_dispatch_record','reel_research_check','reel_speech_catalog',
  'reel_speech_sample','reel_state','reel_targets','reel_template','reel_upload',
  'reel_settings_read','reel_settings_save','reel_settings_export',
  'reel_setup_read','reel_setup_check','reel_setup_engine',
  'reel_narration_create','reel_narration_read','reel_narration_list','reel_narration_assign',
]);
const workerTools=Object.freeze(['reel_state','reel_publication_job','reel_release_plan','reel_connection_record','reel_publication_result','reel_release_plan_result']);
export const HOST_HANDOFF_TOOLS=new Set(['reel_browser_prepare','reel_dispatch_record','reel_account_verify_prepare','reel_release_plan_dispatch_prepare','reel_release_plan_dispatch_record']);
const uiAllowed=new Set(UI_TOOLS),workerAllowed=new Set(workerTools);
const normal=value=>Array.isArray(value)?value.map(normal):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>k!=='$schema').sort().map(k=>[k,normal(value[k])])):value;
export function verifyCapabilities(catalog,capabilities=expected){
 const tools=new Map(catalog.tools.map(tool=>[tool.name,tool]));
 for(const name of new Set([...UI_TOOLS,...workerTools])){
  const tool=tools.get(name), schema=capabilities.schemas[name];
  if(!tool||!schema||JSON.stringify(normal(tool.inputSchema))!==JSON.stringify(normal(schema)))throw new Error(`REEL_CAPABILITY_CHANGED:${name}`);
  const visibility=tool._meta?.ui?.visibility;
  if(UI_TOOLS.includes(name)&&!(visibility?.includes('app')||tool._meta?.ui?.resourceUri===`ui://reel-studio/workspace/${VERSION}`))throw new Error(`REEL_APP_CAPABILITY_MISSING:${name}`);
  if(workerTools.includes(name)&&!visibility?.includes('model'))throw new Error(`REEL_WORKER_CAPABILITY_MISSING:${name}`);
 }
}
const mediaId='(?:kinetic\\.(?:mp4|jpg)|portfolio\\.(?:mp4|jpg)|(?:preview-|poster-)?[a-f0-9-]{36}|speech-[a-f0-9]{32})';
const mediaInfo=new RegExp(`^reel-media-info://studio/${mediaId}$`);
const mediaChunk=new RegExp(`^reel-media-chunk://studio/${mediaId}/[a-f0-9]{64}/(?:0|[1-9][0-9]{0,4})$`);
export function validateMediaUri(uri){if(typeof uri!=='string'||uri.length>300||(!mediaInfo.test(uri)&&!mediaChunk.test(uri)))throw new Error('REEL_MEDIA_RESOURCE_NOT_ALLOWED');return uri;}
export function adaptWorkspace(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>2_097_152||!html.includes('<head>'))throw new Error('REEL_WORKSPACE_INVALID');
 const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
 return html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}
const execFile=promisify(execFileCallback);
export async function verifyNodeRuntime(command,options,run=execFile){
 let version;
 try{
  const {stdout}=await run(command,['--version'],{...options,encoding:'utf8',timeout:5000,maxBuffer:4096,windowsHide:true});
  version=stdout.trim();
 }catch{throw new Error('REEL_NODE_REQUIRED: Node.js 22 or newer could not start. Install node on PATH or set REEL_NODE_BIN to its absolute executable path.');}
 const match=/^v(\d+)\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.exec(version);
 if(!match||Number(match[1])<22)throw new Error('REEL_NODE_REQUIRED: Node.js 22 or newer is required. Install node on PATH or set REEL_NODE_BIN to its absolute executable path.');
}
async function verifySource(root,entrypoint,remoteConfigPath){
 const manifest=JSON.parse(await readFile(join(root,'plugin.json'),'utf8'));
 if(manifest.version!==VERSION)throw new Error('REEL_STUDIO_RELEASE_MISMATCH');
 await access(entrypoint);
 if(remoteConfigPath!==undefined){
  const {loadRemoteConfig}=await import(pathToFileURL(join(root,'server','remote-config.mjs')).href);
  loadRemoteConfig(remoteConfigPath);
 }
}
/** @param {unknown} _binding @returns {Promise<void>} */
async function rejectUnbound(_binding){throw new Error('REEL_HANDOFF_DESTINATION_REQUIRED');}
export function createReelGateway({root=REEL_ROOT,clientFactory=()=>new Client({name:'bb-reel-studio',version:VERSION}),transportFactory=options=>new StdioClientTransport(options),verifyInstalled=verifySource,verifyRuntime=verifyNodeRuntime,env=process.env,authorizeHandoff=rejectUnbound}={}){
 // Snapshot the chosen route and its environment together. Configuration
 // changes require reconnection; an explicit remote route never falls back.
 const remoteConfigured=Object.hasOwn(env,'REEL_REMOTE_CONFIG'),remoteConfigPath=env.REEL_REMOTE_CONFIG;
 const nodeConfigured=Object.hasOwn(env,'REEL_NODE_BIN'),nodeCommand=nodeConfigured?env.REEL_NODE_BIN:'node';
 const route=remoteConfigured?'ssh':'local',entrypoint=join(root,...(remoteConfigured?['server','mac-ui-relay.mjs']:['dist','server.mjs']));
 const launchEnv=Object.fromEntries(Object.entries(env).filter(([,value])=>typeof value==='string'));
 let client=null,transport=null,connection=null,disposed=false;
 async function ready(){
  if(disposed)throw new Error('REEL_GATEWAY_DISPOSED');
  if(connection)return connection;
  const pending=(async()=>{
   let nextClient,nextTransport;
   try{
    if(remoteConfigured&&(typeof remoteConfigPath!=='string'||!remoteConfigPath||!isAbsolute(remoteConfigPath)||normalize(remoteConfigPath)!==remoteConfigPath||remoteConfigPath.includes('\0')))throw new Error('REEL_REMOTE_CONFIG_INVALID: Set a normalized absolute JSON file path. No local fallback.');
    if(nodeConfigured&&(typeof nodeCommand!=='string'||!nodeCommand||!isAbsolute(nodeCommand)||normalize(nodeCommand)!==nodeCommand||nodeCommand.includes('\0')))throw new Error('REEL_NODE_BIN_INVALID: Set a normalized absolute Node.js executable path.');
    try{await verifyInstalled(root,entrypoint,remoteConfigured?remoteConfigPath:undefined);}
    catch(error){if(remoteConfigured)throw new Error('REEL_REMOTE_CONFIG_OR_INSTALLATION_INVALID: '+String(error?.message||error)+'. No local fallback.');throw error;}
    if(disposed)throw new Error('REEL_GATEWAY_DISPOSED');
    nextClient=clientFactory();
    const childEnv={...launchEnv};
    // The default public BB library is separate from any existing installation.
    childEnv.REEL_STUDIO_HOME ||= join(homedir(),'.local','share','reel-studio-bb');
    // A desktop host's execPath can be the BB app, even when it exposes Node
    // versions. Resolve a real Node runtime from the configured environment.
    await verifyRuntime(nodeCommand,{env:childEnv,cwd:root});
    if(disposed)throw new Error('REEL_GATEWAY_DISPOSED');
    nextTransport=transportFactory({command:nodeCommand,args:[entrypoint],cwd:root,env:childEnv,stderr:'pipe'});
    client=nextClient;transport=nextTransport;
    nextClient.onclose=()=>{if(client===nextClient){client=null;transport=null;connection=null;}};
    nextTransport.stderr?.resume();
    await nextClient.connect(nextTransport,{timeout:30000});
    if(disposed)throw new Error('REEL_GATEWAY_DISPOSED');
    if(nextClient.getServerVersion()?.version!==VERSION)throw new Error('REEL_STUDIO_RELEASE_MISMATCH');
    verifyCapabilities(await nextClient.listTools({}, {timeout:20000}));
    return nextClient;
   }catch(error){await nextTransport?.close().catch(()=>{});await nextClient?.close().catch(()=>{});if(client===nextClient){client=null;transport=null;}if(connection===pending)connection=null;throw error;}
  })();connection=pending;return connection;
 }
 async function request(input,permitted){
  if(!input||!permitted.has(input.name))throw new Error('REEL_TOOL_NOT_ALLOWED');
  if(Buffer.byteLength(JSON.stringify(input.arguments??{}))>MAX_INPUT_BYTES)throw new Error('REEL_INPUT_TOO_LARGE');
  const c=await ready();if(disposed)throw new Error('REEL_GATEWAY_DISPOSED');
  const result=await c.callTool({name:input.name,arguments:input.arguments??{}},undefined,{timeout:120000});
  if(Buffer.byteLength(JSON.stringify(result))>MAX_TOOL_BYTES)throw new Error('REEL_RESULT_TOO_LARGE_DO_NOT_REPEAT_ACTION');
  return result;
 }
 return {
  async workspace(){const c=await ready(),uri=`ui://reel-studio/workspace/${VERSION}`,result=await c.readResource({uri},{timeout:20000});const item=result.contents.find(x=>x.uri===uri&&typeof x.text==='string');if(!item)throw new Error('REEL_WORKSPACE_RESOURCE_MISSING');return {html:adaptWorkspace(item.text),version:VERSION,backendVersion:VERSION,route};},
  async call(input){if(HOST_HANDOFF_TOOLS.has(input?.name))await authorizeHandoff(input.binding);if(input?.name==='reel_generate'){const project=await request({name:'reel_project',arguments:{projectId:input.arguments?.projectId}},uiAllowed);if(project.isError||!project.structuredContent?.project)throw new Error('REEL_PROJECT_READ_REQUIRED');if(project.structuredContent.project.productionLineId)throw new Error('REEL_ASSIGNED_DIRECTION_USE_EXISTING_PRODUCER');}return request(input,uiAllowed);},
  async handoffCapabilities(){await ready();},
  async handoffCall(input){return request(input,workerAllowed);},
  async media(uri){validateMediaUri(uri);const c=await ready(),result=await c.readResource({uri},{timeout:30000});if(result.contents.length!==1||result.contents[0].uri!==uri)throw new Error('REEL_MEDIA_INVALID_RESPONSE');const item=result.contents[0];if(mediaInfo.test(uri)){if(typeof item.text!=='string'||Buffer.byteLength(item.text)>4096)throw new Error('REEL_MEDIA_MANIFEST_TOO_LARGE');return {contents:[{uri,mimeType:'application/json',text:item.text}]};}const allowedMime=['video/mp4','image/jpeg','image/png','image/webp'].includes(item.mimeType)||item.mimeType==='audio/wav'&&/^reel-media-chunk:\/\/studio\/speech-[a-f0-9]{32}\//.test(uri);if(typeof item.blob!=='string'||item.blob.length>16384||!allowedMime)throw new Error('REEL_MEDIA_CHUNK_INVALID');return {contents:[{uri,mimeType:item.mimeType,blob:item.blob}]};},
  async dispose(){disposed=true;await transport?.close().catch(()=>{});await client?.close().catch(()=>{});},
 };
}
