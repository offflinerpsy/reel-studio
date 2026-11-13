import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createStartupLoader} from '../ui/startup.mjs';
import {relayStudio} from '../server/mac-ui-relay.mjs';
import {encodeFrame,decodeFrame} from '../server/stdio-compress.mjs';
import {buildBoardSnapshot} from '../server/startup-projection.mjs';

test('board projection keeps exact counts and ownership while staying compact',()=>{
 const projects=Array.from({length:54},(_,i)=>({id:`p${i}`,title:`Project ${i}`,idea:'idea '.repeat(200),status:'review',revision:i+1,createdAt:'now',updatedAt:'now',productionLineId:'line',computeTarget:'linux',template:{id:'t'},versions:[],jobs:[]}));
 const board=buildBoardSnapshot({schema:4,revision:9,updatedAt:'now',projects,attempts:[],accounts:[{id:'a',channel:'youtube',account:'UCx',label:'Y',status:'browser_verified',archived:false}]},{templates:[{id:'t',name:'T',color:'#000',tag:'t',description:'d'}],profiles:[{id:'profile',model:{name:'gpt',effort:'medium'}}],productionLines:[{id:'line',ownerHost:'linux'}],operations:{directions:[]},connections:[],compute:{target:'linux'},version:'0.1.26'});
 assert.equal(board.totals.projects,54);assert.equal(board.projects[0].computeTarget,'linux');assert.equal(board.accounts[0].account,'UCx');assert.ok(Buffer.byteLength(JSON.stringify(board))<100000);
});

test('SSH compression preserves exact JSON, receipts and Unicode while bounding transfer size',()=>{
 const source=JSON.stringify({jsonrpc:'2.0',id:8,result:{snapshot:{projects:Array.from({length:33},(_,i)=>({id:i,receipt:'immutable',rules:'Сохранить оригинал '.repeat(200)}))}}});
 const wire=encodeFrame(source);assert.ok(wire.length<source.length/4);assert.equal(decodeFrame(wire),source);
 assert.equal(encodeFrame('{"small":true}'),'{"small":true}');assert.equal(decodeFrame('{"small":true}'),'{"small":true}');assert.throws(()=>decodeFrame('{"reelWire":1,"gzip":"invalid"}'));
});

test('a slow initial read reports a deadline and retry shares that same read',async()=>{
 let finish,connects=0,reads=0;
 const load=createStartupLoader({timeoutMs:10,connect:async()=>{connects++;},read:()=>{reads++;return new Promise(resolve=>finish=resolve);}});
 await assert.rejects(load(),/taking too long/);
 const retry=load();finish('same result');assert.equal(await retry,'same result');assert.equal(connects,1);assert.equal(reads,1);
});
test('a failed startup can be retried and does not hide the original error',async()=>{
 let attempts=0;
 const load=createStartupLoader({connect:async()=>{},read:async()=>{if(++attempts===1)throw new Error('Linux unavailable');return 'ready';}});
 await assert.rejects(load(),/Linux unavailable/);assert.equal(await load(),'ready');
});
test('local UI and opener do not wait for Linux; production requests pass through unchanged',()=>{
 const input=new PassThrough(),output=new PassThrough(),stdin=new PassThrough(),stdout=new PassThrough();let sent='',received='';
 stdin.on('data',b=>sent+=b);output.on('data',b=>received+=b);
 const relay=relayStudio({input,output,child:{stdin,stdout},root:fileURLToPath(new URL('..',import.meta.url))});
 const request=(id,method,params)=>input.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
 request(1,'resources/read',{uri:relay.uri});request(2,'tools/call',{name:'reel_open',arguments:{}});
 const results=received.trim().split('\n').map(JSON.parse);assert.equal(sent,JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'reel_open',arguments:{}}})+'\n');assert.ok(results[0].result.contents[0].text.includes('Reel Studio'));assert.equal(results[0].result.contents[0].uri,relay.uri);
 sent='';
 request(6,'resources/read',{uri:'ui://reel-studio/workspace/0.1.18'});assert.equal(sent,'');const legacy=JSON.parse(received.trim().split('\n').at(-1));assert.equal(legacy.result.contents[0].uri,'ui://reel-studio/workspace/0.1.18');assert.equal(legacy.result.contents[0].text,results[0].result.contents[0].text);
 const action={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'reel_create',arguments:{requestKey:'keep-this-key',model:'unchanged'}}};input.write(JSON.stringify(action)+'\n');assert.equal(sent,JSON.stringify(action)+'\n');
 request(4,'tools/list',{});stdout.write(JSON.stringify({jsonrpc:'2.0',id:4,result:{tools:[{name:'reel_open',_meta:{ui:{resourceUri:'ui://reel-studio/workspace/old'}}}]}})+'\n');
 assert.equal(JSON.parse(received.trim().split('\n').at(-1)).result.tools[0]._meta.ui.resourceUri,relay.uri);
 const reply=JSON.stringify({jsonrpc:'2.0',id:3,result:{structuredContent:{snapshot:{compute:{target:'linux'},revision:123}}}});stdout.write(reply+'\n');assert.equal(received.trim().split('\n').at(-1),reply);
 const largeReply=JSON.stringify({jsonrpc:'2.0',id:5,result:{immutable:'exact master and receipts '.repeat(2000)}});stdout.write(encodeFrame(largeReply)+'\n');assert.equal(received.trim().split('\n').at(-1),largeReply);
 relay.close();assert.equal(stdin.writableEnded,true);
});
