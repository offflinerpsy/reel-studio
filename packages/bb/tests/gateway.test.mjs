// Synthetic stubs only: no Studio process, media, account or network effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import expected from '../capabilities.json' with {type:'json'};
import {createReelGateway,verifyCapabilities,UI_TOOLS,validateMediaUri} from '../src/reel-gateway.mjs';
const workers=['reel_state','reel_publication_job','reel_release_plan','reel_connection_record','reel_publication_result','reel_release_plan_result'];
const catalog=()=>({tools:[...new Set([...UI_TOOLS,...workers])].map(name=>({name,inputSchema:structuredClone(expected.schemas[name]),_meta:{ui:{visibility:['app','model']}}}))});
test('same-release catalog must retain every allowed schema and visibility',()=>{
 const good=catalog();verifyCapabilities(good);
 const changed=catalog();changed.tools[0].inputSchema={type:'string'};assert.throws(()=>verifyCapabilities(changed),/CAPABILITY_CHANGED/);
 const missing=catalog();missing.tools.pop();assert.throws(()=>verifyCapabilities(missing),/CAPABILITY_CHANGED/);
});
test('handoffs require binding and failed tool calls are never replayed',async()=>{
 let calls=0,authorized=0;
 const client={connect:async()=>{},getServerVersion:()=>({version:expected.sourceVersion}),listTools:async()=>catalog(),callTool:async()=>{calls++;throw new Error('transport lost');},close:async()=>{}};
 const gateway=createReelGateway({verifyInstalled:async()=>{},clientFactory:()=>client,transportFactory:()=>({stderr:{resume(){}},close:async()=>{}}),authorizeHandoff:async binding=>{authorized++;if(!binding)throw new Error('binding required');}});
 await assert.rejects(gateway.call({name:'reel_browser_prepare'}),/binding required/);assert.equal(calls,0);
 await assert.rejects(gateway.call({name:'reel_browser_prepare',binding:{}}),/transport lost/);assert.equal(calls,1);assert.equal(authorized,2);
 await assert.rejects(gateway.call({name:'arbitrary_tool'}),/NOT_ALLOWED/);assert.equal(calls,1);await gateway.dispose();
});
test('media resource paths remain constrained',()=>{assert.throws(()=>validateMediaUri('file:///private/data'));assert.throws(()=>validateMediaUri('reel-media-info://studio/../../data'));assert.equal(validateMediaUri('reel-media-info://studio/kinetic.jpg'),'reel-media-info://studio/kinetic.jpg');});
