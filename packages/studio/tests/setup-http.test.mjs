import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {EventEmitter} from 'node:events';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSetupHTTP} from '../server/setup-http.mjs';
import {createConnectionSettings} from '../server/connection-settings.mjs';

async function fixture(t,{connections,spawnImpl,getRuntimeStatus,loginTimeoutMs}={}) {
 const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-setup-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const connection=connections||createConnectionSettings({home,env:{},fetchImpl:async()=>{throw new Error('No real provider fetch in router tests');}});
 const router=createSetupHTTP({connections:connection,spawnImpl,getRuntimeStatus,loginTimeoutMs});
 const token='test-instance-protected-key',server=createServer(async(req,res)=>{if(!await router.handle(req,res,{url:new URL(req.url,'http://127.0.0.1'),address:server.address(),token})){res.statusCode=404;res.end('other route');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await router.close();await new Promise(resolve=>server.close(resolve));});
 const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
 return {router,connections:connection,token,address,origin,url:service=>router.setupURL(service,address,token)};
}
const body=input=>new URLSearchParams(input);
const post=(url,input,origin,extra={})=>fetch(url,{method:'POST',headers:{Origin:origin,...extra},body:body(input)});
const rawGet=(url,headers={})=>new Promise((resolve,reject)=>{const req=request(url,{headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key.toLowerCase()]??null},text:async()=>Buffer.concat(chunks).toString('utf8')}));});req.on('error',reject);req.end();});
function fakeChild(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kills=[];child.kill=signal=>{child.kills.push(signal);queueMicrotask(()=>child.emit('close',null));return true;};return child;}

