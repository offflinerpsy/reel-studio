import {defineRpcContract} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {UI_TOOLS,MAX_TOOL_BYTES,MAX_INPUT_BYTES} from './src/reel-gateway.mjs';
const bounded=z.unknown().refine(value=>JSON.stringify(value)?.length<=MAX_TOOL_BYTES,'Reel response exceeds the supported bound');
export const bindingSchema=z.object({sessionId:z.string().uuid(),bindingToken:z.string().uuid()}).strict();
export const destinationSchema=z.object({threadId:z.string().max(200),title:z.string().max(2000),projectId:z.string().max(200),projectName:z.string().max(1000),hostId:z.string().max(200),hostName:z.string().max(1000),path:z.string().max(4000),providerId:z.literal('codex'),status:z.enum(['idle','active']),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)});
export const workspaceSchema=z.object({html:z.string().max(2_097_152),version:z.string().max(40),backendVersion:z.string().max(40),route:z.enum(['local','ssh'])});
export const mediaResultSchema=z.object({contents:z.array(z.union([z.object({uri:z.string().max(300),mimeType:z.string().max(80).optional(),text:z.string().max(4096)}).strict(),z.object({uri:z.string().max(300),mimeType:z.string().max(80),blob:z.string().max(16384)}).strict()])).length(1)});
export const sendResultSchema=z.object({isError:z.literal(false),requestKey:z.string().regex(/^[a-f0-9]{64}$/),delivery:z.string(),duplicate:z.boolean().optional()});
export const reconcileResultSchema=z.object({requestKey:z.string(),state:z.enum(['possibly_delivered','delivered_unverified']),found:z.boolean()});
export const rpcContract=defineRpcContract({
 workspace:{input:z.null(),output:workspaceSchema},
 callTool:{input:z.object({name:z.enum(UI_TOOLS),arguments:z.record(z.string(),z.unknown()).optional(),binding:bindingSchema.optional()}).strict().refine(v=>JSON.stringify(v).length<=MAX_INPUT_BYTES,'Reel input exceeds the supported bound'),output:bounded},
 readMedia:{input:z.object({uri:z.string().min(1).max(300)}).strict(),output:mediaResultSchema},
 destinations:{input:z.object({projectId:z.string().min(1).max(200).nullable(),hostId:z.string().min(1).max(200).optional()}).strict(),output:z.object({destinations:z.array(destinationSchema).max(50),bounded:z.boolean()})},
 bindDestination:{input:z.object({sessionId:z.string().uuid(),threadId:z.string().min(1).max(200),projectId:z.string().min(1).max(200),hostId:z.string().min(1).max(200),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),output:z.object({bindingToken:z.string().uuid(),destination:destinationSchema})},
 sendHandoff:{input:bindingSchema.extend({message:z.unknown().refine(v=>JSON.stringify(v)?.length<=32768,'Original AppMessage is too large')}).strict(),output:sendResultSchema},
 handoffReceipts:{input:bindingSchema,output:z.object({receipts:z.array(z.object({requestKey:z.string(),state:z.enum(['possibly_delivered','delivered_unverified']),delivery:z.string().nullable(),createdAt:z.number()})).max(20)})},
 reconcileHandoff:{input:bindingSchema.extend({requestKey:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),output:reconcileResultSchema},
});
