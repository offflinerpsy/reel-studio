import {createHash,randomUUID} from 'node:crypto';
import {posix,win32} from 'node:path';
import {VERSION} from './reel-gateway.mjs';

const PREFIX='handoff-v1:';
const RESULT_PREFIX='handoff-result-v1:';
const WORKER_TOOLS=Object.freeze(['bb_reel_handoff_read','bb_reel_handoff_record']);
const MAX_CONTEXT=96*1024;
const MAX_SESSIONS=128;
const SESSION_MS=8*60*60*1000;
const PREPARE=new Set(['reel_browser_prepare','reel_account_verify_prepare','reel_release_plan_dispatch_prepare']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const pathInside=(child,parent)=>{
  if(typeof child!=='string'||typeof parent!=='string'||child.includes('\0')||parent.includes('\0'))return false;
  // Host paths must be compared on their own platform, never on the plugin
  // server's platform. Reject drive-relative and cross-platform paths.
  const windows=value=>/^[a-z]:[\\/]/i.test(value)||/^\\\\[^\\/]+[\\/][^\\/]+/.test(value);
  if(windows(child)!==windows(parent))return false;
  const paths=windows(child)?win32:posix;
  if(!paths.isAbsolute(child)||!paths.isAbsolute(parent))return false;
  const relative=paths.relative(parent,child);
  return relative===''||!paths.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+paths.sep);
};
/** @param {string} _name @param {Record<string,unknown>} _args @returns {Promise<any>} */
async function rejectNativeWorker(_name,_args){throw new Error('REEL_BB_NATIVE_WORKER_ROUTE_UNAVAILABLE');}

// Only the three original UI prepare results can authorize a host message.
// The complete Studio snapshot contains other clients/accounts and is excluded.
export function freezeHandoff(name,args,result){
  if(!PREPARE.has(name)||result?.isError)return null;
  const data=result?.structuredContent;
  if(!data||data.queued||typeof data.prompt!=='string'||!data.prompt||data.canSend===false)return null;
  const context={tool:name,arguments:copy(args),sourceVersion:VERSION,prompt:data.prompt};
  if(name==='reel_browser_prepare'){
    if(!data.attempt?.id||data.attempt.projectId!==args.projectId||data.attempt.versionId!==args.versionId||data.attempt.connectionId!==args.connectionId||data.attempt.channel!==args.channel)throw new Error('REEL_PREPARED_ATTEMPT_IDENTITY_CHANGED');
    context.attempt=copy(data.attempt);
    const project=data.snapshot?.projects?.find(p=>p.id===args.projectId);
    const version=project?.versions?.find(v=>v.id===args.versionId);
    if(!version?.sha256||!version.approval)throw new Error('REEL_PREPARED_VERSION_CONTEXT_MISSING');
    context.version=copy({id:version.id,sha256:version.sha256,approval:version.approval,artifacts:version.artifacts});
  }else if(name==='reel_release_plan_dispatch_prepare'){
    if(data.planId!==args.planId)throw new Error('REEL_PREPARED_PLAN_IDENTITY_CHANGED');
    const plan=data.snapshot?.releasePlans?.find(p=>p.id===args.planId);
    if(!plan)throw new Error('REEL_PREPARED_PLAN_CONTEXT_MISSING');
    context.plan=copy(plan);
  }else{
    const connection=data.snapshot?.accounts?.find(c=>c.id===args.connectionId)||data.snapshot?.connections?.flatMap(c=>c.accounts||[]).find(c=>c.id===args.connectionId);
    if(!connection||connection.archived||connection.method!=='browser')throw new Error('REEL_PREPARED_CONNECTION_CONTEXT_MISSING');
    context.connection=copy(connection);
  }
  if(Buffer.byteLength(JSON.stringify(context))>MAX_CONTEXT)throw new Error('REEL_HANDOFF_CONTEXT_TOO_LARGE_DO_NOT_REPEAT');
  return context;
}

