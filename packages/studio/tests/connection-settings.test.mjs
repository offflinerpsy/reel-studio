import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync,symlinkSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnectionSettings} from '../server/connection-settings.mjs';
import {createYouTubeOAuth,YOUTUBE_SCOPES} from '../server/youtube-oauth.mjs';

const channel='UC'+'a'.repeat(22),otherChannel='UC'+'b'.repeat(22),client={clientId:'123-owner.apps.googleusercontent.com',clientSecret:'fixture-secret'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(t,options={}) {const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-connections-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return {home,s:createConnectionSettings({home,env:{},...options})};}
const find=(s,id)=>s.readPublic().services.find(item=>item.service===id);
test('private saved secrets never enter public values or HTML and persist with restrictive permissions',t=>{
 const {home,s}=fixture(t),secret='private-azure-key';s.save('azure',{key:secret,region:'eastus'});
 assert.equal(statSync(join(home,'private-connections')).mode&0o777,0o700);
 assert.equal(statSync(join(home,'private-connections','credentials.json')).mode&0o777,0o600);
 assert.equal(s.credentials('azure').key,secret);assert.equal(find(s,'azure').present,true);
 assert.equal(JSON.stringify(s.readPublic()).includes(secret),false);
 const html=s.formHTML('azure',{actionURL:'/setup/azure?token=instance-key',notice:'<script>unsafe</script>'});
 assert.equal(html.includes(secret),false);assert.match(html,/&lt;script&gt;/);assert.match(html,/type="password"/);
 assert.match(html,/<meta name="referrer" content="same-origin">/);
 assert.equal(createConnectionSettings({home,env:{}}).credentials('azure').key,secret);
 assert.throws(()=>s.save('azure',{key:secret,region:'https://evil.invalid'}));assert.throws(()=>s.save('azure',{key:secret,region:'eastus',endpoint:'https://evil.invalid'}));
 assert.throws(()=>s.formHTML('azure',{actionURL:'https://evil.invalid/setup/azure'}));
 const c=s.credentials('azure');c.key='changed';assert.equal(s.credentials('azure').key,secret);
 s.remove('azure');assert.equal(find(s,'azure').present,false);
});
test('existing environment values are fallback only and removing a saved credential reveals fallback',t=>{
 const {s}=fixture(t,{env:{REEL_TELEGRAM_BOT_TOKEN:'123456:environment-secret',REEL_TELEGRAM_CHAT_ID:'@environment_channel',DATAFORSEO_LOGIN:'owner',DATAFORSEO_PASSWORD:'private-password'}});
 assert.equal(find(s,'telegram').source,'environment');s.save('telegram',{token:'999999:saved-secret-value',chatId:'-100111'});assert.equal(s.credentials('telegram').token,'999999:saved-secret-value');s.remove('telegram');assert.equal(find(s,'telegram').target,'@environment_channel');
 assert.equal(JSON.stringify(s.readPublic()).includes('private-password'),false);
});
test('symlinked directory/file/home and oversized private files are rejected without changing targets',t=>{
 const {home,s}=fixture(t),target=join(home,'untouched');writeFileSync(target,'untouched');mkdirSync(join(home,'private-connections'));symlinkSync(target,join(home,'private-connections','credentials.json'));
 assert.throws(()=>s.save('azure',{key:'secret',region:'eastus'}));assert.equal(readFileSync(target,'utf8'),'untouched');
 rmSync(join(home,'private-connections'),{recursive:true});symlinkSync(home,join(home,'private-connections'));assert.throws(()=>s.readPublic());
 rmSync(join(home,'private-connections'));const alias=join(home,'alias');symlinkSync(home,alias);assert.throws(()=>createConnectionSettings({home:alias,env:{}}).readPublic());
 mkdirSync(join(home,'private-connections'));writeFileSync(join(home,'private-connections','credentials.json'),'x'.repeat(65537));assert.throws(()=>s.readPublic());
});
test('Telegram check verifies exact target and bot posting permission without a send',async t=>{
 const calls=[],{s}=fixture(t,{fetchImpl:async(url,init)=>{calls.push([new URL(url),init]);const method=new URL(url).pathname.split('/').pop();return json({ok:true,result:method==='getMe'?{id:123456,is_bot:true}:method==='getChat'?{id:-100111,type:'channel',username:'owner_channel'}:{status:'administrator',can_post_messages:true}});}});
 s.save('telegram',{token:'123456:private-token-value',chatId:'@owner_channel'});
 const result=await s.check('telegram');assert.equal(result.check.status,'verified');assert.equal(result.check.targetId,'-100111');assert.equal(result.check.canPost,true);
 assert.deepEqual(calls.map(([u])=>u.pathname.split('/').pop()),['getMe','getChat','getChatMember']);assert.ok(calls.every(([,init])=>init.redirect==='error'));
 assert.equal(JSON.stringify(result).includes('private-token-value'),false);
 const denied=createConnectionSettings({home:fixture(t).home,env:{},fetchImpl:async(url)=>json({ok:true,result:new URL(url).pathname.endsWith('getMe')?{id:123456,is_bot:true}:new URL(url).pathname.endsWith('getChat')?{id:-100111,type:'channel'}:{status:'administrator',can_post_messages:false}})});
 denied.save('telegram',{token:'123456:private-token-value',chatId:'-100111'});assert.equal((await denied.check('telegram')).check.error,'posting_permission_missing');
});
test('non-effectful provider checks use pinned HTTPS origins and sanitize raw error responses',async t=>{
 const calls=[],{s}=fixture(t,{fetchImpl:async(url,init)=>{calls.push([url,init]);return url.includes('dataforseo')?json({status_code:20000,tasks_error:0,tasks:[{status_code:20000}]}):json([{ShortName:'en-US-Test'}]);}});
 s.save('dataforseo',{login:'owner@example.test',password:'private-dfs-password'});s.save('azure',{key:'private-speech-key',region:'eastus'});
 assert.equal((await s.check('dataforseo')).check.status,'verified');assert.equal((await s.check('azure')).check.status,'verified');
 assert.deepEqual(calls.map(([u])=>new URL(u).origin),['https://api.dataforseo.com','https://eastus.tts.speech.microsoft.com']);assert.ok(calls.every(([,init])=>init.redirect==='error'&&init.signal));
 const broken=fixture(t,{fetchImpl:async()=>{throw new Error('credentials private-dfs-password');}}).s;broken.save('dataforseo',{login:'owner',password:'private-dfs-password'});const result=await broken.check('dataforseo');assert.equal(result.check.status,'failed');assert.equal(JSON.stringify(result).includes('private-dfs-password'),false);
});
test('Telegram rejects a group member or restricted member without video posting permission',async t=>{
 for(const restricted of [false,true]){
  const {s}=fixture(t,{fetchImpl:async url=>json({ok:true,result:url.includes('/getMe')?{id:123456,is_bot:true}:url.includes('/getChat?')?{id:-100111,type:'supergroup',permissions:{can_send_messages:true,can_send_videos:false}}:{status:restricted?'restricted':'member',is_member:true,can_send_messages:true,can_send_videos:false}})});
  s.save('telegram',{token:'123456:private-token-value',chatId:'-100111'});assert.equal((await s.check('telegram')).check.error,'posting_permission_missing');
 }
});
test('YouTube PKCE OAuth binds exact callback, state, scopes and one owner channel, then refreshes privately',async t=>{
 let clock=1000000;const calls=[],{home,s}=fixture(t,{now:()=>clock,fetchImpl:async(url,init)=>{calls.push([url,init]);if(url.includes('/token')){const body=new URLSearchParams(init.body);return json({access_token:body.get('grant_type')==='refresh_token'?'refreshed-access-secret':'first-access-secret',refresh_token:'private-refresh-secret',expires_in:3600,token_type:'Bearer',scope:YOUTUBE_SCOPES.join(' ')});}return json({items:[{id:channel,snippet:{title:'Owner channel'}}]});}});
 s.save('youtube',client);const redirectURI='http://127.0.0.1:34567/setup/youtube/callback',start=s.startYouTubeOAuth({redirectURI}),auth=new URL(start.authorizeURL);
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('redirect_uri'),redirectURI);assert.equal(auth.searchParams.get('scope'),YOUTUBE_SCOPES.join(' '));
 const state=auth.searchParams.get('state'),result=await s.completeYouTubeOAuth({state,code:'owner-code',redirectURI});assert.equal(result.target,channel);assert.equal(result.authorized,true);assert.equal(result.check.status,'verified');
 const exchange=new URLSearchParams(calls[0][1].body);assert.equal(exchange.get('code'),'owner-code');assert.ok(exchange.get('code_verifier'));assert.equal(exchange.get('redirect_uri'),redirectURI);
 assert.equal(JSON.stringify(s.readPublic()).includes('private-refresh-secret'),false);assert.equal(JSON.stringify(s.readPublic()).includes('first-access-secret'),false);
 await assert.rejects(()=>s.completeYouTubeOAuth({state,code:'owner-code',redirectURI}));
 clock+=3600000;const access=await s.getYouTubeAccessToken();assert.equal(access.accessToken,'refreshed-access-secret');assert.equal(access.channel.id,channel);assert.equal(calls.filter(([url])=>url.includes('/token')).length,2);
 assert.equal(new URLSearchParams(calls[2][1].body).get('refresh_token'),'private-refresh-secret');assert.equal(statSync(join(home,'private-connections','credentials.json')).mode&0o777,0o600);
});
test('YouTube rejects expired states, callback changes and mismatched channel after refresh',async t=>{
 let clock=1000000,selected=channel,calls=0;const {s}=fixture(t,{now:()=>clock,fetchImpl:async(url)=>{calls++;return url.includes('/token')?json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,token_type:'Bearer',scope:YOUTUBE_SCOPES.join(' ')}):json({items:[{id:selected}]});}});
 s.save('youtube',client);const redirectURI='http://127.0.0.1:34567/setup/youtube/callback';
 let state=new URL(s.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');clock+=600001;await assert.rejects(()=>s.completeYouTubeOAuth({state,code:'code',redirectURI}));assert.equal(calls,0);
 state=new URL(s.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');await assert.rejects(()=>s.completeYouTubeOAuth({state,code:'code',redirectURI:redirectURI.replace('34567','34568')}));assert.equal(calls,0);
 state=new URL(s.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');await s.completeYouTubeOAuth({state,code:'code',redirectURI});selected=otherChannel;clock+=3600000;await assert.rejects(()=>s.getYouTubeAccessToken(),error=>error.code==='channel_mismatch');assert.equal((await s.check('youtube')).check.error,'channel_mismatch');
 assert.equal(find(s,'youtube').target,channel);
 assert.throws(()=>s.startYouTubeOAuth({redirectURI:'https://evil.invalid/setup/youtube/callback'}));
});
test('OAuth validates provider tokens and requires a unique channel',async()=>{
 for(const reply of [{access_token:'bad\r\nheader',refresh_token:'refresh',expires_in:3600,token_type:'Bearer'},{access_token:'access',refresh_token:'refresh',expires_in:3600,token_type:'Bearer',scope:YOUTUBE_SCOPES[0]}]) {
  const o=createYouTubeOAuth({fetchImpl:async()=>json(reply)}),redirectURI='http://127.0.0.1:12345/setup/youtube/callback',state=new URL(o.start({client,redirectURI}).authorizeURL).searchParams.get('state');await assert.rejects(()=>o.complete({state,code:'code',redirectURI}));
 }
 const o=createYouTubeOAuth({fetchImpl:async(url)=>json(url.includes('/token')?{access_token:'access',refresh_token:'refresh',expires_in:3600,token_type:'Bearer'}:{items:[{id:channel},{id:otherChannel}]})}),redirectURI='http://127.0.0.1:12345/setup/youtube/callback',state=new URL(o.start({client,redirectURI}).authorizeURL).searchParams.get('state');await assert.rejects(()=>o.complete({state,code:'code',redirectURI}));
});
