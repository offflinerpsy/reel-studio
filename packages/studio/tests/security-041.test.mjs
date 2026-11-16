import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtempSync,realpathSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnectionSettings} from '../server/connection-settings.mjs';
import {createSetupHTTP} from '../server/setup-http.mjs';
import {youtubeJSON} from '../server/youtube-oauth.mjs';

const channel='UC'+'a'.repeat(22),client={clientId:'security-fixture.apps.googleusercontent.com'};
const json=data=>new Response(JSON.stringify(data),{status:200});
function fixture(t,options={}){
 const home=mkdtempSync(join(realpathSync(tmpdir()),'reel-security-041-'));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 return {home,connections:createConnectionSettings({home,env:{},fetchImpl:async()=>{throw new Error('Unexpected provider access');},...options})};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('a response for replaced credentials cannot verify the replacement',async t=>{
 const entered=deferred(),release=deferred();
 const {connections}=fixture(t,{azureCheck:async()=>{entered.resolve();await release.promise;return {ok:true};}});
 connections.save('azure',{key:'old-synthetic-key',region:'eastus'});
 const pending=connections.check('azure');await entered.promise;
 connections.save('azure',{key:'new-unchecked-key',region:'westus'});
 release.resolve();const result=await pending;
 assert.equal(result.target,'westus');
 assert.notEqual(result.check.status,'verified');
 assert.equal(connections.readPublic().services.find(s=>s.service==='azure').check.status,'not_checked');
});

test('an old failed check cannot overwrite a newly verified connection',async t=>{
 const entered=deferred(),release=deferred();
 const {connections}=fixture(t,{azureCheck:async c=>{if(c.key==='old-synthetic-key'){entered.resolve();await release.promise;throw new Error('old credential rejected');}return {ok:true};}});
 connections.save('azure',{key:'old-synthetic-key',region:'eastus'});
 const stale=connections.check('azure');await entered.promise;
 connections.save('azure',{key:'new-synthetic-key',region:'westus'});
 assert.equal((await connections.check('azure')).check.status,'verified');
 release.resolve();await stale;
 assert.equal(connections.readPublic().services.find(s=>s.service==='azure').check.status,'verified');
});

test('removing and re-saving the same OAuth client revokes its pending callback before any provider call',async t=>{
 let calls=0;
 const {connections}=fixture(t,{fetchImpl:async url=>{calls++;return json(url.includes('/token')?{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer'}:{items:[{id:channel}]});}});
 connections.save('youtube',client);
 const redirectURI='http://127.0.0.1:43210/setup/youtube/callback';
 const state=new URL(connections.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');
 connections.remove('youtube');connections.save('youtube',client);
 await assert.rejects(()=>connections.completeYouTubeOAuth({state,code:'stale-code',redirectURI}));
 assert.equal(calls,0);
 assert.equal(connections.readPublic().services.find(s=>s.service==='youtube').authorized,false);
});

test('completing a newer OAuth flow revokes an older pending account selection',async t=>{
 let calls=0;
 const {connections}=fixture(t,{fetchImpl:async url=>{calls++;return json(url.includes('/token')?{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer'}:{items:[{id:channel}]});}});
 connections.save('youtube',client);const redirectURI='http://127.0.0.1:43210/setup/youtube/callback';
 const oldState=new URL(connections.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');
 const currentState=new URL(connections.startYouTubeOAuth({redirectURI}).authorizeURL).searchParams.get('state');
 await connections.completeYouTubeOAuth({state:currentState,code:'current-code',redirectURI});
 assert.equal(calls,2);
 await assert.rejects(()=>connections.completeYouTubeOAuth({state:oldState,code:'old-code',redirectURI}));
 assert.equal(calls,2);
});

async function serverFixture(t){
 const f=fixture(t),router=createSetupHTTP({connections:f.connections}),token='security-capability-041';
 const server=createServer(async(req,res)=>{if(!await router.handle(req,res,{token,address:server.address()})){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await router.close();await new Promise(resolve=>server.close(resolve));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const raw=({method='GET',path=`/setup/azure?key=${token}`,headers={},chunks=[]}={})=>new Promise((resolve,reject)=>{
  const req=request(origin+path,{method,headers},res=>{const data=[];res.on('data',c=>data.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(data).toString('utf8')}));});
  req.on('error',reject);for(const chunk of chunks)req.write(chunk);req.end();
 });
 return {...f,origin,token,raw};
}

test('real HTTP rejects authority confusion and chunked oversized/duplicate writes without saving secrets',async t=>{
 const f=await serverFixture(t),before=f.connections.readPublic();
 for(const headers of [{Host:'attacker.example:43210'},{Origin:'null'},{Origin:'http://localhost:'+new URL(f.origin).port},{Host:'127.0.0.1:65536'}])assert.equal((await f.raw({headers})).status,403);
 const validHeaders={Origin:f.origin,'Content-Type':'application/x-www-form-urlencoded'};
 assert.equal((await f.raw({method:'POST',headers:validHeaders,chunks:['operation=save&key=one&%6bey=two&region=eastus']})).status,400);
 assert.equal((await f.raw({method:'POST',headers:validHeaders,chunks:['operation=save&key=','x'.repeat(17000),'&region=eastus']})).status,413);
 assert.equal((await f.raw({method:'POST',headers:{...validHeaders,Origin:'https://attacker.example'},chunks:['operation=save&key=private-fixture&region=eastus']})).status,403);
 assert.equal((await f.raw({path:`/setup/azure?key=${f.token}&key=${f.token}`})).status,403);
 assert.deepEqual(f.connections.readPublic(),before);
 const response=await f.raw({method:'POST',headers:validHeaders,chunks:['operation=save&key=private-fixture&region=eastus']});
 assert.equal(response.status,200);assert.equal(response.body.includes('private-fixture'),false);
 assert.equal(response.headers['cache-control'],'no-store, max-age=0');
 const file=join(f.home,'private-connections','credentials.json');
 assert.equal(statSync(file).mode&0o777,0o600);assert.equal(statSync(join(f.home,'private-connections')).mode&0o777,0o700);
 assert.match(readFileSync(file,'utf8'),/private-fixture/);
});

test('actual fetch refuses provider redirects before forwarding a credential to another server',async t=>{
 let sinkRequests=0;
 const sink=createServer((req,res)=>{sinkRequests++;res.end('{}');});
 await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
 const redirect=createServer((req,res)=>{res.writeHead(307,{Location:`http://127.0.0.1:${sink.address().port}/capture`});res.end();});
 await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await Promise.all([sink,redirect].map(server=>new Promise(resolve=>server.close(resolve))));});
 await assert.rejects(()=>youtubeJSON(fetch,`http://127.0.0.1:${redirect.address().port}/token`,{method:'POST',headers:{Authorization:'Bearer synthetic-secret'},body:'refresh_token=synthetic-refresh'}),error=>error.code==='provider_request_failed'&&!error.message.includes('synthetic-secret'));
 assert.equal(sinkRequests,0);
});