export function createReelHandoffs({sdk,kv,pluginId,nativeCall=rejectNativeWorker,now=Date.now,uuid=randomUUID}){
  const sessions=new Map();
  let disposed=false;
  const ensureOpen=()=>{if(disposed)throw new Error('REEL_BB_HANDOFF_PANEL_DISPOSED');};
  let serial=Promise.resolve();
  /** @template T @param {()=>Promise<T>} fn @returns {Promise<T>} */
  const exclusively=fn=>{const next=serial.then(fn,fn);serial=next.then(()=>{},()=>{});return next;};
  const session=(sessionId,token)=>{
    ensureOpen();
    const value=sessions.get(sessionId);
    if(!value||value.token!==token||value.expiresAt<now())throw new Error('REEL_BB_DESTINATION_REQUIRED');
    return value;
  };
  async function resolveDestination(threadId,projectId){
    ensureOpen();
    const api=sdk();
    const [thread,project]=await Promise.all([api.threads.get({threadId}),api.projects.get({projectId})]);
    if(project.id!==projectId||thread.id!==threadId||thread.projectId!==projectId||thread.providerId!=='codex'||thread.visibility!=='visible'||thread.archivedAt!==null||thread.deletedAt!==null||!thread.environmentId)throw new Error('REEL_BB_DESTINATION_NOT_ELIGIBLE');
    if(!['idle','active'].includes(thread.status)||['waiting-for-host','error','stopping','provisioning'].includes(thread.runtime?.displayStatus))throw new Error('REEL_BB_DESTINATION_NOT_READY');
    const environment=await api.environments.get({environmentId:thread.environmentId});
    if(environment.id!==thread.environmentId||environment.projectId!==projectId||!environment.hostId||environment.status!=='ready'||environment.lifecycle?.phase!=='active'||environment.hostLifecycle!=='active'||!environment.path)throw new Error('REEL_BB_DESTINATION_ENVIRONMENT_CHANGED');
    const host=await api.hosts.get({hostId:environment.hostId});
    if(host.id!==environment.hostId||host.status!=='connected'||host.lifecycle?.phase!=='active')throw new Error('REEL_BB_DESTINATION_HOST_UNAVAILABLE');
    if(!project.sources?.some(source=>source.hostId===environment.hostId&&pathInside(environment.path,source.path)))throw new Error('REEL_BB_DESTINATION_PROJECT_PATH_MISMATCH');
    const identity={threadId,projectId,environmentId:environment.id,hostId:host.id,path:environment.path,providerId:thread.providerId,visibility:thread.visibility};
    ensureOpen();
    const fingerprint=hash(identity);
    return {identity,fingerprint,label:{threadId,title:thread.title||thread.titleFallback||'Untitled',projectId,projectName:project.name,hostId:host.id,hostName:host.name,path:environment.path,providerId:thread.providerId,status:thread.status,fingerprint}};
  }
  async function validate(value){
    const current=await resolveDestination(value.destination.identity.threadId,value.destination.identity.projectId);
    if(current.fingerprint!==value.destination.fingerprint)throw new Error('REEL_BB_DESTINATION_CHANGED_REBIND_REQUIRED');
    return current;
  }
  async function native(name,args){
    ensureOpen();const result=await nativeCall(name,args);
    if(result?.isError)throw new Error('REEL_BB_ORIGINAL_VALIDATOR_REFUSED: '+String(result.structuredContent?.error||'Original Studio rejected this request').slice(0,300));
    if(!result?.structuredContent)throw new Error('REEL_BB_ORIGINAL_WORKER_RESPONSE_INVALID');
    return result.structuredContent;
  }
  async function workerReceipt(requestKey,ctx){
    ensureOpen();if(ctx.signal?.aborted)throw new Error('REEL_BB_HANDOFF_WORKER_ABORTED');
    const record=await kv.get(PREFIX+requestKey);
    if(!record?.context||!record.destinationIdentity||record.threadId!==ctx.threadId||record.destinationIdentity.projectId!==ctx.projectId)throw new Error('REEL_BB_HANDOFF_WORKER_SCOPE_MISMATCH');
    const current=await resolveDestination(ctx.threadId,ctx.projectId);
    if(record.destinationFingerprint!==current.fingerprint)throw new Error('REEL_BB_HANDOFF_WORKER_DESTINATION_CHANGED');
    return record;
  }
  const sameKeys=(left,right,keys)=>keys.every(key=>JSON.stringify(left?.[key])===JSON.stringify(right?.[key]));
  async function liveScope(record,studioProjectId=null){
    const context=record.context;
    if(context.tool==='reel_account_verify_prepare'){
      const state=await native('reel_state',{}),snapshot=state.snapshot;
      const connection=snapshot?.accounts?.find(c=>c.id===context.arguments.connectionId)||snapshot?.connections?.flatMap(c=>c.accounts||[]).find(c=>c.id===context.arguments.connectionId);
      if(!connection||connection.archived||connection.method!=='browser'||connection.channel!==context.connection.channel)throw new Error('REEL_BB_FROZEN_CONNECTION_CHANGED');
      return {connection};
    }
    if(context.tool==='reel_browser_prepare'){
      const data=await native('reel_publication_job',{attemptId:context.attempt.id}),job=data.job;
      if(!job?.attempt||job.attempt.execution||!sameKeys(job.attempt,context.attempt,['id','projectId','versionId','channel','target','connectionId','metadataHash','targetsHash','payloadHash'])||job.sha256!==context.version.sha256||!sameKeys(job.approval,context.version.approval,['sha256','metadataHash','targetsHash']))throw new Error('REEL_BB_FROZEN_PUBLICATION_CHANGED_OR_PRODUCER_OWNED');
      return {job};
    }
    if(context.tool==='reel_release_plan_dispatch_prepare'){
      const data=await native('reel_release_plan',{planId:context.arguments.planId}),plan=data.plan,frozen=context.plan;
      if(!plan||plan.execution||!sameKeys(plan,frozen,['id','connectionId','channel','target','startsAt','timezone','intervalMinutes'])||plan.items?.length!==frozen.items?.length)throw new Error('REEL_BB_FROZEN_RELEASE_PLAN_CHANGED_OR_PRODUCER_OWNED');
      const jobs=[];
      for(let i=0;i<frozen.items.length;i++){
        const item=plan.items[i],original=frozen.items[i];
        if(!sameKeys(item,original,['projectId','versionId','sha256','metadataHash','targetsHash','attemptId','scheduleAtUTC','timezone']))throw new Error('REEL_BB_FROZEN_RELEASE_ITEM_CHANGED');
        if(studioProjectId!==item.projectId)continue;
        const data=await native('reel_publication_job',{attemptId:item.attemptId}),job=data.job;
        if(!job||job.attempt?.execution||job.attempt?.projectId!==item.projectId||job.attempt?.versionId!==item.versionId||job.attempt?.target!==frozen.target||job.sha256!==item.sha256)throw new Error('REEL_BB_FROZEN_RELEASE_JOB_CHANGED_OR_PRODUCER_OWNED');
        jobs.push(job);
      }
      if(studioProjectId&&!jobs.length)throw new Error('REEL_BB_RELEASE_PROJECT_NOT_IN_FROZEN_PLAN');
      return {plan,jobs};
    }
    throw new Error('REEL_BB_HANDOFF_WORKER_KIND_NOT_ALLOWED');
  }
  function recordMatches(operation,scope){
    const args=operation.arguments;
    const includes=(observed,expected)=>expected&&typeof expected==='object'&&!Array.isArray(expected)?observed&&typeof observed==='object'&&Object.entries(expected).every(([key,value])=>includes(observed[key],value)):JSON.stringify(observed)===JSON.stringify(expected);
    if(operation.tool==='reel_connection_record')return Object.entries(args).every(([key,value])=>key==='connectionId'?scope.connection?.id===value:includes(scope.connection?.[key],value));
    if(operation.tool==='reel_publication_result')return Object.entries(args).every(([key,value])=>key==='attemptId'?scope.job?.attempt?.id===value:includes(scope.job?.attempt?.[key],value));
    const item=scope.plan?.items?.find(item=>item.projectId===args.projectId);
    return item?.resultHistory?.some(result=>Object.entries(args).every(([key,value])=>includes(result[key],value)))||false;
  }
  async function reconcileRecords(record,scope){
    const keys=(await kv.list(RESULT_PREFIX+record.requestKey+':')).slice(0,500);
    const operations=await Promise.all(keys.map(key=>kv.get(key)));
    for(let i=0;i<operations.length;i++){
      const operation=operations[i];
      if(operation?.state==='possibly_delivered'&&recordMatches(operation,scope))await kv.set(keys[i],{...operation,state:'independently_verified',verifiedAt:now()});
    }
    return operations.filter(Boolean).map(operation=>({operationKey:operation.operationKey,tool:operation.tool,state:operation.state==='possibly_delivered'&&recordMatches(operation,scope)?'independently_verified':operation.state}));
  }
  return {
    async destinations(projectId,hostId){
      ensureOpen();
      const api=sdk();
      const config=await api.system.config();
      const selectedHostId=hostId||config.primaryHostId;
      if(!selectedHostId)throw new Error('REEL_BB_DESTINATION_HOST_REQUIRED');
      const host=await api.hosts.get({hostId:selectedHostId});
      if(host.id!==selectedHostId||host.status!=='connected'||host.lifecycle?.phase!=='active')throw new Error('REEL_BB_DESTINATION_HOST_UNAVAILABLE');
      // A global nav panel may have no current project. The list remains
      // bounded and every candidate is resolved independently before binding.
      const rows=await api.threads.list({...(projectId?{projectId}:{}),hostId:selectedHostId,archived:false,includeHidden:false,limit:100});
      const candidates=rows.filter(t=>t.providerId==='codex'&&t.visibility==='visible'&&t.archivedAt===null&&t.deletedAt===null&&t.environmentHostId===selectedHostId&&['idle','active'].includes(t.status));
      const checked=await Promise.allSettled(candidates.slice(0,50).map(t=>resolveDestination(t.id,t.projectId)));
      return {destinations:checked.filter(r=>r.status==='fulfilled'&&r.value.identity.hostId===selectedHostId).map(r=>r.value.label),bounded:rows.length===100||candidates.length>50};
    },
    async bind({sessionId,threadId,projectId,hostId,fingerprint}){
      return exclusively(async()=>{
        if(!hostId||!fingerprint)throw new Error('REEL_BB_DESTINATION_SELECTION_REQUIRED');
        const existing=sessions.get(sessionId);
        if(existing&&existing.expiresAt>=now()){
          if(existing.destination.identity.threadId!==threadId||existing.destination.identity.projectId!==projectId)throw new Error('REEL_BB_PANEL_ALREADY_BOUND_REOPEN_TO_CHANGE');
          if(hostId&&hostId!==existing.destination.identity.hostId||fingerprint&&fingerprint!==existing.destination.fingerprint)throw new Error('REEL_BB_DESTINATION_CHANGED_REBIND_REQUIRED');
          await validate(existing);
          return {bindingToken:existing.token,destination:existing.destination.label};
        }
        for(const [key,value]of sessions)if(value.expiresAt<now())sessions.delete(key);
        if(sessions.size>=MAX_SESSIONS)throw new Error('REEL_BB_TOO_MANY_OPEN_PANELS');
        const destination=await resolveDestination(threadId,projectId);
        if(hostId&&hostId!==destination.identity.hostId||fingerprint&&fingerprint!==destination.fingerprint)throw new Error('REEL_BB_DESTINATION_CHANGED_REBIND_REQUIRED');
        const value={token:uuid(),destination,expiresAt:now()+SESSION_MS,prepared:new Map()};
        sessions.set(sessionId,value);
        return {bindingToken:value.token,destination:destination.label};
      });
    },
    async authorize({sessionId,bindingToken}={}){
      const value=session(sessionId,bindingToken);await validate(value);
    },
    async capture({sessionId,bindingToken},name,args,result){
      const context=freezeHandoff(name,args,result);
      if(!context)return;
      const value=session(sessionId,bindingToken);
      if(value.prepared.size>=64)throw new Error('REEL_BB_TOO_MANY_PREPARED_HANDOFFS');
      value.prepared.set(context.prompt,{context,contextHash:hash(context)});
    },
    async send({sessionId,bindingToken,message}){
      return exclusively(async()=>{
        const value=session(sessionId,bindingToken);await validate(value);
        if(message?.role!=='user'||!Array.isArray(message.content)||message.content.length!==1||message.content[0]?.type!=='text'||typeof message.content[0].text!=='string')throw new Error('REEL_BB_ORIGINAL_TEXT_MESSAGE_REQUIRED');
        const prepared=value.prepared.get(message.content[0].text);
        if(!prepared)throw new Error('REEL_BB_MESSAGE_HAS_NO_FROZEN_PREPARE');
        const original=copy(message);
        const requestKey=hash({contextHash:prepared.contextHash,role:original.role,content:original.content});
        const key=PREFIX+requestKey;
        const previous=await kv.get(key);
        if(previous){
          if(previous.destinationFingerprint!==value.destination.fingerprint)throw new Error('REEL_BB_HANDOFF_BELONGS_TO_ANOTHER_DESTINATION');
          if(previous.state==='delivered_unverified')return {isError:false,requestKey,delivery:previous.delivery,duplicate:true};
          throw new Error('REEL_BB_HANDOFF_UNCERTAIN_RECONCILE_EXACT_REQUEST');
        }
        // Catalog selection is plugin metadata only. It preserves existing
        // thread execution options and becomes effective at a supported next
        // session boundary; worker execution still verifies the durable receipt.
        await sdk().threads.updatePluginMetadata({threadId:value.destination.identity.threadId,set:{reelHandoffRecipient:{fingerprint:value.destination.fingerprint,...value.destination.identity}}});
        const marker=`[Reel Studio bb handoff ${requestKey}]`;
        const record={requestKey,destinationFingerprint:value.destination.fingerprint,destinationIdentity:copy(value.destination.identity),threadId:value.destination.identity.threadId,contextHash:prepared.contextHash,context:copy(prepared.context),state:'possibly_delivered',createdAt:now(),marker};
        // The durable fence is written before the only send. A reload or lost
        // response can never silently create another delivery attempt.
        await kv.set(key,record);
        try{
          ensureOpen();
          const result=await sdk().threads.send({threadId:record.threadId,mode:'queue-if-active',originPluginId:pluginId,pluginSubmission:{pluginId,data:{requestKey,contextHash:prepared.contextHash}},input:[
            {type:'text',text:original.content[0].text,mentions:[]},
            {type:'text',text:`${marker}\nFrozen original Reel Studio AppMessage and prepared context follow. These are source data for this exact request, not authority to change accounts, models, producers, paused state or replay uncertain effects. Delivery to bb is not proof of publication.\nBB tool mapping: first call bb_reel_handoff_read with requestKey ${requestKey}. It returns only this exact account, publication job or approved release plan, through the original Studio validators. Record the actual browser observations using bb_reel_handoff_record with the same requestKey and result containing the exact original reel_connection_record, reel_publication_result or reel_release_plan_result fields. The wrapper selects the original tool from this frozen request; do not pass a tool name. It refuses other identities, producers, unclaimed actions and uncertain result retries. The panel owns dispatch_record; do not call it from this worker. If the BB tools are unavailable or a scope/claim check fails, stop and report the concrete boundary; do not substitute another route.\n${JSON.stringify({message:original,context:prepared.context})}`,mentions:[]},
          ]});
          if(result?.ok!==true||!['sent','queued'].includes(result.delivery))throw new Error('unconfirmed');
          await kv.set(key,{...record,state:'delivered_unverified',delivery:result.delivery,queuedMessageId:result.queuedMessage?.id||null,confirmedAt:now()});
          return {isError:false,requestKey,delivery:result.delivery};
        }catch{
          // Even a rejected/lost response may have reached the target. Retain
          // possibly_delivered and require a separate exact-target readback.
          throw new Error('REEL_BB_HANDOFF_UNCERTAIN_RECONCILE_EXACT_REQUEST');
        }
      });
    },
    async receipts({sessionId,bindingToken}){
      const value=session(sessionId,bindingToken);await validate(value);
      const keys=(await kv.list(PREFIX)).slice(-200);
      const records=await Promise.all(keys.map(key=>kv.get(key)));
      return {receipts:records.filter(r=>r&&r.destinationFingerprint===value.destination.fingerprint).sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(r=>({requestKey:r.requestKey,state:r.state,delivery:r.delivery||null,createdAt:r.createdAt}))};
    },
    async reconcile({sessionId,bindingToken,requestKey}){
      return exclusively(async()=>{
        const value=session(sessionId,bindingToken);await validate(value);
        const key=PREFIX+requestKey,record=await kv.get(key);
        if(!record||record.destinationFingerprint!==value.destination.fingerprint)throw new Error('REEL_BB_HANDOFF_RECEIPT_NOT_FOUND');
        if(record.state==='delivered_unverified')return {requestKey,state:record.state,found:true};
        const [history,queued]=await Promise.all([sdk().threads.promptHistory({threadId:record.threadId,limit:'100'}),sdk().threads.queuedMessages.list({threadId:record.threadId})]);
        const hasMarker=input=>Array.isArray(input)&&input.some(part=>part.type==='text'&&typeof part.text==='string'&&part.text.startsWith(record.marker+'\n'));
        const found=history.some(item=>hasMarker(item.input))||queued.some(item=>hasMarker(item.content));
        if(found)await kv.set(key,{...record,state:'delivered_unverified',delivery:'readback',confirmedAt:now()});
        // A bounded history miss is never evidence of non-delivery and never
        // clears the fence. Reconcile the exact thread manually if absent.
        return {requestKey,state:found?'delivered_unverified':'possibly_delivered',found};
      });
    },
    toolsForThread(ctx){
      const configured=ctx.pluginMetadata?.reelHandoffRecipient;
      if(!configured||typeof configured!=='object'||Array.isArray(configured)||ctx.provider.id!=='codex')return {tools:[],skills:[]};
      const identity={threadId:ctx.thread.id,projectId:ctx.project.id,environmentId:ctx.environment.id,hostId:ctx.host.id,path:ctx.environment.path,providerId:ctx.provider.id,visibility:'visible'};
      const selected=configured.fingerprint===hash(identity);
      return {tools:selected?[...WORKER_TOOLS]:[],skills:[],...(selected?{instructions:'Reel Studio requests are bound to an exact persisted requestKey and this thread/project/host/workspace. Before any account or publication action call bb_reel_handoff_read. Use bb_reel_handoff_record only for real observations and the exact frozen target. Never take an assigned producer claim, change paused work, guess an account, replay an uncertain action or infer public success from delivery.'}:{})};
    },
    async workerRead({requestKey,studioProjectId=''},ctx){
      const record=await workerReceipt(requestKey,ctx);
      if(studioProjectId&&record.context.tool!=='reel_release_plan_dispatch_prepare')throw new Error('REEL_BB_RELEASE_PROJECT_SELECTOR_NOT_APPLICABLE');
      const scope=await liveScope(record,studioProjectId);
      const operations=await reconcileRecords(record,scope);
      if(record.context.connection&&scope.connection.account!==record.context.connection.account){
        const keys=(await kv.list(RESULT_PREFIX+requestKey+':')).slice(0,500),saved=await Promise.all(keys.map(key=>kv.get(key)));
        if(!saved.some(operation=>operation?.tool==='reel_connection_record'&&recordMatches(operation,scope)))throw new Error('REEL_BB_FROZEN_CONNECTION_CHANGED');
      }
      if(record.state==='possibly_delivered')await kv.set(PREFIX+requestKey,{...record,state:'delivered_unverified',delivery:'worker_readback',confirmedAt:now()});
      const live=scope.plan?{plan:{...scope.plan,items:scope.plan.items.map(({job,resultHistory,...item})=>item)},jobs:scope.jobs}:scope;
      const response={requestKey,context:record.context,live,resultOperations:operations,deliveryDoesNotProvePublication:true,...(scope.plan?{releaseRead:'The plan overview does not authorize an upload. Call bb_reel_handoff_read again with this requestKey and one exact studioProjectId from this frozen plan to read and validate that item’s immutable publication job before acting.'}:{}),...(record.context.connection?.channel==='youtube'&&record.context.connection.account.startsWith('@')?{handleVerification:'For a saved YouTube handle, observe that exact handle and its matching immutable UC channel in the same authenticated session. Pass observedSavedAccount equal to the saved handle alongside result. This wrapper field is not forwarded to the original tool.'}:{})};
      if(Buffer.byteLength(JSON.stringify(response))>128*1024)throw new Error('REEL_BB_HANDOFF_WORKER_CONTEXT_TOO_LARGE');
      return response;
    },
    async workerRecord({requestKey,result,observedSavedAccount=''},ctx){
      return exclusively(async()=>{
        const record=await workerReceipt(requestKey,ctx),context=record.context;
        if(!result||typeof result!=='object'||Array.isArray(result)||Buffer.byteLength(JSON.stringify(result))>20*1024)throw new Error('REEL_BB_HANDOFF_RESULT_INVALID');
        const args=copy(result);let tool;
        if(context.tool==='reel_account_verify_prepare'){
          tool='reel_connection_record';
          const frozen=context.connection;
          const handleToImmutable=frozen.channel==='youtube'&&frozen.account.startsWith('@')&&observedSavedAccount===frozen.account&&['needs_verification','export_only'].includes(frozen.status)&&/^UC[A-Za-z0-9_-]{22}$/.test(args.account||'');
          if(args.connectionId!==context.arguments.connectionId||args.channel!==frozen.channel||args.account!==frozen.account&&!handleToImmutable)throw new Error('REEL_BB_HANDOFF_RESULT_ACCOUNT_MISMATCH');
        }else if(context.tool==='reel_browser_prepare'){
          tool='reel_publication_result';
          if(args.attemptId!==context.attempt.id||args.executionToken!==undefined||args.observedAccount!==undefined&&args.observedAccount!==context.attempt.target)throw new Error('REEL_BB_HANDOFF_RESULT_ATTEMPT_MISMATCH');
        }else{
          tool='reel_release_plan_result';
          const item=context.plan.items.find(item=>item.projectId===args.projectId);
          if(args.planId!==context.plan.id||!item||args.attemptId!==item.attemptId||args.executionToken!==undefined||args.observedAccount!==undefined&&args.observedAccount!==context.plan.target)throw new Error('REEL_BB_HANDOFF_RESULT_RELEASE_ITEM_MISMATCH');
        }
        const operationKey=hash({requestKey,tool,arguments:args}),key=RESULT_PREFIX+requestKey+':'+operationKey,previous=await kv.get(key);
        if(previous?.state==='independently_verified')return {operationKey,state:previous.state,duplicate:true};
        const scope=await liveScope(record,tool==='reel_release_plan_result'?args.projectId:null);
        if(previous){
          if(recordMatches(previous,scope)){await kv.set(key,{...previous,state:'independently_verified',verifiedAt:now()});return {operationKey,state:'independently_verified',readback:true};}
          throw new Error('REEL_BB_HANDOFF_RESULT_UNCERTAIN_RECONCILE_SAME_REQUEST');
        }
        const prior=await reconcileRecords(record,scope);
        if(prior.some(operation=>operation.state==='possibly_delivered'))throw new Error('REEL_BB_HANDOFF_RESULT_UNCERTAIN_RECONCILE_SAME_REQUEST');
        if(prior.length>=500)throw new Error('REEL_BB_HANDOFF_RESULT_LIMIT_RECONCILE_EXISTING_RECEIPTS');
        if(context.connection&&scope.connection.account!==context.connection.account)throw new Error('REEL_BB_FROZEN_CONNECTION_CHANGED');
        const operation={operationKey,requestKey,tool,arguments:args,state:'possibly_delivered',createdAt:now()};
        await kv.set(key,operation);
        try{
          if(ctx.signal?.aborted)throw new Error('aborted');
          const data=await native(tool,args);
          if(!data.connection&&!data.attempt&&!data.result)throw new Error('missing receipt');
          const readback=await liveScope(record,tool==='reel_release_plan_result'?args.projectId:null);
          if(!recordMatches(operation,readback))throw new Error('exact result not observed');
          const receipt={tool,requestKey,fields:args,observedAt:now()};
          await kv.set(key,{...operation,state:'independently_verified',receipt,verifiedAt:now()});
          return {operationKey,state:'independently_verified',receipt};
        }catch{throw new Error('REEL_BB_HANDOFF_RESULT_UNCERTAIN_RECONCILE_SAME_REQUEST');}
      });
    },
    dispose(){disposed=true;sessions.clear();},
  };
}
