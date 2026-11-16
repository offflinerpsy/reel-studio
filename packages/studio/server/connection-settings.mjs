// This store protects owner secrets with filesystem permissions, not encryption or an OS keychain.
// Credential methods are backend-only. Never expose their return values as MCP results or snapshots.
import {openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,fstatSync,mkdirSync,chmodSync,fsyncSync,realpathSync,constants} from 'node:fs';
import {join,resolve,parse} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createYouTubeOAuth,readYouTubeChannel,validateYouTubeClient,youtubeJSON} from './youtube-oauth.mjs';

const SERVICES=['azure','dataforseo','telegram','youtube'];
const PROVIDERS={azure:'Azure Speech',dataforseo:'DataForSEO',telegram:'Telegram',youtube:'YouTube'};
const fail=code=>Object.assign(new Error('Connection settings could not be verified'),{code});
const text=(v,max=4096)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const chat=v=>typeof v==='string'&&/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(v);
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function service(id){if(!SERVICES.includes(id))throw fail('unknown_service');return id;}
function validate(id,input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('invalid_fields');
  const allowed={azure:['key','region'],dataforseo:['login','password'],telegram:['token','chatId'],youtube:['clientId','clientSecret']}[service(id)];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw fail('invalid_fields');
  if(id==='youtube')return validateYouTubeClient(input);
  if(id==='azure'&&text(input.key,512)&&/^[a-z][a-z0-9]{1,40}$/.test(input.region||''))return {key:input.key,region:input.region};
  if(id==='dataforseo'&&text(input.login,320)&&!input.login.includes(':')&&text(input.password,1024))return {login:input.login,password:input.password};
  if(id==='telegram'&&/^\d{1,20}:[A-Za-z0-9_-]{10,200}$/.test(input.token||'')&&chat(input.chatId))return {token:input.token,chatId:input.chatId};
  throw fail('invalid_fields');
}
function validateStored(id,input) {
  if(id!=='youtube')return validate(id,input);
  const {accessToken,refreshToken,expiresAt,channel,...client}=input||{};
  const checked=validateYouTubeClient(client);
  if(accessToken===undefined&&refreshToken===undefined&&expiresAt===undefined&&channel===undefined)return checked;
  if(!text(accessToken)||!text(refreshToken)||!Number.isFinite(expiresAt)||!/^UC[A-Za-z0-9_-]{22}$/.test(channel?.id||'')||typeof channel.title!=='string'||channel.title.length>200||Object.keys(channel).some(k=>!['id','title'].includes(k)))throw fail('invalid_private_store');
  return {...checked,accessToken,refreshToken,expiresAt,channel};
}
// Reject symlinks for every path component, including a symlinked injected home.
function assertPath(path) {
  let current=parse(path).root;
  for(const part of path.slice(current.length).split('/').filter(Boolean)) {
    current=join(current,part);let info;try{info=lstatSync(current);}catch(e){if(e.code==='ENOENT')continue;throw fail('private_store_unavailable');}
    // macOS exposes its root-owned temporary hierarchy through /var -> /private/var.
    // Permit that exact system alias only; injected home/private paths remain no-follow.
    if(info.isSymbolicLink()&&!(process.platform==='darwin'&&current==='/var'&&realpathSync(current)==='/private/var'))throw fail('private_store_symlink');
  }
}
function secureDirectory(dir){assertPath(dir);mkdirSync(dir,{recursive:true,mode:0o700});assertPath(dir);const info=lstatSync(dir);if(!info.isDirectory())throw fail('private_store_unavailable');chmodSync(dir,0o700);}
function readStore(file) {
  assertPath(file);let fd;
  try {fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const info=fstatSync(fd);if(!info.isFile()||info.size>65536)throw fail('invalid_private_store');
    const data=JSON.parse(readFileSync(fd,'utf8'));if(data.version!==1||!data.services||typeof data.services!=='object'||Array.isArray(data.services)||Object.keys(data.services).some(id=>!SERVICES.includes(id)))throw fail('invalid_private_store');
    for(const [id,input] of Object.entries(data.services))data.services[id]=validateStored(id,input);
    return data;
  }catch(e){if(e.code==='ENOENT')return {version:1,services:{}};throw fail(e.code==='private_store_symlink'?e.code:'invalid_private_store');}finally{if(fd!==undefined)closeSync(fd);}
}
function writeStore(dir,file,value) {
  secureDirectory(dir);assertPath(file);const data=JSON.stringify(value)+'\n';if(Buffer.byteLength(data)>65536)throw fail('private_store_too_large');
  const temp=join(dir,`.credentials-${randomUUID()}.tmp`);let fd;
  try {fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,data);fsyncSync(fd);closeSync(fd);fd=undefined;assertPath(file);renameSync(temp,file);chmodSync(file,0o600);}
  finally {if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch{}}
}
export function createConnectionSettings({home,env=process.env,fetchImpl=fetch,now=Date.now,azureCheck}={}) {
  if(typeof home!=='string'||resolve(home)!==home)throw fail('invalid_home');
  const dir=join(home,'private-connections'),file=join(dir,'credentials.json'),checks=new Map(),oauth=createYouTubeOAuth({fetchImpl,now});
  let revision=0;
  function credentials(id) {
    service(id);const saved=readStore(file).services[id];if(saved)return structuredClone(saved);
    let fallback;
    if(id==='azure'&&(env.AZURE_SPEECH_KEY||env.AZURE_COGNITIVE_SERVICES_KEY))fallback={key:env.AZURE_SPEECH_KEY||env.AZURE_COGNITIVE_SERVICES_KEY,region:env.AZURE_SPEECH_REGION||'swedencentral'};
    if(id==='dataforseo'&&(env.DATAFORSEO_LOGIN||env.DATAFORSEO_API_LOGIN))fallback={login:env.DATAFORSEO_LOGIN||env.DATAFORSEO_API_LOGIN,password:env.DATAFORSEO_PASSWORD||env.DATAFORSEO_API_PASSWORD};
    if(id==='telegram'&&env.REEL_TELEGRAM_BOT_TOKEN)fallback={token:env.REEL_TELEGRAM_BOT_TOKEN,chatId:env.REEL_TELEGRAM_CHAT_ID};
    if(!fallback)return null;try{return validate(id,fallback);}catch{return null;}
  }
  function status(id) {
    const c=credentials(id),saved=Boolean(readStore(file).services[id]);
    return {service:id,provider:PROVIDERS[id],present:Boolean(c),source:c?(saved?'private_file':'environment'):null,target:id==='telegram'?c?.chatId||'':id==='youtube'?c?.channel?.id||'':id==='azure'?c?.region||'':'',authorized:id==='youtube'?Boolean(c?.refreshToken&&c?.channel?.id):Boolean(c),check:checks.get(id)||{status:'not_checked',checkedAt:null,error:null}};
  }
  const readPublic=()=>({storage:'private_file_permissions',services:SERVICES.map(status)});
  function persist(id,value){const store=readStore(file);store.services[id]=value;writeStore(dir,file,store);revision++;checks.delete(id);}
  function save(id,input){service(id);persist(id,validate(id,input));return status(id);}
  function remove(id){service(id);const store=readStore(file);delete store.services[id];writeStore(dir,file,store);revision++;checks.delete(id);return status(id);}
  async function getYouTubeAccessToken() {
    let c=credentials('youtube');const expectedRevision=revision;
    if(!c?.refreshToken||!c.channel?.id)throw fail('authorization_required');
    if(!c.accessToken||c.expiresAt<=now()+60000)c={...c,...await oauth.refresh(c)};
    const channel=await readYouTubeChannel({accessToken:c.accessToken,fetchImpl});
    if(channel.id!==c.channel.id)throw fail('channel_mismatch');
    if(revision!==expectedRevision)throw fail('settings_changed');
    persist('youtube',{...c,channel});
    return {accessToken:c.accessToken,channel};
  }
  async function check(id) {
    service(id);const c=credentials(id),checkedAt=new Date(now()).toISOString();let detail={};
    try {
      if(!c)throw fail('not_configured');
      if(id==='azure') {
        if(azureCheck) {const result=await azureCheck(c);if(result?.configured===false||result?.ok===false)throw fail('provider_rejected');}
        else {const voices=await youtubeJSON(fetchImpl,`https://${c.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,{headers:{'Ocp-Apim-Subscription-Key':c.key}});if(!Array.isArray(voices)||!voices.length)throw fail('invalid_response');}
      }
      if(id==='dataforseo') {const data=await youtubeJSON(fetchImpl,'https://api.dataforseo.com/v3/appendix/user_data',{headers:{Authorization:`Basic ${Buffer.from(`${c.login}:${c.password}`).toString('base64')}`}});if(data.status_code!==20000||data.tasks_error||!data.tasks?.some(t=>t.status_code===20000))throw fail('provider_rejected');}
      if(id==='telegram') {
        const api=async(method,params={})=>{const u=new URL(`https://api.telegram.org/bot${c.token}/${method}`);u.search=new URLSearchParams(params);const d=await youtubeJSON(fetchImpl,u.href);if(d.ok!==true)throw fail('provider_rejected');return d.result;};
        const me=await api('getMe');if(!Number.isSafeInteger(me?.id)||me.is_bot!==true)throw fail('invalid_response');
        const target=await api('getChat',{chat_id:c.chatId});if(!Number.isSafeInteger(target?.id)||!['private','group','supergroup','channel'].includes(target.type))throw fail('invalid_response');
        if(/^-?\d+$/.test(c.chatId)&&String(target.id)!==c.chatId)throw fail('target_mismatch');
        if(c.chatId.startsWith('@')&&target.username?.toLowerCase()!==c.chatId.slice(1).toLowerCase())throw fail('target_mismatch');
        const member=await api('getChatMember',{chat_id:String(target.id),user_id:String(me.id)});
        const canPost=member?.status==='creator'||member?.status==='administrator'&&(target.type!=='channel'||member.can_post_messages===true)||target.type!=='channel'&&member?.status==='member'&&target.permissions?.can_send_messages!==false&&target.permissions?.can_send_videos!==false||target.type!=='channel'&&member?.status==='restricted'&&member.is_member===true&&member.can_send_messages===true&&member.can_send_videos===true;
        if(!canPost)throw fail('posting_permission_missing');
        detail={targetId:String(target.id),canPost:true};
      }
      if(id==='youtube'){const result=await getYouTubeAccessToken();detail={channelId:result.channel.id};}
      checks.set(id,{status:'verified',checkedAt,error:null,...detail});
    }catch(error){checks.set(id,{status:'failed',checkedAt,error:/^(http_\d+|not_configured|authorization_required|channel_mismatch|target_mismatch|posting_permission_missing|settings_changed)$/.test(error?.code||'')?error.code:'provider_check_failed'});}
    return status(id);
  }
  function startYouTubeOAuth({redirectURI}) {const client=credentials('youtube');if(!client)throw fail('not_configured');return oauth.start({client:validateYouTubeClient({clientId:client.clientId,...(client.clientSecret?{clientSecret:client.clientSecret}:{})}),redirectURI});}
  async function completeYouTubeOAuth(input) {const expectedRevision=revision,result=await oauth.complete(input),current=credentials('youtube');if(revision!==expectedRevision||current?.clientId!==result.clientId||current?.clientSecret!==result.clientSecret)throw fail('settings_changed');persist('youtube',result);checks.set('youtube',{status:'verified',checkedAt:new Date(now()).toISOString(),error:null,channelId:result.channel.id});return status('youtube');}
  function formHTML(id,{actionURL,oauthStartURL,notice=''}={}) {
    service(id);
    // Root supplies same-origin protected URLs. Do not accept arbitrary external form targets.
    for(const value of [actionURL,oauthStartURL].filter(Boolean)){let u;try{u=new URL(value,'http://127.0.0.1');}catch{throw fail('invalid_form_action');}if(!value.startsWith('/setup/')||value.startsWith('//')||u.origin!=='http://127.0.0.1'||/[\r\n]/.test(value))throw fail('invalid_form_action');}
    if(!actionURL)throw fail('invalid_form_action');
    const fields={azure:[['key','Speech subscription key','password'],['region','Azure region','text']],dataforseo:[['login','API login','text'],['password','API password','password']],telegram:[['token','Bot token','password'],['chatId','Exact chat ID or @channel','text']],youtube:[['clientId','Desktop OAuth client ID','text'],['clientSecret','Desktop client secret (optional)','password']]}[id];
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>${escape(PROVIDERS[id])} setup</title><style>body{font:16px system-ui;max-width:34rem;margin:3rem auto;padding:1rem;color:#182029}label{display:block;margin:1rem 0}input{display:block;box-sizing:border-box;width:100%;padding:.7rem;margin-top:.4rem}button,a{display:inline-block;margin:.5rem .5rem .5rem 0;padding:.7rem}small{display:block;line-height:1.6}</style><h1>${escape(PROVIDERS[id])} connection</h1><p>${escape(notice)}</p><form method="post" action="${escape(actionURL)}" autocomplete="off">${fields.map(([name,label,type])=>`<label>${escape(label)}<input name="${name}" type="${type}" maxlength="${name==='password'?1024:512}" ${name==='clientSecret'?'':'required'} autocomplete="off" spellcheck="false"></label>`).join('')}<button name="operation" value="save">Save connection</button></form>${id==='youtube'&&oauthStartURL?`<p><a href="${escape(oauthStartURL)}">Authorize your YouTube channel</a></p>`:''}<form method="post" action="${escape(actionURL)}"><button name="operation" value="check">Check connection</button><button name="operation" value="remove">Remove saved connection</button></form><small>Secrets stay on this Studio server in a private file protected by filesystem permissions (0700 directory, 0600 file). This is not encrypted storage or an OS keychain. Saved values are never filled back into this page. Existing environment credentials remain available after removing saved values. Checks read provider account and permission information; they do not publish or send a message.</small></html>`;
  }
  return {readPublic,credentials,save,remove,check,getYouTubeAccessToken,startYouTubeOAuth,completeYouTubeOAuth,formHTML};
}
