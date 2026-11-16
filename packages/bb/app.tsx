import React,{useEffect,useRef,useState} from 'react';
import {definePluginApp,experimental_useCodeTheme,useBbContext,useBbNavigate,useRpc,useSdk} from '@get-bb/plugin-sdk/app';
import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {PluginNavPanelProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './contract';
import './styles.css';

type Destination={threadId:string;title:string;projectId:string;projectName:string;hostId:string;hostName:string;path:string;providerId:'codex';status:'idle'|'active';fingerprint:string};
type Host={id:string;name:string;status:'connected'|'disconnected';active:boolean};
type Binding={sessionId:string;bindingToken:string};
type Receipt={requestKey:string;state:'possibly_delivered'|'delivered_unverified';delivery:string|null;createdAt:number};
function errorText(error:unknown){
 const value=error instanceof Error?error.message:String(error);
 if(value.includes('UNCERTAIN'))return 'Delivery is uncertain. Reconcile this exact request before taking further action.';
 if(value.includes('DESTINATION'))return 'The selected chat or its computer is unavailable or has changed. Refresh the choices and select it again.';
 return value;
}
function Sidebar({subPath}:PluginNavPanelProps){
 const navigate=useBbNavigate();
 return <aside className="reel-studio-sidebar" aria-label="Reel Studio"><strong>Reel Studio</strong><nav aria-label="Studio sections">
  <button type="button" aria-current={!subPath?'page':undefined} onClick={()=>navigate.toPluginPanel('studio')}>Workspace</button>
  <button type="button" aria-current={subPath==='settings'?'page':undefined} onClick={()=>navigate.toPluginPanel('studio',{subPath:'settings'})}>Main chat</button>
 </nav></aside>;
}
function ReelStudio({subPath}:PluginNavPanelProps){
 const rpc=useRpc<typeof rpcContract>(),sdk=useSdk(),context=useBbContext(),theme=experimental_useCodeTheme();
 const rpcRef=useRef(rpc);rpcRef.current=rpc;
 const themeRef=useRef(theme.mode);themeRef.current=theme.mode;
 const frame=useRef<HTMLIFrameElement>(null),bridgeRef=useRef<AppBridge|null>(null),binding=useRef<Binding|null>(null),session=useRef(crypto.randomUUID());
 const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[projectId,setProjectId]=useState('');
 const [hosts,setHosts]=useState<Host[]>([]),[hostId,setHostId]=useState(''),[primaryHostId,setPrimaryHostId]=useState<string|null>(null);
 const [destinations,setDestinations]=useState<Destination[]>([]),[selected,setSelected]=useState(''),[destination,setDestination]=useState<Destination|null>(null),[receipts,setReceipts]=useState<Receipt[]>([]);
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState(''),[state,setState]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0),[bounded,setBounded]=useState(false),[choicesAttempt,setChoicesAttempt]=useState(0);
 const preferredThread=useRef<string|null>(null);
 const refreshReceipts=async()=>{if(binding.current)setReceipts((await rpcRef.current.call('handoffReceipts',binding.current)).receipts);};

 useEffect(()=>{
  let disposed=false;
  const load=async()=>{
   const [projectRows,hostRows,config]=await Promise.all([sdk.projects.list({includePersonal:true}),sdk.hosts.list(),sdk.system.config()]);
   if(projectRows.length>500||hostRows.length>500)throw new Error('The project or computer list exceeds the supported size.');
   let preferredHostId=config.primaryHostId;
   // Current context suggests a choice; the server verifies it and binding
   // still requires the explicit Use this chat action.
   if(context.threadId){
    try{
     const thread=await sdk.threads.get({threadId:context.threadId});
     if(thread.projectId===context.projectId&&thread.providerId==='codex'&&thread.environmentId){
      const environment=await sdk.environments.get({environmentId:thread.environmentId});
      preferredHostId=environment.hostId;preferredThread.current=thread.id;
     }
    }catch{/* An unavailable context must not prevent explicit selection. */}
   }
   if(disposed)return;
   setProjects(projectRows.map(({id,name})=>({id,name})));
   setHosts(hostRows.map(h=>({id:h.id,name:h.name,status:h.status,active:h.lifecycle.phase==='active'})));
   setPrimaryHostId(config.primaryHostId);
   const connected=hostRows.filter(h=>h.status==='connected'&&h.lifecycle.phase==='active');
   const suggestedHost=connected.some(h=>h.id===preferredHostId)?preferredHostId:connected.length===1?connected[0].id:'';
   setHostId(current=>hostRows.some(h=>h.id===current)?current:suggestedHost||'');
   const suggestedProject=context.projectId&&projectRows.some(p=>p.id===context.projectId)?context.projectId:projectRows.length===1?projectRows[0].id:'';
   setProjectId(current=>projectRows.some(p=>p.id===current)?current:suggestedProject);
  };
  void load().catch(e=>{if(!disposed)setProblem(errorText(e));});
  return()=>{disposed=true;};
 },[sdk,context.projectId,context.threadId,choicesAttempt]);

 useEffect(()=>{
  let disposed=false;
  setDestinations([]);setSelected('');setBounded(false);
  if(!projectId||!hostId||binding.current)return;
  setBusy(true);setProblem('');
  void rpcRef.current.call('destinations',{projectId,hostId}).then(result=>{
   if(disposed)return;
   setDestinations(result.destinations);setBounded(result.bounded);
   const preferred=result.destinations.find(d=>d.threadId===preferredThread.current);
   if(preferred)setSelected(preferred.threadId);
   else if(result.destinations.length===1)setSelected(result.destinations[0].threadId);
  }).catch(e=>{if(!disposed)setProblem(errorText(e));}).finally(()=>{if(!disposed)setBusy(false);});
  return()=>{disposed=true;};
 },[projectId,hostId,choicesAttempt]);

 const bind=async()=>{
  const target=destinations.find(d=>d.threadId===selected&&d.projectId===projectId&&d.hostId===hostId);
  if(!target)return;
  setBusy(true);setProblem('');
  try{
   const result=await rpcRef.current.call('bindDestination',{sessionId:session.current,threadId:target.threadId,projectId:target.projectId,hostId:target.hostId,fingerprint:target.fingerprint});
   binding.current={sessionId:session.current,bindingToken:result.bindingToken};setDestination(result.destination);await refreshReceipts();
  }catch(e){setProblem(errorText(e));}finally{setBusy(false);}
 };
 const changeDestination=()=>{
  binding.current=null;session.current=crypto.randomUUID();setDestination(null);setReceipts([]);setProblem('');setChoicesAttempt(n=>n+1);
 };
 const reconcile=async(requestKey:string)=>{
  if(!binding.current)return;
  setBusy(true);
  try{
   const result=await rpcRef.current.call('reconcileHandoff',{...binding.current,requestKey});await refreshReceipts();
   if(!result.found)setProblem('The request was not found in bounded history. Delivery remains uncertain; check the same chat manually.');
  }catch(e){setProblem(errorText(e));}finally{setBusy(false);}
 };
 useEffect(()=>{bridgeRef.current?.setHostContext({theme:theme.mode});},[theme.mode]);
 useEffect(()=>{
  let disposed=false,released=false;let bridge:AppBridge|undefined;setState('loading');setProblem('');
  const releaseBridge=()=>{if(released)return;released=true;if(bridgeRef.current===bridge)bridgeRef.current=null;void bridge?.close().catch(()=>{});};
  const connect=async()=>{try{
   const workspace=await rpcRef.current.call('workspace',null);if(disposed)return;
   const target=frame.current?.contentWindow;if(!target)throw new Error('Workspace is unavailable.');
   bridge=new AppBridge(null,{name:'Reel Studio in BB',version:'0.3.0'},{serverTools:{},serverResources:{},message:{text:{}},updateModelContext:{text:{},structuredContent:{}}},{hostContext:{theme:themeRef.current,displayMode:'fullscreen',availableDisplayModes:['fullscreen'],platform:'web',locale:'en'}});bridgeRef.current=bridge;
   bridge.oncalltool=async params=>{
    if(disposed||released)throw new Error('Panel closed.');
    try{return await rpcRef.current.call('callTool',{name:params.name,arguments:params.arguments,...(binding.current?{binding:binding.current}:{})}) as CallToolResult;}
    catch(e){const message=errorText(e);return {isError:true,structuredContent:{error:message},content:[{type:'text',text:message}]};}
   };
   bridge.onreadresource=params=>rpcRef.current.call('readMedia',{uri:params.uri});
   bridge.onmessage=async message=>{
    if(disposed||released)throw new Error('Panel closed.');
    if(!binding.current)return {isError:true,error:'Choose a main chat in Main chat settings first. Selecting a chat sends nothing.'};
    try{const result=await rpcRef.current.call('sendHandoff',{...binding.current,message});void refreshReceipts().catch(()=>{});return {isError:result.isError};}
    catch(e){const text=errorText(e);setProblem(text);void refreshReceipts().catch(()=>{});return {isError:true,error:text};}
   };
   bridge.onupdatemodelcontext=async()=>({});
   bridge.oninitialized=async()=>{if(!disposed&&!released&&bridge){await bridge.sendToolInput({arguments:{}});if(!disposed&&!released)setState('ready');}};
   bridge.onerror=()=>{if(!disposed&&!released){setProblem('The workspace connection was interrupted. Check the original task before repeating an action.');setState('error');releaseBridge();}};
   await bridge.connect(new PostMessageTransport(target,target));
   if(disposed||released){releaseBridge();return;}
   // The theme may change during either asynchronous connection step.
   bridge.setHostContext({theme:themeRef.current});
   if(frame.current)frame.current.srcdoc=workspace.html;
  }catch(e){if(!disposed){setProblem(errorText(e));setState('error');}releaseBridge();}};
  void connect();return()=>{disposed=true;releaseBridge();};
 },[attempt]);

 const preview=destinations.find(d=>d.threadId===selected&&d.hostId===hostId&&d.projectId===projectId);
 return <section className="reel-bb-panel" aria-label="Reel Studio"><main className="reel-studio-workspace">
  {subPath==='settings'&&<section className="reel-bb-handoff" aria-label="Main chat settings">
   <header><p className="reel-bb-eyebrow">Settings</p><h1>Main chat</h1><p>Choose the existing BB Codex chat that receives prepared Reel Studio requests.</p></header>
   {destination?<>
    <div className="reel-bb-destination"><h2>{destination.title}</h2><dl><dt>Computer or server</dt><dd>{destination.hostName}</dd><dt>Project</dt><dd>{destination.projectName}</dd><dt>Workspace</dt><dd><code>{destination.path}</code></dd><dt>Chat ID</dt><dd><code>{destination.threadId}</code></dd></dl></div>
    <p>This chat is selected for this panel session. Requests are sent only when you use an explicit Studio send action.</p>
    <div className="reel-bb-actions"><button type="button" disabled={busy} onClick={changeDestination}>Change main chat</button><button type="button" disabled={busy} onClick={()=>void refreshReceipts().catch(e=>setProblem(errorText(e)))}>Refresh receipts</button></div>
    <details><summary>Delivery receipts ({receipts.length})</summary><p>A delivery receipt does not prove publication. Previous requests remain tied to their original chat.</p>{receipts.length===0?<p>No requests recorded for this chat.</p>:<ul>{receipts.map(r=><li key={r.requestKey}><code>{r.requestKey.slice(0,12)}</code> · {r.state==='possibly_delivered'?'delivery uncertain':'delivered to BB, not independently verified'}{r.state==='possibly_delivered'&&<button type="button" disabled={busy} onClick={()=>void reconcile(r.requestKey)}>Reconcile request</button>}</li>)}</ul>}</details>
   </>:<>
    <div className="reel-bb-fields"><label htmlFor="reel-host">Computer or server</label><select id="reel-host" value={hostId} disabled={busy} onChange={e=>{preferredThread.current=null;setHostId(e.target.value);}}><option value="">Choose a connected computer</option>{hosts.map(h=><option key={h.id} value={h.id} disabled={h.status!=='connected'||!h.active}>{h.name}{h.id===primaryHostId?' · primary computer':''}{h.status!=='connected'?' · disconnected':!h.active?' · unavailable':''}</option>)}</select>
     <label htmlFor="reel-project">Project</label><select id="reel-project" value={projectId} disabled={busy} onChange={e=>{preferredThread.current=null;setProjectId(e.target.value);}}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
     <label htmlFor="reel-destination">Main chat</label><select id="reel-destination" value={selected} disabled={busy||!projectId||!hostId} onChange={e=>setSelected(e.target.value)}><option value="">Choose an existing Codex chat</option>{destinations.map(d=><option key={d.threadId} value={d.threadId}>{d.title} · {d.status}</option>)}</select>
    </div>
    {preview&&<p className="reel-bb-destination"><strong>{preview.title}</strong><br/>{preview.hostName} · {preview.projectName}<br/><code>{preview.path}</code></p>}
    <p>Choosing or saving a main chat creates no chat and sends no task. Your current project and chat are suggested when eligible.</p>
    <div className="reel-bb-actions"><button type="button" disabled={busy||!preview} onClick={()=>void bind()}>Use this chat</button><button type="button" disabled={busy} onClick={()=>setChoicesAttempt(n=>n+1)}>Refresh choices</button></div>
    {bounded&&<p>The list is limited. Some eligible chats may not be shown.</p>}
    {projectId&&hostId&&!busy&&destinations.length===0&&<p>No eligible Codex chat was found for this project on the selected computer. The chat and its workspace must be active and connected.</p>}
   </>}
   <p className="reel-bb-note">Connected remote computers can receive prepared requests. Browser access, signed-in accounts and approved media must already be available in that chat’s own environment; selecting a remote chat does not transfer them. Independent production and private producer integrations are not included in this public adapter.</p>
  </section>}
  {problem&&<p className="reel-bb-handoff-error" role="alert">{problem}</p>}
  {state==='loading'&&<p role="status">Connecting to Reel Studio…</p>}
  {state==='error'&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Reopen workspace</button>}
  <iframe hidden={subPath==='settings'} ref={frame} className="reel-bb-frame" title="Reel Studio" sandbox="allow-scripts" referrerPolicy="no-referrer" aria-busy={state==='loading'}/>
 </main></section>;
}
export default definePluginApp(app=>{app.slots.navPanel({id:'studio',title:'Reel Studio',icon:'Clapperboard',path:'studio',component:ReelStudio,experimental_sidebar:Sidebar});});
