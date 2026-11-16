import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync,copyFileSync,statSync,lstatSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {join,resolve,extname,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DEFAULT_EXAMPLE_PROFILE,validateProductionProfile,validatePublicationCopy} from './production-profiles.mjs';
import {buildReleasePlan,validateScheduleEvidence,recordPublicEvidence} from './release-plans.mjs';
import {ensureLines,lineForProject,assertLineActive,lineMethods,assertExecution} from './production-lines.mjs';
import {assertAdmission,assertOwner,ownerTuple,authorityHash,fingerprint,uuid,validateBBRuntime} from './owner-authority.mjs';
import {externalJobMethods} from './external-jobs.mjs';
import {parsePcmWav} from './speech-providers.mjs';

export const digest=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const now=()=>new Date().toISOString();
const clone=x=>structuredClone(x);
const defaultCaptionLanguages=['en','es','pt-BR','fr','ru'];
export function captionCues(buffer,duration){
 const blocks=buffer.toString('utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n\s*\r?\n/);let previousEnd=0;
 if(!blocks.length||!blocks[0])throw new Error('Caption SRT has no cues');
 for(const block of blocks){const lines=block.split(/\r?\n/);if(!/^\d+$/.test(lines.shift()||''))throw new Error('Caption cue index is invalid');const m=/^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines.shift()||'');if(!m||!lines.join('\n').trim())throw new Error('Caption cue text or timings are invalid');const at=i=>Number(m[i])*3600000+Number(m[i+1])*60000+Number(m[i+2])*1000+Number(m[i+3]),start=at(1),end=at(5);if(end<=start||start<previousEnd||end>duration*1000+50)throw new Error('Caption timings are invalid or exceed video duration');previousEnd=end;}
 return blocks.length;
}
function verifiedConnection(s,plan){const c=s.accounts.find(x=>x.id===plan.connectionId&&!x.archived&&x.channel==='youtube');if(!c||c.method!=='browser'||c.status!=='browser_verified'||c.account!==plan.target||!Number.isFinite(Date.parse(c.verifiedAt))||Date.now()-Date.parse(c.verifiedAt)>7*86400000)throw new Error('YouTube connection is not freshly verified');return c;}
export const platformCopy=(metadata,channel)=>metadata.platforms?.[channel]||{title:metadata.title,caption:metadata.caption,hashtags:metadata.hashtags,evidence:metadata.evidence};
const legacyAccountId=(channel,account)=>{const h=digest({channel,account});return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
function migrate(s){
 s.accounts??=Object.entries(s.connections||{}).filter(([,c])=>c.account).map(([channel,c])=>({...c,id:legacyAccountId(channel,c.account),channel,label:c.label||c.account,method:'browser',market:2840,language:'en',archived:false}));
 s.profiles??=[];s.releasePlans??=[];s.schema=4;ensureLines(s);return s;
}
function validatePublicationResult(attempt,a){
 const rank={not_delivered:0,possibly_delivered:1,delivered_unverified:2,independently_verified:3};
 if(rank[a.effect]<rank[attempt.effect]||attempt.status==='published'&&a.status!=='published')throw new Error('A publication result cannot move backward');
 if(a.effect!=='independently_verified')return;
 if(a.status!=='published')throw new Error('Only a public release can be independently verified');
 if(!a.url)throw new Error('An exact public post URL is required');
 const u=new URL(a.url),c=attempt.channel;
 const correct=c==='tiktok'?u.hostname==='www.tiktok.com'&&u.pathname.startsWith('/'+attempt.target+'/video/'):c==='youtube'?['youtube.com','www.youtube.com'].includes(u.hostname)&&(/^\/shorts\/[A-Za-z0-9_-]{11}$/.test(u.pathname)||u.pathname==='/watch'&&/^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get('v')||'')):c==='instagram'?['instagram.com','www.instagram.com'].includes(u.hostname)&&/^\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname):false;
 if(!correct||c!=='tiktok'&&a.observedAccount!==attempt.target)throw new Error('Verify the exact post and its selected account identity');
}
function nativeJobCurrent(s,p,jobId){
 const j=p.jobs.find(j=>j.id===jobId);if(!j)throw new Error('Job not found');
 const line=lineForProject(s,p);
 if(j.external||line&&(j.lineId!==line.id||j.lineGeneration!==line.generation))throw new Error('This native job belongs to a previous production owner or is an external admission.');
 if(line&&j.lineOwner)assertOwner(line,j.lineOwner);
 return j;
}
function importJobBinding(s,p,line,artifact,proof){
 if(!artifact.externalJob)return null;
 const binding=artifact.externalJob,j=p.jobs.find(j=>j.id===binding.jobId);
 if(!line?.admissionVersion||!uuid(binding.jobId)||!uuid(binding.requestKey)||!j?.external||j.requestKey!==binding.requestKey||j.lineId!==line.id||j.lineGeneration!==line.generation||j.computeTarget!==line.ownerHost||j.status!=='running')throw new Error('Import requires the exact running external job in this project and production generation.');
 assertOwner(line,j.external.owner);
 if(authorityHash(j.external.owner)!==authorityHash(artifact.owner))throw new Error('The imported result does not belong to this external job owner.');
 const expected={jobId:j.id,requestKey:j.requestKey,payloadHash:j.external.payloadHash};
 if(authorityHash(proof?.externalJob)!==authorityHash(expected))throw new Error('Trusted import context does not match the admitted external job.');
 const target=j.computeTarget;
 if(s.projects.some(q=>q.jobs.some(other=>!(q.id===p.id&&other.id===j.id)&&['starting','running','uncertain','cancel_requested'].includes(other.status)&&(q.id===p.id||!target||!other.computeTarget||other.computeTarget===target))))throw new Error('Another active or uncertain job still holds this computer.');
 return expected;
}
export const seedTemplates=[
 {id:'kinetic',name:'Kinetic Promo',skill:'kinetic-promo-video',tag:'Type in motion',description:'Bold typography, depth, sound and rhythmic editing.',color:'#d7ff66',instructions:'An original promo: one idea per scene, a clear opening and a precise final invitation.',builtIn:true},
 {id:'portfolio',name:'Portfolio Showreel',skill:'portfolio-showreel-video',tag:'Your work in focus',description:'Website flyovers, page scrolls, branding and details.',color:'#a6c7ff',instructions:'Show the work clearly: alternate a grid, a flyover, a detail and a readable pause.',builtIn:true}
];
const checkpointJob=j=>j?.status==='dependency_checkpoint'||j?.outcome?.schema==='reel-native-job-outcome/v1';
const assertMutableJob=j=>{if(checkpointJob(j))throw new Error('This dependency checkpoint job is terminal; a separately supported continuation is required.');};
function narrationFile(home,directory,name,path,maxBytes){
 if(typeof path!=='string'||path!==join(home,directory,name))throw new Error('Narration files must use the exact owning Studio folder and receipt filename');
 const folder=join(home,directory);if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory()||lstatSync(path).isSymbolicLink())throw new Error('Narration files and folders cannot be symlinks');
 const canonical=join(realpathSync(home),directory,name);if(realpathSync(path)!==canonical)throw new Error('Narration file escaped the owning Studio folder');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=fstatSync(fd);if(!st.isFile()||st.size<1||st.size>maxBytes)throw new Error('Narration artifact must be a bounded regular file');const bytes=readFileSync(fd);const after=lstatSync(path);if(after.isSymbolicLink()||after.dev!==st.dev||after.ino!==st.ino||realpathSync(path)!==canonical||fstatSync(fd).size!==bytes.length)throw new Error('Narration artifact changed during validation');return bytes;}finally{closeSync(fd);}
}
function narrationReference(home,receipt){
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.status!=='complete'||receipt.effect!=='independently_verified')throw new Error('Assign only an independently verified completed narration receipt');
 if(typeof receipt.requestKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(receipt.requestKey)||typeof receipt.id!=='string'||!/^[a-f0-9]{32}$/.test(receipt.id)||typeof receipt.sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.mediaId!==`speech-${receipt.id}`||!Number.isFinite(receipt.duration)||receipt.duration<=0)throw new Error('Narration receipt identity, media or duration is invalid');
 const file=receipt.file||receipt.audioPath;if(receipt.file&&receipt.audioPath&&receipt.file!==receipt.audioPath)throw new Error('Narration receipt audio paths conflict');
 const bytes=narrationFile(home,'speech-audio',receipt.id+'.wav',file,128*1024*1024);if(digest(bytes)!==receipt.sha256)throw new Error('Narration audio SHA-256 does not match its receipt');
 if(Math.abs(parsePcmWav(bytes).duration-receipt.duration)>0.000001)throw new Error('Narration audio duration does not match its receipt');
 const timingsPath=receipt.timingsPath||receipt.wordTimingsPath;if(receipt.timingsPath&&receipt.wordTimingsPath&&receipt.timingsPath!==receipt.wordTimingsPath)throw new Error('Narration receipt timing paths conflict');
 let timingsSha256;
 if(timingsPath){const timingBytes=narrationFile(home,'narration',receipt.id+'.words.json',timingsPath,4*1024*1024);timingsSha256=digest(timingBytes);if(receipt.timingsSha256&&receipt.timingsSha256!==timingsSha256)throw new Error('Narration word timing SHA-256 does not match');const timings=JSON.parse(timingBytes.toString('utf8'));if(timings.unit!=='milliseconds'||!Array.isArray(timings.words)||!timings.words.length||timings.words.some(w=>typeof w?.text!=='string'||!Number.isFinite(w.offset)||w.offset<0||!Number.isFinite(w.duration)||w.duration<0||w.offset+w.duration>receipt.duration*1000+100))throw new Error('Narration word timings are invalid');}
 if(receipt.hasWordTimings&&!timingsPath)throw new Error('Narration receipt is missing its word timing artifact');
 return {requestKey:receipt.requestKey,id:receipt.id,status:'complete',effect:'independently_verified',sha256:receipt.sha256,file,duration:receipt.duration,bytes:bytes.length,mediaId:receipt.mediaId,...(timingsPath?{timingsPath,timingsSha256}: {})};
}
const publicNarration=reference=>{if(!reference)return reference;const {file,audioPath,timingsPath,wordTimingsPath,...safe}=reference;return safe;};
export class StudioStore{
 constructor(home,{authorityVerifier,requireExisting=false}={}){this.authorityVerifier=authorityVerifier;this.requireExisting=requireExisting;this.home=resolve(home);this.path=join(this.home,'state.json');if(requireExisting){this.read();return;}mkdirSync(this.home,{recursive:true,mode:0o700});for(const x of ['jobs','media','exports'])mkdirSync(join(this.home,x),{recursive:true,mode:0o700});if(!existsSync(this.path))this.tx(s=>s);}
 empty(){return {schema:4,revision:0,productionLines:[],templates:clone(seedTemplates),profiles:[],releasePlans:[],projects:[],attempts:[],connections:{},accounts:[],createdAt:now()};}
 read(){if(this.requireExisting){const fd=openSync(this.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=fstatSync(fd);if(!st.isFile()||st.size>33554432)throw new Error('The existing Studio Store is not a bounded regular file.');return migrate(JSON.parse(readFileSync(fd,'utf8')));}finally{closeSync(fd);}}return migrate(existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):this.empty());}
 tx(fn,{readOnly=false}={}){const lock=join(this.home,'.write-lock');try{mkdirSync(lock);}catch{throw new Error('Studio is saving. Refresh before trying again.');}try{const s=this.read();const out=fn(s);if(readOnly)return clone(out);s.revision++;s.updatedAt=now();const tmp=this.path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(s,null,2),{mode:0o600});renameSync(tmp,this.path);return clone(out);}finally{rmSync(lock,{recursive:true,force:true});}}
 get(id){const p=this.read().projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');return p;}
 nativeJobRead(id,jobId){const s=this.read(),p=s.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');return {project:p,job:nativeJobCurrent(s,p,jobId)};}
 verifyJobNarration(id,jobId){const s=this.read(),p=s.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');const job=nativeJobCurrent(s,p,jobId);assertMutableJob(job);if(!['starting','running'].includes(job.status))throw new Error('Only an active admitted native job can consume its frozen narration');return job.narration?narrationReference(this.home,job.narration):null;}
 projectAdmission(id,owner,purpose,request){return this.tx(s=>{const p=s.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');const line=lineForProject(s,p),proof=assertAdmission(this,s,line,owner,purpose,request);return {project:p,line,runtime:proof?.runtime};},{readOnly:true});}
 create(a){return this.tx(s=>{if(s.productionLines.some(l=>(l.managedCreateRetirements||[]).some(r=>r.requestKey===a.requestKey)))throw new Error('This CREATE request key was retired without admission and cannot be reused.');const old=s.projects.find(p=>p.requestKey===a.requestKey);const line=a.productionLineId?s.productionLines.find(l=>l.id===a.productionLineId):old?lineForProject(s,old):null;if(a.productionLineId&&!line)throw new Error('Production direction not found');assertAdmission(this,s,line,a.owner,'line_create_project',a);if(line?.admissionVersion)assertLineActive(line);if(old)return old;const t=line?.recipe.template||s.templates.find(t=>t.id===a.templateId);if(!t)throw new Error('Template not found');const profile=line?.admissionVersion&&a.profileId?s.profiles.find(p=>p.id===a.profileId):line?.recipe.profile||(a.profileId?s.profiles.find(p=>p.id===a.profileId):null);if(a.profileId&&!profile)throw new Error('Profile not found');if(line?.admissionVersion&&(a.expectedLineRevision!==line.revision||profile&&(a.expectedProfileRevision!==profile.revision||s.profiles.find(current=>current.id===profile.id)?.revision!==a.expectedProfileRevision)||!profile&&a.expectedProfileRevision!==undefined))throw new Error('The direction or current production profile changed. Refresh before reserving a project.');if(profile&&(a.model!==profile.model.name||a.effort!==profile.model.effort))throw new Error('Selected model and effort must match the production profile');const p={id:randomUUID(),requestKey:a.requestKey,title:a.title.trim(),idea:a.idea.trim(),template:clone(t),model:a.model,effort:a.effort,duration:a.duration,language:a.language,status:'draft',revision:1,versions:[],uploads:[],jobs:[],createdAt:now(),updatedAt:now(),...(a.computeTarget?{computeTarget:a.computeTarget}:{}),...(profile?{productionProfile:clone(profile),topic:a.topic||a.idea,keyPhrase:a.keyPhrase||a.title}: {}),...(line?{productionLineId:line.id,lineGeneration:line.generation,computeTarget:line.ownerHost,recipeSha256:line.admissionVersion?digest({template:t,profile:profile||null}):line.recipe.sha256,queuePosition:Math.max(0,...s.projects.filter(x=>x.productionLineId===line.id).map(x=>x.queuePosition||0))+1,targets:{[line.channel]:line.connectionId}}:{})};s.projects.push(p);return p;});}
 mutate(id,fn,expected){return this.tx(s=>{const p=s.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');if(expected!==undefined&&p.revision!==expected)throw new Error('The project changed. Refresh before saving.');const out=fn(p,s);p.revision++;p.updatedAt=now();return out??p;});}
 begin(id,a){const {requestKey,feedback='',kind='video',versionId,research,computeTarget,owner,external,execution}=a;return this.mutate(id,(p,s)=>{
  if((p.managedRequestRetirements||[]).some(r=>r.requestKey===requestKey))throw new Error('This exact request was retired without admission. Its saved receipt must be preserved; the key cannot be reused.');
  const line=lineForProject(s,p),proof=assertAdmission(this,s,line,owner,'line_begin_job',{projectId:id,...a});
  const payloadHash=external||execution?authorityHash({projectId:id,...a}):null;
  if(external){
   if(!line?.admissionVersion||!uuid(requestKey)||external.bbThreadId!==line.ownerRuntime?.bbThreadId||!fingerprint(external.inputFingerprint)||typeof external.operation!=='string'||external.operation.length<1||external.operation.length>80)throw new Error('External BB work requires the transferred line owner and bounded input fingerprint.');
  }
  if(execution){
   if(!line?.admissionVersion||external)throw new Error('A job execution override is supported only for the transferred managed native producer.');
   validateBBRuntime({ownerHost:line.ownerHost,ownerThreadId:line.ownerThreadId,runtime:execution});
   if(authorityHash(execution)!==authorityHash(line.ownerRuntime)||authorityHash(proof?.execution)!==authorityHash(execution))throw new Error('The trusted producer execution route does not match the current direction owner.');
  }
  const existing=p.jobs.find(j=>j.requestKey===requestKey);
  if(existing){if(Boolean(existing.external)!==Boolean(external)||Boolean(existing.execution)!==Boolean(execution)||external&&existing.external.payloadHash!==payloadHash||execution&&existing.executionPayloadHash!==payloadHash)throw new Error('This job request key belongs to a different payload.');return {...existing,reused:true};}
  if(a.expectedRevision!==undefined&&a.expectedRevision!==p.revision)throw new Error('The project changed. Refresh before starting a new job.');
  if(p.jobs.some(checkpointJob))throw new Error('This project has a dependency checkpoint; new Generate requests are held until a separately supported continuation.');
  assertLineActive(line);
  if(execution&&(a.expectedRevision!==p.revision||p.productionProfile&&a.expectedProfileRevision!==p.productionProfile.revision||!p.productionProfile&&a.expectedProfileRevision!==undefined))throw new Error('The project or frozen production profile changed. Refresh before admission.');
  if(!execution&&p.productionProfile&&(p.model!==p.productionProfile.model.name||p.effort!==p.productionProfile.model.effort))throw new Error('Selected model and effort must match the production profile');
  const target=line?.ownerHost||p.computeTarget||p.jobs.at(-1)?.computeTarget||computeTarget;
  // Native and BB both acquire this same project.jobs host slot under tx.
  if(s.projects.some(q=>q.jobs.some(j=>['starting','running','uncertain','cancel_requested'].includes(j.status)&&(q.id===p.id||!target||!j.computeTarget||j.computeTarget===target))))throw new Error('A job is already active on this computer or its host is unknown. Wait for completion or check its status.');
  const narration=p.narration?narrationReference(this.home,p.narration):null;
  if(target)p.computeTarget=target;
  const source=p.versions.find(v=>v.id===versionId)||p.versions.at(-1),job={id:randomUUID(),requestKey,feedback,kind,status:external?'running':'starting',startedAt:now(),events:[],...(external?{external:{...clone(external),payloadHash,owner:clone(owner),effect:'not_delivered',transitions:[]}}:{ownerPid:process.pid}),...(target?{computeTarget:target}:{}),...(line?{lineId:line.id,lineGeneration:line.generation,lineOwner:ownerTuple(line)}:{}),...(kind==='metadata'&&source?{sourceVersionId:source.id,sourceSha256:source.sha256,sourceMetadataHash:digest(source.metadata),sourceTargetsHash:digest(p.targets||{}),researchInput:research}: {})};
  if(execution)Object.assign(job,{execution:clone(execution),executionPayloadHash:payloadHash,model:execution.model,effort:execution.effort,modelProvider:execution.provider,requestedServiceTier:execution.serviceTier});
  if(narration)job.narration=clone(narration);
  job.dir=join(this.home,'jobs',job.id);mkdirSync(job.dir,{recursive:true});p.jobs.push(job);p.status='rendering';return job;
 });}
 job(id,jobId,fields){return this.mutate(id,(p,s)=>{const j=p.jobs.find(j=>j.id===jobId);if(!j)throw new Error('Job not found');assertMutableJob(j);const line=lineForProject(s,p);if(j.external)throw new Error('Use the bounded external job result/reconciliation transition.');if(line?.admissionVersion&&j.lineGeneration!==line.generation)throw new Error('This job belongs to a previous production generation.');if(j.execution&&(fields.modelProvider&&fields.modelProvider!==j.execution.provider||fields.model&&fields.model!==j.execution.model||fields.effort&&fields.effort!==j.execution.effort||fields.computeTarget&&fields.computeTarget!==j.execution.host||fields.threadId===j.execution.nativeThreadId||fields.permissions&&(fields.permissions.approvalPolicy!=='never'||fields.permissions.sandbox?.type!=='dangerFullAccess')))throw new Error('Native worker readback did not preserve the admitted execution route.');Object.assign(j,fields);if(fields.status==='completed')delete j.error;if(['failed','interrupted','uncertain'].includes(j.status))p.status=j.status==='uncertain'?'needs_attention':p.versions.length?'review':'failed';return j;});}
 event(id,jobId,event){return this.mutate(id,(p,s)=>{const j=p.jobs.find(j=>j.id===jobId);if(!j)return;assertMutableJob(j);const line=lineForProject(s,p);if(j.external||line?.admissionVersion&&j.lineGeneration!==line.generation)throw new Error('This job cannot advance the current production direction.');p.status='rendering';j.events.push({at:now(),...event});j.events=j.events.slice(-60);return j;});}
 upload(id,{name,data}){const ext=extname(name).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw new Error('Choose a PNG, JPG or WebP image');const b=Buffer.from(data,'base64');if(!b.length||b.length>10*1024*1024)throw new Error('The maximum image size is 10 MB');const valid=ext==='.png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':b[0]===255&&b[1]===216;if(!valid)throw new Error('File contents do not match its extension');return this.mutate(id,p=>{const a={id:randomUUID(),name:name.split(/[\\/]/).pop(),sha256:digest(b),bytes:b.length};a.path=join(this.home,'media',a.id+ext);writeFileSync(a.path,b,{mode:0o600});p.uploads.push(a);return a;});}
 assignNarration(id,receipt,expected){return this.mutate(id,(p,s)=>{
  // Managed directions have an explicit admission protocol. This ordinary
  // project editor cannot change their producer inputs or bypass that owner.
  if(p.productionLineId)throw new Error('Assign narration through the managed production direction owner and admission route');
  if(p.jobs.some(j=>['starting','running','uncertain','cancel_requested'].includes(j.status)||checkpointJob(j)))throw new Error('An active, uncertain or dependency checkpoint job holds this project; reconcile it before changing narration');
  const reference=receipt===null?null:narrationReference(this.home,receipt);
  if(reference){for(const project of s.projects)for(const old of [project.narration,...(project.narrationHistory||[])].filter(Boolean))if(old.requestKey===reference.requestKey&&digest(old)!==digest(reference))throw new Error('This narration requestKey belongs to a different immutable receipt payload');}
  if(digest(p.narration||null)!==digest(reference)){
   if(p.narration){p.narrationHistory??=[];p.narrationHistory.push(clone(p.narration));}
   if(reference)p.narration=reference;else delete p.narration;
   for(const version of p.versions)version.approval=null;
   p.status=p.versions.length?'review':'draft';
  }
  return p;
 },expected);}
 addVersion(id,jobId,artifact){return this.mutate(id,(p,s)=>{
  const j=p.jobs.find(j=>j.id===jobId);if(!j)throw new Error('Job not found');assertMutableJob(j);
  const line=lineForProject(s,p);if(j.external||line?.admissionVersion&&j.lineGeneration!==line.generation)throw new Error('Import through the current producer owner; this job cannot advance the direction.');
  if(j.versionId)return p.versions.find(v=>v.id===j.versionId);
  const src=realpathSync(artifact.path);if(!src.startsWith(realpathSync(j.dir)+sep))throw new Error('The video must belong to this job folder');
  const b=readFileSync(src),sha256=digest(b);
  const v={id:randomUUID(),number:p.versions.length+1,sha256,bytes:b.length,createdAt:now(),jobId,media:artifact.media,metadata:artifact.metadata||{title:p.title,caption:p.idea,hashtags:[],evidence:[]},productionEvidence:artifact.productionEvidence||[],checks:artifact.checks||[],approval:null,sourceDir:j.dir};
  v.path=join(this.home,'media',v.id+'.mp4');copyFileSync(src,v.path);p.versions.push(v);p.status='review';j.status='completed';j.versionId=v.id;j.completedAt=now();delete j.error;return v;
 });}
 importVersion(id,artifact,expected){
  const source=realpathSync(artifact.path),sourceDir=realpathSync(artifact.sourceDir);
  if(extname(source).toLowerCase()!=='.mp4'||!source.startsWith(sourceDir+sep))throw new Error('Choose an MP4 inside the selected source folder');
  const bytes=readFileSync(source),sha256=digest(bytes);
  if(sha256!==artifact.sha256)throw new Error('The file changed before import');
  return this.tx(s=>{
   const p=s.projects.find(p=>p.id===id);if(!p)throw new Error('Project not found');
   const line=lineForProject(s,p),proof=assertAdmission(this,s,line,artifact.owner,'line_import_version',{projectId:id,expectedRevision:expected,...artifact});if(line?.admissionVersion)assertLineActive(line);
   const externalJob=importJobBinding(s,p,line,artifact,proof);
   const duplicate=p.versions.find(v=>v.importKey===artifact.requestKey);if(duplicate){if(duplicate.sha256!==sha256||authorityHash(duplicate.externalJob||null)!==authorityHash(externalJob))throw new Error('This import key already belongs to a different file or external job');return {...duplicate,reused:true};}
   if(expected!==undefined&&p.revision!==expected)throw new Error('The project changed. Refresh before saving.');
   if(p.jobs.some(j=>['starting','running','uncertain','cancel_requested'].includes(j.status)&&j.id!==externalJob?.jobId))throw new Error('Check the current project job first');
   const v={id:randomUUID(),number:p.versions.length+1,sha256,bytes:bytes.length,createdAt:now(),media:artifact.media,metadata:artifact.metadata,checks:artifact.checks||[],productionEvidence:artifact.productionEvidence||[],approval:null,sourceDir,origin:'local_import',importKey:artifact.requestKey,...(externalJob?{externalJob}: {})};
   v.path=join(this.home,'media',v.id+'.mp4');writeFileSync(v.path,bytes,{mode:0o600});
   p.versions.push(v);p.status='review';p.revision++;p.updatedAt=now();return v;
  });
 }
 metadata(id,versionId,metadata,expected,source={}){return this.mutate(id,(p,s)=>{
  const v=p.versions.find(v=>v.id===versionId);if(!v)throw new Error('Version not found');
  if(source.owner)assertAdmission(this,s,lineForProject(s,p),source.owner,'line_metadata',{projectId:id,versionId,metadata,expectedRevision:expected,owner:source.owner});
  const job=source.jobId?nativeJobCurrent(s,p,source.jobId):null;if(job)assertMutableJob(job);
  if(job&&(job.kind!=='metadata'||job.sourceVersionId!==versionId||job.sourceSha256!==v.sha256||digest(readFileSync(v.path))!==job.sourceSha256||job.sourceMetadataHash!==source.metadataHash||job.sourceTargetsHash!==source.targetsHash))throw new Error('The original native metadata job no longer matches this version and input context.');
  if(source.metadataHash&&digest(v.metadata)!==source.metadataHash||source.targetsHash&&digest(p.targets||{})!==source.targetsHash)throw new Error('Copy or destinations changed during generation. The result was retained for review.');
  metadata={...metadata,...(metadata.category===undefined&&v.metadata.category?{category:v.metadata.category}:{})};
  if(digest(v.metadata)!==digest(metadata)){v.copyHistory??=[];v.copyHistory.push({at:now(),metadataHash:digest(v.metadata),metadata:clone(v.metadata)});}
  v.metadata=metadata;v.copyIssues=p.productionProfile?validatePublicationCopy(p.productionProfile,{topic:p.topic,keyPhrase:p.keyPhrase,title:metadata.title,caption:metadata.caption,hashtags:metadata.hashtags}).issues:[];v.approval=null;p.status='review';
  if(job){job.status='completed';job.completedAt=now();delete job.error;}
  return v;
 },expected);}
 saveProfile(input,expected){return this.tx(s=>{
  const profile=validateProductionProfile(input),old=s.profiles.find(p=>p.id===profile.id);
  if(old&&(expected===undefined||old.revision!==expected))throw new Error('The profile changed. Refresh before saving.');
  const next={...clone(profile),revision:old?old.revision+1:1};
  s.profileHistory??=[];if(old)s.profileHistory.push({profileId:old.id,revision:old.revision,profile:clone(old),replacedAt:now()});
  if(old)s.profiles=s.profiles.map(p=>p.id===next.id?next:p);else s.profiles.push(next);
  return clone(next);
 });}
 profileAssign(id,{profileId,topic,keyPhrase},expected){return this.mutate(id,(p,s)=>{const profile=s.profiles.find(x=>x.id===profileId);if(!profile)throw new Error('Profile not found');if(digest({profile:p.productionProfile,topic:p.topic,keyPhrase:p.keyPhrase})!==digest({profile,topic,keyPhrase})){for(const v of p.versions)v.approval=null;if(p.versions.length)p.status='review';}p.productionProfile=clone(profile);p.topic=topic;p.keyPhrase=keyPhrase;return p;},expected);}
 copyIssues(id,versionId,copy){const p=this.get(id),v=p.versions.find(v=>v.id===versionId);if(!p.productionProfile||!v)return [];const result=validatePublicationCopy(p.productionProfile,{topic:p.topic,keyPhrase:p.keyPhrase,title:copy.title,caption:copy.caption,hashtags:copy.hashtags});return result.issues;}
 approve(id,versionId,sha,expected){return this.mutate(id,p=>{const v=p.versions.find(v=>v.id===versionId);if(!v||v.sha256!==sha||digest(readFileSync(v.path))!==sha)throw new Error('The video changed. Review it again.');if(p.productionProfile){const copy=platformCopy(v.metadata,'youtube');if(!validatePublicationCopy(p.productionProfile,{topic:p.topic,keyPhrase:p.keyPhrase,...copy}).valid)throw new Error('Profile publication copy has unresolved issues');const wanted=p.productionProfile.captions.languages,tracks=v.artifacts?.captions||[];if(tracks.length!==wanted.length||wanted.some(l=>!tracks.some(c=>c.language===l)))throw new Error('Attach every required caption before approval');for(const track of tracks)if(digest(readFileSync(track.path))!==track.sha256)throw new Error('Attached caption changed');}v.approval={at:now(),sha256:sha,metadataHash:digest(v.metadata),targetsHash:digest(p.targets||{})};p.status='approved';return v;},expected);}
 attachArtifacts(id,versionId,a,expected){return this.mutate(id,(p,s)=>{
  if(a.sourceJobId){const job=nativeJobCurrent(s,p,a.sourceJobId);if(job.versionId!==versionId)throw new Error('The native artifact job does not own this version.');}
  if(a.owner)assertAdmission(this,s,lineForProject(s,p),a.owner,'line_artifacts_attach',{projectId:id,versionId,expectedRevision:expected,...a});
  const v=p.versions.find(v=>v.id===versionId);if(!v)throw new Error('Version not found');
  if(v.sha256!==a.sha256||digest(readFileSync(v.path))!==a.sha256)throw new Error('The video changed before attaching artifacts');
  const source=realpathSync(v.sourceDir),languages=p.productionProfile?.captions.languages||defaultCaptionLanguages,caps=a.captions||[];
  if(caps.length!==languages.length||new Set(caps.map(c=>c.language)).size!==languages.length||caps.some(c=>!languages.includes(c.language)))throw new Error('Exactly one SRT caption is required for each saved profile language');
  const duration=Number(v.media?.duration);if(!Number.isFinite(duration)||duration<=0)throw new Error('Verify video duration before attaching captions');
  const prepared=caps.map(c=>{const path=realpathSync(resolve(source,c.path));if(!path.startsWith(source+sep)||extname(path).toLowerCase()!=='.srt')throw new Error('Caption must be an SRT inside the version source folder');if(statSync(path).size>5*1024*1024)throw new Error('Caption is oversized');const bytes=readFileSync(path);if(digest(bytes)!==c.sha256)throw new Error('Caption SHA-256 does not match');return {...c,bytes,cues:captionCues(bytes,duration)};});
  let archive=null;
  if(a.editableSourcePath){const path=realpathSync(resolve(source,a.editableSourcePath));if(!path.startsWith(source+sep)||extname(path).toLowerCase()!=='.zip')throw new Error('Editable ZIP must be inside the version source folder');if(statSync(path).size>512*1024*1024)throw new Error('Editable ZIP exceeds 512 MB');const bytes=readFileSync(path);if(bytes.length<4||bytes[0]!==80||bytes[1]!==75||![3,5,7].includes(bytes[2]))throw new Error('Editable source is not a ZIP');archive={bytes,sha256:digest(bytes),status:'attached'};if(a.editableSourceSha256&&a.editableSourceSha256!==archive.sha256)throw new Error('Editable ZIP SHA-256 does not match');}
  const artifactHash=digest({captions:prepared.map(c=>({language:c.language,sha256:c.sha256})).sort((a,b)=>a.language.localeCompare(b.language)),editableSource:archive?.sha256||null});
  if(v.artifacts?.sha256===artifactHash)return v;
  const dest=join(this.home,'media',v.id,'artifacts');mkdirSync(dest,{recursive:true});
  const captions=prepared.map(c=>{const path=join(dest,c.language+'-'+c.sha256+'.srt');if(!existsSync(path))writeFileSync(path,c.bytes,{mode:0o600});return {language:c.language,sha256:c.sha256,path,bytes:c.bytes.length,cues:c.cues,status:'attached'};});
  let editableSource;if(archive){const path=join(dest,'editable-source-'+archive.sha256+'.zip');if(!existsSync(path))writeFileSync(path,archive.bytes,{mode:0o600});editableSource={path,sha256:archive.sha256,bytes:archive.bytes.length,status:'attached'};}
  v.artifactHistory??=[];if(v.artifacts)v.artifactHistory.push(clone(v.artifacts));
  v.artifacts={sha256:artifactHash,captions,...(editableSource?{editableSource}:{}),updatedAt:now()};return v;
 },expected);}
 releasePlanCreate(data,plan){return this.tx(s=>{const payloadHash=digest(data),old=s.releasePlans.find(x=>x.requestKey===data.requestKey);if(old){if(old.payloadHash!==payloadHash)throw new Error('This requestKey belongs to a different release plan');return {...clone(old),reused:true};}const out={...clone(plan),payloadHash,createdAt:now(),status:'planned',dispatchState:'not_sent',results:[],items:plan.items.map(x=>({...x,attemptId:null}))};s.releasePlans.push(out);return out;});}
 releasePlanApprove(planId){return this.tx(s=>{
  const plan=s.releasePlans.find(x=>x.id===planId);if(!plan)throw new Error('Release plan not found');if(plan.status!=='planned')return clone(plan);
  const c=verifiedConnection(s,plan),checked=[];
  for(const item of plan.items){
   const p=s.projects.find(x=>x.id===item.projectId),v=p?.versions.find(x=>x.id===item.versionId);
   if(!p||!v||p.revision!==item.expectedRevision||p.targets?.youtube!==c.id||v.sha256!==item.sha256||digest(readFileSync(v.path))!==item.sha256||digest(v.metadata)!==item.metadataHash||digest(p.targets||{})!==item.targetsHash)throw new Error('Release plan changed. Refresh and review every item.');
   const copy=platformCopy(v.metadata,'youtube');if(p.productionProfile&&!validatePublicationCopy(p.productionProfile,{topic:p.topic,keyPhrase:p.keyPhrase,...copy}).valid)throw new Error('Profile publication copy has unresolved issues');
   const wanted=p.productionProfile?.captions.languages||defaultCaptionLanguages,tracks=v.artifacts?.captions||[];
   if(p.productionProfile&&(tracks.length!==wanted.length||wanted.some(l=>!tracks.some(c=>c.language===l))))throw new Error('Attach every required caption before release approval');
   for(const track of tracks)if(digest(readFileSync(track.path))!==track.sha256)throw new Error('Attached caption changed');
   const payloadHash=digest({sha:v.sha256,metadata:copy,channel:'youtube',target:c.account,connectionId:c.id});
   const prior=s.attempts.find(a=>a.channel==='youtube'&&a.target===c.account&&s.projects.find(p=>p.id===a.projectId)?.versions.find(v=>v.id===a.versionId)?.sha256===v.sha256&&a.effect!=='not_delivered');
   if(prior?.status==='published'||prior?.effect==='independently_verified')throw new Error('This media is already published. Reconcile its existing video.');
   if(prior&&prior.payloadHash!==payloadHash)throw new Error('This media already has a delivery attempt. Reconcile the existing video before changing its copy.');
   checked.push({item,p,v,copy,payloadHash});
  }
  for(const {item,p,v,copy,payloadHash} of checked){
   v.approval={at:now(),sha256:v.sha256,metadataHash:digest(v.metadata),targetsHash:digest(p.targets||{})};p.revision++;p.updatedAt=now();p.status='approved';
   let attempt=s.attempts.find(a=>a.payloadHash===payloadHash);
   if(!attempt){attempt={id:randomUUID(),projectId:p.id,versionId:v.id,channel:'youtube',target:c.account,connectionId:c.id,connection:clone(c),metadata:clone(copy),metadataHash:digest(v.metadata),targetsHash:digest(p.targets||{}),payloadHash,effect:'not_delivered',status:'prepared',createdAt:now()};s.attempts.push(attempt);}
   item.attemptId=attempt.id;item.status=attempt.status==='scheduled'?'scheduled':'approved';item.effect=attempt.effect;
   const knownId=attempt.videoId||/\/(?:shorts|video)\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(attempt.url||'')?.[1];if(knownId)item.videoId=knownId;
  }
  plan.status='approved';plan.approvedAt=now();return clone(plan);
 });}
 releasePlanRead(planId){const s=this.read(),plan=s.releasePlans.find(x=>x.id===planId);if(!plan)throw new Error('Release plan not found');return {...clone(plan),items:plan.items.map(i=>{const p=s.projects.find(x=>x.id===i.projectId),v=p?.versions.find(x=>x.id===i.versionId);return {...i,job:v?{path:v.path,sha256:v.sha256,approval:v.approval,metadata:v.metadata,artifacts:v.artifacts||null}:null};})};}
 releasePlanDispatch(planId,status){return this.tx(s=>{
  const plan=s.releasePlans.find(x=>x.id===planId);if(!plan)throw new Error('Release plan not found');
  const current=plan.dispatchState||'not_sent',allowed={not_sent:['sending'],sending:['sent','uncertain'],sent:[],uncertain:[]};
  if(status==='not_sent'&&current==='not_sent')return clone(plan);
  if(!allowed[current]?.includes(status))throw new Error('Dispatch fence cannot be reset or sent again');
  if(status==='sending'){
   if(plan.status!=='approved')throw new Error('Approve this release plan before dispatch');verifiedConnection(s,plan);
   for(const item of plan.items){const p=s.projects.find(x=>x.id===item.projectId),v=p?.versions.find(x=>x.id===item.versionId),a=s.attempts.find(x=>x.id===item.attemptId);if(!p||!v||!a||p.targets?.youtube!==plan.connectionId||v.sha256!==item.sha256||digest(readFileSync(v.path))!==item.sha256||digest(v.metadata)!==item.metadataHash||digest(p.targets||{})!==item.targetsHash||!v.approval||v.approval.metadataHash!==item.metadataHash||v.approval.targetsHash!==item.targetsHash)throw new Error('Release approval or media changed before dispatch');}
  }
  plan.dispatchState=status;plan.dispatchHistory??=[];plan.dispatchHistory.push({status,at:now()});return clone(plan);
 });}
 releasePlanResult(planId,input){return this.tx(s=>{
  const plan=s.releasePlans.find(x=>x.id===planId);if(!plan)throw new Error('Release plan not found');assertExecution(s,plan,input.executionToken);const item=plan.items.find(x=>x.projectId===input.projectId);if(!item)throw new Error('Project is not in release plan');
  if(input.attemptId&&input.attemptId!==item.attemptId)throw new Error('Attempt is not owned by this plan item');const originalAttempt=s.attempts.find(x=>x.id===item.attemptId);if(originalAttempt)assertExecution(s,originalAttempt,input.executionToken);
  const effects={not_delivered:0,possibly_delivered:1,delivered_unverified:2,independently_verified:3},order={planned:0,approved:0,uploading:1,scheduled:2,published:3};
  if(!(input.effect in effects)||!['planned','uploading','scheduled','published','needs_attention'].includes(input.status))throw new Error('Invalid release result');
  const oldStage=item.status==='needs_attention'?item.lastSuccessfulStatus||'planned':item.status;
  if(effects[input.effect]<effects[item.effect||'not_delivered']||input.status!=='needs_attention'&&order[input.status]<order[oldStage])throw new Error('Release result cannot move backward');
  if(input.videoId&&item.videoId&&input.videoId!==item.videoId)throw new Error('videoId cannot change');
  let receipt=clone(input.receipt),videoId=input.videoId,url=input.url;
  const evidenceItem={...item,target:plan.target};
  if(input.status==='scheduled'){if(input.effect!=='delivered_unverified')throw new Error('Scheduled is not independently verified public release');receipt=validateScheduleEvidence(evidenceItem,input.receipt,{target:plan.target});videoId=receipt.videoId;url=receipt.url;}
  if(input.status==='published'){if(input.effect!=='independently_verified')throw new Error('Public release requires independent verification');receipt=recordPublicEvidence(evidenceItem,input.receipt,{target:plan.target,now:new Date()});videoId=receipt.videoId;url=receipt.url;}
  if(input.videoId&&videoId&&input.videoId!==videoId||item.videoId&&videoId&&item.videoId!==videoId)throw new Error('Receipt conflicts with videoId');
  if(input.observedAccount&&input.observedAccount!==plan.target||receipt?.observedAccount&&receipt.observedAccount!==plan.target)throw new Error('Observed account does not match release target');
  if(videoId&&!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw new Error('Invalid videoId');
  if(url&&videoId&&!['https://www.youtube.com/shorts/'+videoId,'https://youtube.com/shorts/'+videoId,'https://www.youtube.com/watch?v='+videoId,'https://youtube.com/watch?v='+videoId,'https://studio.youtube.com/video/'+videoId+'/edit'].includes(url))throw new Error('URL does not match videoId');
  if(input.effect==='independently_verified'&&input.status!=='published')throw new Error('Only public release can be independently verified');
  const result={...clone(input),...(videoId?{videoId}:{}),...(url?{url}:{}),receipt,observedAccount:receipt?.observedAccount||input.observedAccount,at:now()};
  Object.assign(item,{status:input.status,effect:input.effect,latestReceipt:receipt,...(videoId?{videoId}:{}),...(url?{url}:{}),...(input.status!=='needs_attention'?{lastSuccessfulStatus:input.status}:{lastSuccessfulStatus:oldStage})});item.resultHistory??=[];item.resultHistory.push(result);
  if(item.attemptId){const attempt=s.attempts.find(x=>x.id===item.attemptId);if(attempt)Object.assign(attempt,{...result,updatedAt:now()});}
  if(plan.items.every(x=>['scheduled','published'].includes(x.status)))plan.status='scheduled';if(plan.items.every(x=>x.status==='published'))plan.status='published';
  return clone(item);
 });}
 addTemplate(a){return this.tx(s=>{if(s.templates.some(t=>t.name.toLowerCase()===a.name.trim().toLowerCase()))throw new Error('A template with that name already exists');const base=s.templates.find(t=>t.id===a.baseTemplateId);if(!base)throw new Error('Base template not found');let ref=null;if(a.projectId){const p=s.projects.find(p=>p.id===a.projectId);const v=p?.versions.find(v=>v.id===a.versionId);if(!v?.approval)throw new Error('Approve the source video first');ref={projectId:p.id,versionId:v.id,sourceDir:v.sourceDir,sha256:v.sha256};}const t={...clone(base),id:randomUUID(),name:a.name.trim(),instructions:a.instructions,reference:ref,builtIn:false,createdAt:now()};s.templates.push(t);return t;});}
 preparePublish(id,versionId,channel,target,connectionId){return this.tx(s=>{const p=s.projects.find(p=>p.id===id);const v=p?.versions.find(v=>v.id===versionId);if(!v?.approval||v.approval.sha256!==digest(readFileSync(v.path))||v.approval.metadataHash!==digest(v.metadata)||v.approval.targetsHash&&v.approval.targetsHash!==digest(p.targets||{}))throw new Error('Approve the current video, copy and destinations before publishing');const connection=connectionId?s.accounts.find(c=>c.id===connectionId&&!c.archived&&c.channel===channel&&c.account===target):null;if(connectionId&&(!connection||p.targets?.[channel]!==connectionId))throw new Error('The selected account changed. Review the exact destination.');const copy=platformCopy(v.metadata,channel);const payloadHash=digest({sha:v.sha256,metadata:copy,channel,target,...(connectionId?{connectionId}:{})});const old=s.attempts.find(a=>a.payloadHash===payloadHash);if(old)return {...old,reused:true};const attempt={id:randomUUID(),projectId:id,versionId,channel,target,...(connection?{connectionId,connection:clone(connection)}:{}),metadata:clone(copy),metadataHash:digest(v.metadata),targetsHash:digest(p.targets||{}),payloadHash,effect:'not_delivered',status:'prepared',createdAt:now()};s.attempts.push(attempt);return attempt;});}
 attempt(id,fields,{publicationResult=false}={}){return this.tx(s=>{const a=s.attempts.find(a=>a.id===id);if(!a)throw new Error('Attempt not found');assertExecution(s,a,fields.executionToken);if(publicationResult)validatePublicationResult(a,fields);Object.assign(a,fields,{updatedAt:now()});return a;});}
 addAccount(a){return this.tx(s=>{const old=s.accounts.find(c=>!c.archived&&c.channel===a.channel&&c.account.toLowerCase()===a.account.toLowerCase()&&c.method===a.method);if(old)return {...old,reused:true};const c={...a,id:randomUUID(),status:a.method==='manual'?'export_only':'needs_verification',createdAt:now(),archived:false};s.accounts.push(c);return c;});}
 archiveAccount(id,archived){return this.tx(s=>{const c=s.accounts.find(c=>c.id===id);if(!c)throw new Error('Account not found');c.archived=archived;c.updatedAt=now();return c;});}
 connection(channel,record){return this.tx(s=>{const c=record.connectionId?s.accounts.find(c=>c.id===record.connectionId&&c.channel===channel):s.accounts.find(c=>c.channel===channel&&c.account===record.account&&c.method==='browser');if(record.connectionId&&!c)throw new Error('Account not found');if(c&&c.account!==record.account&&!['needs_verification','export_only'].includes(c.status))throw new Error('A verified account cannot be reassigned. Add a separate account.');const clean={...record};delete clean.connectionId;const out={...(c||{id:randomUUID(),channel,method:'browser',label:record.account,market:2840,language:'en',createdAt:now(),archived:false}),...clean,status:'browser_verified',verifiedAt:now()};if(c)Object.assign(c,out);else s.accounts.push(out);return out;});}
 targets(id,targets,expected){return this.mutate(id,(p,s)=>{const line=lineForProject(s,p);if(line&&targets[line.channel]!==line.connectionId)throw new Error('Keep the channel assigned to this production direction.');for(const [channel,accountId]of Object.entries(targets)){if(!s.accounts.some(c=>c.id===accountId&&c.channel===channel&&!c.archived))throw new Error('Choose an active account for each destination');}if(digest(p.targets||{})!==digest(targets)){p.targets=targets;for(const v of p.versions)v.approval=null;p.status=p.versions.length?'review':'draft';}return p;},expected);}
 publicationJob(attemptId){const s=this.read();const a=s.attempts.find(a=>a.id===attemptId);if(!a)throw new Error('Publication attempt not found');const p=s.projects.find(p=>p.id===a.projectId),v=p.versions.find(v=>v.id===a.versionId);if(!v.approval||v.approval.sha256!==digest(readFileSync(v.path))||v.approval.metadataHash!==digest(v.metadata)||a.metadataHash&&a.metadataHash!==digest(v.metadata)||a.targetsHash&&a.targetsHash!==digest(p.targets||{}))throw new Error('Approval or destination is stale. Publishing is blocked.');const live=a.connectionId?s.accounts.find(c=>c.id===a.connectionId&&!c.archived):null;if(a.connectionId&&(!live||live.account!==a.target||live.channel!==a.channel))throw new Error('This account is no longer available for the prepared publication');return {attempt:a,projectTitle:p.title,videoPath:v.path,sha256:v.sha256,metadata:a.metadata||platformCopy(v.metadata,a.channel),approval:v.approval,connection:a.connection||s.connections?.[a.channel]||null,artifacts:v.artifacts||null};}
 exportPackage(id,versionId,channels){
  const p=this.get(id),v=p.versions.find(v=>v.id===versionId);if(!v)throw new Error('Version not found');
  if(digest(readFileSync(v.path))!==v.sha256)throw new Error('The saved master changed');
  const dir=join(this.home,'exports',v.id);mkdirSync(dir,{recursive:true});copyFileSync(v.path,join(dir,'video.mp4'));
  const artifactManifest={captions:[]};
  for(const c of v.artifacts?.captions||[]){if(digest(readFileSync(c.path))!==c.sha256)throw new Error('Attached caption changed');mkdirSync(join(dir,'captions'),{recursive:true});const relative='captions/'+c.language+'.srt';copyFileSync(c.path,join(dir,relative));artifactManifest.captions.push({language:c.language,path:relative,sha256:c.sha256,cues:c.cues});}
  if(v.artifacts?.editableSource){const a=v.artifacts.editableSource;if(digest(readFileSync(a.path))!==a.sha256)throw new Error('Attached editable source changed');copyFileSync(a.path,join(dir,'editable-source.zip'));artifactManifest.editableSource={path:'editable-source.zip',sha256:a.sha256};}
  const accounts=this.read().accounts,targets=Object.fromEntries(channels.map(c=>[c,accounts.find(a=>a.id===p.targets?.[c])||null]));
  writeFileSync(join(dir,'publication.json'),JSON.stringify({project:p.title,version:v.number,sha256:v.sha256,channels,targets,metadata:v.metadata,approval:v.approval,productionProfile:p.productionProfile||null,artifacts:artifactManifest,status:'exported_not_published'},null,2));
  for(const c of channels){const copy=platformCopy(v.metadata,c);writeFileSync(join(dir,c+'-caption.txt'),copy.title+'\n\n'+copy.caption+'\n\n'+(copy.hashtags||[]).join(' '));}
  writeFileSync(join(dir,'caption.txt'),v.metadata.title+'\n\n'+v.metadata.caption+'\n\n'+(v.metadata.hashtags||[]).join(' '));
  return {path:dir,artifacts:artifactManifest,status:'exported_not_published'};
 }
 recover(){return this.tx(s=>{let count=0;for(const p of s.projects)for(const j of p.jobs){if(!j.external&&['starting','running','cancel_requested'].includes(j.status)){let alive=false;try{process.kill(j.ownerPid,0);alive=true;}catch{}if(!alive){j.status='uncertain';p.status='needs_attention';count++;}}}return {count};});}
 public(){const s=this.read(),artifacts=a=>a?{...a,captions:a.captions?.map(({path,...c})=>c),editableSource:a.editableSource?{sha256:a.editableSource.sha256,bytes:a.editableSource.bytes,status:a.editableSource.status}:undefined}:undefined;return {...s,projects:s.projects.map(p=>({...p,...(p.narration?{narration:publicNarration(p.narration)}:{}),...(p.narrationHistory?{narrationHistory:p.narrationHistory.map(publicNarration)}:{}),uploads:p.uploads.map(({path,...a})=>a),versions:p.versions.map(({path,sourceDir,...v})=>({...v,artifacts:artifacts(v.artifacts),artifactHistory:v.artifactHistory?.map(artifacts)})),jobs:p.jobs.map(({dir,...j})=>({...j,...(j.narration?{narration:publicNarration(j.narration)}:{}),...(j.narrationHistory?{narrationHistory:j.narrationHistory.map(publicNarration)}:{})}))})),templates:s.templates.map(t=>({...t,reference:t.reference?{projectId:t.reference.projectId,versionId:t.reference.versionId}:null}))};}
 lineCreate(a){return lineMethods.create.call(this,a);}
 lineStatus(a){return lineMethods.status.call(this,a);}
 lineHandoffRead(a){return lineMethods.handoffRead.call(this,a);}
 lineHandoff(a){return lineMethods.handoff.call(this,a);}
 externalJobBegin(a){return this.begin(a.projectId,{requestKey:a.requestKey,owner:a.owner,external:{bbThreadId:a.bbThreadId,operation:a.operation,inputFingerprint:a.inputFingerprint}});}
 externalJobResult(a){return externalJobMethods.result.call(this,a);}
 externalJobReconcile(a){return externalJobMethods.reconcile.call(this,a);}
 lineAssign(a){return lineMethods.assign.call(this,a);}
 lineReorder(a){return lineMethods.reorder.call(this,a);}
 lineReport(a){return lineMethods.report.call(this,a);}
 lineNext(a){return lineMethods.next.call(this,a);}
 lineClaim(a){return lineMethods.claim.call(this,a);}
 lineEnqueueAttempt(id){return lineMethods.enqueueAttempt.call(this,id);}
 lineEnqueuePlan(id){return lineMethods.enqueuePlan.call(this,id);}
 media(id){const s=this.read();for(const p of s.projects){const v=[...p.versions,...p.uploads].find(a=>a.id===id);if(v)return v.path;}return null;}
}