test('setup requires per-instance key, exact loopback host/origin, and security headers',async t=>{
 const f=await fixture(t),url=f.url('azure');
 assert.equal((await fetch(`${f.origin}/setup/azure`)).status,403);
 assert.equal((await fetch(url.replace(f.token,'wrong'))).status,403);
 assert.equal((await rawGet(url,{Host:'evil.example:1234'})).status,403);
 assert.equal((await fetch(url,{headers:{Origin:'https://evil.example'}})).status,403);
 const response=await fetch(url);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('referrer-policy'),'same-origin');assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.match(response.headers.get('content-security-policy'),/form-action 'self'/);assert.match(await response.text(),/<meta name="referrer" content="same-origin">/);
 assert.equal((await fetch(`${f.origin}/setup/azure`,{headers:{'x-reel-key':f.token}})).status,200);
 assert.equal((await fetch(`${f.origin}/setup/azure?key=${f.token}&key=${f.token}`)).status,403);
 assert.equal((await fetch(url,{method:'PUT'})).status,405);
 assert.equal((await fetch(`${f.origin}/outside`)).status,404);
});
test('browser form writes secrets directly, returns none, and rejects unsafe media/large/duplicate inputs',async t=>{
 const f=await fixture(t),secret='private-owner-azure-key',url=f.url('azure');
 assert.equal((await post(url,{operation:'save',key:secret,region:'eastus'},'https://evil.example')).status,403);
 assert.equal((await post(url,{operation:'save',key:secret,region:'eastus'},'null')).status,403);
 assert.equal((await fetch(url,{method:'POST',body:body({operation:'save',key:secret,region:'eastus'})})).status,403);
 const response=await post(url,{operation:'save',key:secret,region:'eastus'},f.origin),html=await response.text();assert.equal(response.status,200);assert.equal(html.includes(secret),false);assert.equal(f.connections.credentials('azure').key,secret);assert.match(html,/Connection saved privately/);
 assert.equal((await fetch(url,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({operation:'save',key:secret})})).status,415);
 assert.equal((await post(url,{operation:'save',key:'x'.repeat(17000),region:'eastus'},f.origin)).status,413);
 assert.equal((await fetch(url,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/x-www-form-urlencoded'},body:'operation=save&key=one&key=two&region=eastus'})).status,400);
 const invalid=await post(url,{operation:'save',key:secret,region:'https://evil.example'},f.origin);assert.equal(invalid.status,400);assert.equal((await invalid.text()).includes(secret),false);
 assert.equal((await post(url,{operation:'remove'},f.origin)).status,200);assert.equal(f.connections.credentials('azure'),null);
});
test('same-origin SSH forwarded browser port is accepted and drives exact OAuth loopback callback',async t=>{
 let started,completed;
 const f=await fixture(t,{connections:{formHTML:()=>'<p>protected</p>',startYouTubeOAuth:input=>{started=input;return {authorizeURL:'https://accounts.google.com/o/oauth2/v2/auth?state=opaque-state'};},completeYouTubeOAuth:async input=>{completed=input;return {target:'UC'+'a'.repeat(22)};}}});
 const forwardedHost='127.0.0.1:54321',forwardedOrigin=`http://${forwardedHost}`;
 const start=await rawGet(`${f.origin}/setup/youtube/start?key=${f.token}`,{Host:forwardedHost,Origin:forwardedOrigin});assert.equal(start.status,302);assert.equal(start.headers.get('location'),'https://accounts.google.com/o/oauth2/v2/auth?state=opaque-state');assert.equal(started.redirectURI,'http://127.0.0.1:54321/setup/youtube/callback');
 const callback=await rawGet(`${f.origin}/setup/youtube/callback?state=opaque-state&code=private-code`,{Host:forwardedHost});assert.equal(callback.status,200);assert.equal(completed.redirectURI,started.redirectURI);assert.equal(completed.code,'private-code');const html=await callback.text();assert.equal(html.includes('private-code'),false);assert.match(html,/YouTube connected/);
 assert.equal((await rawGet(`${f.origin}/setup/youtube/callback?state=opaque-state&error=access_denied`,{Host:forwardedHost})).status,400);
 assert.equal((await rawGet(`${f.origin}/setup/youtube/start`,{Host:forwardedHost})).status,403);
});
test('real backend OAuth callback state is required without setup key and replay is rejected',async t=>{
 let calls=0;const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-oauth-router-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const c=createConnectionSettings({home,env:{},fetchImpl:async url=>{calls++;return new Response(JSON.stringify(url.includes('/token')?{access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,token_type:'Bearer'}:{items:[{id:'UC'+'a'.repeat(22),snippet:{title:'Owner'}}]}),{status:200});}});
 c.save('youtube',{clientId:'123-owner.apps.googleusercontent.com'});const f=await fixture(t,{connections:c});
 const start=await fetch(`${f.origin}/setup/youtube/start?key=${f.token}`,{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state');
 assert.equal((await fetch(`${f.origin}/setup/youtube/callback?state=wrong&code=private-code`)).status,400);assert.equal(calls,0);
 const callback=`${f.origin}/setup/youtube/callback?state=${state}&code=private-code`;const success=await fetch(callback);assert.equal(success.status,200);assert.equal((await success.text()).includes('private-access'),false);assert.equal(calls,2);assert.equal((await fetch(callback)).status,400);assert.equal(calls,2);
});
test('runtime official login starts only on user POST, is bounded/protected, and never exposes raw output',async t=>{
 const calls=[],children=[],f=await fixture(t,{getRuntimeStatus:()=>({codex:{authenticated:false},claude:{authenticated:true,secret:'must-never-render'}}),spawnImpl:(command,args,options)=>{const child=fakeChild();calls.push({command,args,options});children.push(child);return child;}});
 let response=await fetch(f.url('runtime'));const initial=await response.text();assert.equal(calls.length,0);assert.match(initial,/Sign-in required/);assert.match(initial,/Signed in/);assert.equal(initial.includes('must-never-render'),false);assert.match(initial,/may open the server browser/);
 assert.equal((await post(f.url('runtime'),{operation:'login',provider:'codex'},f.origin)).status,200);assert.deepEqual(calls[0].args,['login','--device-auth']);assert.equal(calls[0].command,'codex');assert.deepEqual(calls[0].options.stdio,['ignore','pipe','pipe']);
 children[0].stdout.emit('data','Visit https://auth.openai.com/codex/device\nDevice code: ABCD-EFGH\nprivate-access-token-do-not-render\nhttps://evil.example/oauth/authorize');
 response=await fetch(`${f.origin}/setup/runtime/status?key=${f.token}`);const progress=await response.text();assert.match(progress,/auth.openai.com/);assert.match(progress,/ABCD-EFGH/);assert.equal(progress.includes('private-access-token-do-not-render'),false);assert.equal(progress.includes('evil.example'),false);assert.match(progress,/http-equiv="refresh"/);
 await post(f.url('runtime'),{operation:'login',provider:'codex'},f.origin);assert.equal(calls.length,1);
 await post(f.url('runtime'),{operation:'login',provider:'claude'},f.origin);assert.equal(calls.length,2);assert.deepEqual(calls[1].args,['auth','login','--claudeai']);
 children[1].stdout.emit('data','Open https://claude.ai/oauth/authorize?client_id=public-client&state=opaque\nnever-render-raw-output');
 const claude=await (await fetch(f.url('runtime'))).text();assert.match(claude,/claude.ai/);assert.equal(claude.includes('never-render-raw-output'),false);
 assert.equal((await fetch(`${f.origin}/setup/runtime/status`)).status,403);
 children[0].emit('close',0);const done=await (await fetch(f.url('runtime'))).text();assert.match(done,/Official login process: completed/);assert.match(done,/Sign-in required/);
 await f.router.close();assert.deepEqual(children[0].kills,[]);assert.deepEqual(children[1].kills,['SIGTERM']);
});
test('runtime timeout/output cap stop only owned child and errors remain generic',async t=>{
 const children=[],f=await fixture(t,{loginTimeoutMs:20,spawnImpl:()=>{const child=fakeChild();children.push(child);return child;}});
 await post(f.url('runtime'),{operation:'login',provider:'codex'},f.origin);await new Promise(resolve=>setTimeout(resolve,35));assert.deepEqual(children[0].kills,['SIGTERM']);assert.match(await (await fetch(f.url('runtime'))).text(),/timed_out/);
 await post(f.url('runtime'),{operation:'login',provider:'claude'},f.origin);children[1].stdout.emit('data','secret-output'.repeat(4000));assert.deepEqual(children[1].kills,['SIGTERM']);const capped=await (await fetch(f.url('runtime'))).text();assert.match(capped,/output_limit/);assert.equal(capped.includes('secret-output'),false);
 assert.equal((await post(f.url('runtime'),{operation:'login',provider:'malicious;rm'},f.origin)).status,400);
 const broken=await fixture(t,{spawnImpl:()=>{throw new Error('private credential traceback');}});const error=await post(broken.url('runtime'),{operation:'login',provider:'codex'},broken.origin);assert.equal(error.status,503);assert.equal((await error.text()).includes('private credential traceback'),false);
});
