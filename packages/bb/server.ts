import type {BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {rpcContract,workspaceSchema,mediaResultSchema,sendResultSchema,reconcileResultSchema} from './contract';
import {createReelGateway,HOST_HANDOFF_TOOLS} from './src/reel-gateway.mjs';
import {createReelHandoffs} from './src/reel-handoffs.mjs';
export {rpcContract} from './contract';
export default async function plugin(bb:BbPluginApi){
 const handoffs=createReelHandoffs({sdk:()=>bb.sdk,kv:bb.storage.kv,pluginId:bb.pluginId,nativeCall:(name,args)=>gateway.handoffCall({name,arguments:args})});
 const gateway=createReelGateway({authorizeHandoff:async binding=>{await handoffs.authorize(binding as {sessionId?:string;bindingToken?:string}|undefined);await gateway.handoffCapabilities();}});
 bb.onDispose(()=>{handoffs.dispose();return gateway.dispose();});
 bb.rpc.register(rpcContract,{
  workspace:async()=>workspaceSchema.parse(await gateway.workspace()),
  callTool:async input=>{const result=await gateway.call(input);if(HOST_HANDOFF_TOOLS.has(input.name)&&input.binding)await handoffs.capture(input.binding,input.name,input.arguments??{},result);return result;},
  readMedia:async input=>mediaResultSchema.parse(await gateway.media(input.uri)),
  destinations:input=>handoffs.destinations(input.projectId),bindDestination:input=>handoffs.bind(input),sendHandoff:async input=>sendResultSchema.parse(await handoffs.send(input)),handoffReceipts:input=>handoffs.receipts(input),reconcileHandoff:async input=>reconcileResultSchema.parse(await handoffs.reconcile(input)),
 });
 const request=z.object({requestKey:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
 const read=request.extend({studioProjectId:z.string().min(1).max(200).optional()}).strict();
 const record=request.extend({result:z.record(z.string(),z.unknown()).refine(v=>JSON.stringify(v).length<=20*1024,'Result exceeds the supported bound'),observedSavedAccount:z.string().min(2).max(100).optional()}).strict();
 const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
 bb.agents.registerTool({name:'bb_reel_handoff_read',description:'Read and reconcile this exact persisted Reel Studio handoff in its bound thread and workspace.',parameters:z.toJSONSchema(read),execute:async(input,ctx)=>result(await handoffs.workerRead(read.parse(input),ctx))});
 bb.agents.registerTool({name:'bb_reel_handoff_record',description:'Record actual observations for this exact frozen Reel Studio handoff. Uncertain actions cannot be replayed.',parameters:z.toJSONSchema(record),execute:async(input,ctx)=>result(await handoffs.workerRecord(record.parse(input),ctx))});
 bb.agents.configure(ctx=>handoffs.toolsForThread(ctx));
}
