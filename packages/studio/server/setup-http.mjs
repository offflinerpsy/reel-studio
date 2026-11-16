import {spawn} from 'node:child_process';
import {randomUUID,timingSafeEqual} from 'node:crypto';

const SERVICES=['azure','dataforseo','telegram','youtube','runtime'];
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const MAX_FORM=16384,MAX_OUTPUT=32768;
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fault=(status,message)=>Object.assign(new Error(message),{status});
// Same-origin preserves Chromium's exact Origin on native form POSTs. It still
// omits the capability-bearing Referer entirely when navigating to a provider.
function headers(res){res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");res.setHeader('Content-Type','text/html; charset=utf-8');}
function page(title,content,{refresh}={}) {return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh?'<meta http-equiv="refresh" content="3">':''}<title>${escape(title)}</title><style>body{font:16px system-ui;max-width:42rem;margin:3rem auto;padding:1rem;color:#182029;line-height:1.6}button,a{display:inline-block;margin:.5rem .5rem .5rem 0;padding:.65rem}code{overflow-wrap:anywhere}section{padding:1rem 0;border-top:1px solid #ddd}</style><h1>${escape(title)}</h1>${content}</html>`;}
function respond(res,status,html){res.statusCode=status;res.end(html);}
function hostOrigin(req) {
 const host=req.headers.host;
 if(typeof host!=='string'||! /^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.test(host)||Number(host.slice(host.lastIndexOf(':')+1))>65535)throw fault(403,'Use a loopback setup URL.');
 if(req.socket?.remoteAddress&&!LOOPBACK.has(req.socket.remoteAddress))throw fault(403,'Setup accepts loopback clients only.');
 const origin=`http://${host}`;
 if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw fault(403,'The setup request origin did not match.');
 return origin;
}
function authorized(req,url,token) {
 const query=url.searchParams.getAll('key'),provided=req.headers['x-reel-key']??(query.length===1?query[0]:null);
 if(typeof token!=='string'||!token||typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token))return false;
 return timingSafeEqual(Buffer.from(provided),Buffer.from(token));
}
async function form(req) {
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw fault(415,'Use the protected setup form.');
 if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>MAX_FORM)){req.resume?.();throw fault(413,'Setup form is too large.');}
 const body=await new Promise((resolve,reject)=>{
  let size=0,chunks=[];
  const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
  const error=()=>{cleanup();reject(fault(400,'Setup form was not received.'));},aborted=()=>error();
  const end=()=>{cleanup();resolve(Buffer.concat(chunks).toString('utf8'));};
  const data=chunk=>{size+=Buffer.byteLength(chunk);if(size>MAX_FORM){cleanup();chunks=[];req.resume?.();reject(fault(413,'Setup form is too large.'));return;}chunks.push(Buffer.from(chunk));};
  req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);
 });
 const fields=new URLSearchParams(body),result={};if([...fields].length>12)throw fault(400,'Setup form has too many fields.');
 for(const [key,value] of fields){if(Object.hasOwn(result,key)||!['operation','provider','key','region','login','password','token','chatId','clientId','clientSecret'].includes(key))throw fault(400,'Setup form fields were not accepted.');result[key]=value;}
 return result;
}
function officialDetails(output,provider) {
 const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),urls=[];
 for(const candidate of clean.match(/https:\/\/[^\s<>"']+/g)||[]){try{const u=new URL(candidate.replace(/[),.;]+$/,''));const allowed=provider==='codex'?u.hostname==='auth.openai.com'&&u.pathname==='/codex/device':['claude.ai','console.anthropic.com','platform.claude.com','auth.anthropic.com'].includes(u.hostname)&&/^\/oauth\/authorize\/?$/.test(u.pathname);if(allowed&&!u.username&&!u.password&&!u.port&&![...u.searchParams.keys()].some(k=>/(?:token|secret|password)/i.test(k)||k==='code')&&!urls.includes(u.href))urls.push(u.href);}catch{}}
 const deviceCode=provider==='codex'?clean.match(/(?:code[^\n]{0,100}[\n\s:]+)([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i)?.[1]||null:null;
 return {urls:urls.slice(0,2),deviceCode};
}
export function createSetupHTTP({connections,getRuntimeStatus,spawnImpl=spawn,loginTimeoutMs=600000}={}) {
 if(!connections)throw new TypeError('Connection backend is required');
 const jobs=new Map();let closed=false;
 function setupURL(service,address,token){if(!SERVICES.includes(service)||!Number.isInteger(address?.port)||address.port<1||address.port>65535||typeof token!=='string'||!token)throw new TypeError('Invalid setup URL parameters');return `http://127.0.0.1:${address.port}/setup/${service}?key=${encodeURIComponent(token)}`;}
 const action=(service,token)=>`/setup/${service}?key=${encodeURIComponent(token)}`;
 function stop(job,status) {if(job.status!=='running')return;job.status=status;clearTimeout(job.timer);try{job.child.kill('SIGTERM');}catch{}job.killTimer=setTimeout(()=>{if(!job.exited)try{job.child.kill('SIGKILL');}catch{}},2000);job.killTimer.unref?.();}
 function start(provider) {
  if(closed)throw fault(503,'Setup server is closing.');
  if(!['codex','claude'].includes(provider))throw fault(400,'Choose Codex or Claude.');
  if(jobs.get(provider)?.status==='running')return;
  const job={id:randomUUID(),provider,status:'running',output:'',bytes:0,exited:false};
  let child;try{child=spawnImpl(provider,provider==='codex'?['login','--device-auth']:['auth','login','--claudeai'],{stdio:['ignore','pipe','pipe'],windowsHide:true});}catch{throw fault(503,'The official CLI could not be started. Install it on this Studio server first.');}
  job.child=child;jobs.set(provider,job);
  const output=chunk=>{if(job.status!=='running')return;const data=Buffer.from(chunk);job.bytes+=data.length;if(job.bytes>MAX_OUTPUT){stop(job,'output_limit');return;}job.output+=data.toString('utf8');};
  child.stdout?.on('data',output);child.stderr?.on('data',output);
  const done=(code)=>{job.exited=true;clearTimeout(job.timer);clearTimeout(job.killTimer);if(job.status==='running')job.status=code===0?'completed':'failed';job.child=null;};
  child.once('error',()=>done(null));child.once('close',done);
  job.timer=setTimeout(()=>stop(job,'timed_out'),Math.max(10,Math.min(loginTimeoutMs,600000)));job.timer.unref?.();
 }
 async function runtimeHTML(token,notice='') {
  let statuses={};try{statuses=await getRuntimeStatus?.()||{};}catch{}
  const content=`<p>${escape(notice)}</p><p>Sign in using the official CLI on this Studio server. These buttons change only that CLI's authentication and do not select a model, start an inference request, or extract OAuth tokens.</p>`+['codex','claude'].map(provider=>{
   const job=jobs.get(provider),details=job?officialDetails(job.output,provider):{urls:[]},s=Array.isArray(statuses)?statuses.find(s=>s.id===provider||s.engine===provider):statuses[provider],availability=s?.availability||s;
   const auth=availability?.authenticated===true?'Signed in':availability?.authenticated===false?'Sign-in required':'Authentication has not been checked here';
   return `<section><h2>${provider==='codex'?'Codex':'Claude'}</h2><p>${auth}</p>${job?`<p>Official login process: ${escape(job.status)}. A completed process is checked separately by the runtime status above.</p>`:''}${details.urls.map(url=>`<p><a rel="noreferrer" target="_blank" href="${escape(url)}">Continue at ${escape(new URL(url).hostname)}</a></p>`).join('')}${details.deviceCode?`<p>Device code: <code>${escape(details.deviceCode)}</code></p>`:''}<form method="post" action="${escape(action('runtime',token))}"><input type="hidden" name="provider" value="${provider}"><button name="operation" value="login" ${job?.status==='running'?'disabled':''}>${provider==='codex'?'Start Codex device sign-in':'Start Claude subscription sign-in'}</button></form><p>${provider==='claude'?'The official Claude CLI may open the server browser after your click. For a remote server, use the official sign-in link shown here if one is provided.':'Codex shows an official verification link and one-time device code. Open it in your own browser.'}</p></section>`;
  }).join('');
  return page('Runtime sign-in',content,{refresh:[...jobs.values()].some(job=>job.status==='running')});
 }
 async function handle(req,res,{url,address,token}={}) {
  const raw=req.url||url?.pathname||'';
  if(!/^\/setup(?:\/|\?|$)/.test(raw))return false;
  headers(res);
  try {
   const origin=hostOrigin(req);if(raw.length>8192||!raw.startsWith('/'))throw fault(400,'Invalid setup request.');
   const requestURL=new URL(raw,origin),path=requestURL.pathname;
   if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');throw fault(405,'Setup method is not supported.');}
   if(path==='/setup/youtube/callback') {
    if(req.method!=='GET')throw fault(405,'OAuth callback requires GET.');
    if(requestURL.searchParams.getAll('state').length!==1||requestURL.searchParams.getAll('code').length!==1)throw fault(400,'YouTube authorization was not completed. Start it again from the protected setup page.');
    const redirectURI=`http://127.0.0.1:${new URL(origin).port}/setup/youtube/callback`;
    const result=await connections.completeYouTubeOAuth({state:requestURL.searchParams.get('state'),code:requestURL.searchParams.get('code'),redirectURI});
    respond(res,200,page('YouTube connected',`<p>Your channel <code>${escape(result.target)}</code> was verified. You can close this page and return to Studio.</p>`));return true;
   }
   if(!authorized(req,requestURL,token))throw fault(403,'Open setup from your current Studio panel.');
   if(path==='/setup/youtube/start') {
    if(req.method!=='GET')throw fault(405,'Open authorization from the setup page.');
    const redirectURI=`http://127.0.0.1:${new URL(origin).port}/setup/youtube/callback`,result=connections.startYouTubeOAuth({redirectURI});
    const target=new URL(result.authorizeURL);if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')throw fault(400,'The authorization URL was not accepted.');
    res.statusCode=302;res.setHeader('Location',target.href);res.end();return true;
   }
   const service=path==='/setup/runtime/status'?'runtime':path.match(/^\/setup\/([a-z]+)$/)?.[1];
   if(!SERVICES.includes(service))throw fault(404,'Setup page was not found.');
   let notice='';
   if(req.method==='POST') {
    // Browser forms always send Origin. Requiring it for writes blocks cross-site form navigation.
    if(req.headers.origin!==origin)throw fault(403,'The setup form origin did not match.');
    const input=await form(req),operation=input.operation;delete input.operation;
    if(service==='runtime') {if(operation!=='login'||Object.keys(input).some(k=>k!=='provider'))throw fault(400,'Use an official sign-in button.');start(input.provider);res.statusCode=303;res.setHeader('Location',action('runtime',token));res.end();return true;}
    else if(operation==='save'){connections.save(service,input);notice='Connection saved privately on this server. Check it below.';}
    else if(operation==='remove'&&Object.keys(input).length===0){connections.remove(service);notice='Saved connection removed. Existing environment credentials can still apply.';}
    else if(operation==='check'&&Object.keys(input).length===0){const result=await connections.check(service);notice=result.check.status==='verified'?'Connection and target verified. No content was sent.':`Connection check needs attention: ${result.check.error||'provider_check_failed'}.`;}
    else throw fault(400,'Setup operation was not accepted.');
   }
   if(service==='runtime')respond(res,200,await runtimeHTML(token,notice));
   else respond(res,200,connections.formHTML(service,{actionURL:action(service,token),oauthStartURL:`/setup/youtube/start?key=${encodeURIComponent(token)}`,notice}));
  } catch(error) {respond(res,error.status||400,page('Setup needs attention',`<p>${escape(error.status?error.message:'The connection could not be verified. Reopen the protected setup page and check the service details.')}</p>`));}
  return true;
 }
 async function close(){closed=true;for(const job of jobs.values()){stop(job,'cancelled');job.output='';}/* Only login processes started by this router are signalled. Existing CLI auth is preserved. */}
 return {handle,close,setupURL};
}
