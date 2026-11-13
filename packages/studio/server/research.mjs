import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from './store.mjs';

export const markets = [
 {code:2840,name:'United States'}, {code:2826,name:'United Kingdom'},
 {code:2124,name:'Canada'}, {code:2036,name:'Australia'},
 {code:2276,name:'Germany'}, {code:2250,name:'France'},
 {code:2724,name:'Spain'}, {code:2076,name:'Brazil'},
];
export const pricing = {verifiedAt:'2026-10-12T00:00:00Z',estimateUSD:0.013,maxCalls:2,
 sources:['https://dataforseo.com/pricing/keywords-data/google-trends','https://dataforseo.com/pricing/serp/youtube-serp-api']};
const limitations = [
 'Google Trends measures relative YouTube search interest, not absolute search volume.',
 'A zero or missing trend series means insufficient data; it does not prove zero demand.',
 'YouTube search results help check relevance. They do not measure TikTok or Instagram trends.',
 'Titles and hashtags cannot guarantee ranking, recommendations, views or trend placement.',
];
const stamp=()=>new Date().toISOString();
function save(path,data){const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});renameSync(temp,path);}
export async function currentPricing(){
 if(Date.now()-Date.parse(pricing.verifiedAt)<86400000)return pricing;
 const pages=await Promise.all(pricing.sources.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok||new URL(r.url).hostname!=='dataforseo.com')throw new Error('Could not check current DataForSEO pricing');const html=await r.text();if(html.length>3*1024*1024)throw new Error('Pricing page exceeded its bounded size');return html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');}));
 const trend=pages[0].match(/Live mode\s+Single POST request.{0,160}?Per task\s+\$([0-9.]+)/i);
 const youtube=pages[1].match(/Live mode\s+Single POST request.{0,200}?\$([0-9.]+)/i);
 if(!trend||!youtube)throw new Error('Current DataForSEO prices need verification; saved research will not be re-requested');
 const t=Number(trend[1]),y=Number(youtube[1]);if(!(t>0&&y>0&&t<1&&y<1))throw new Error('DataForSEO returned an unexpected research price');
 pricing.trendUSD=t;pricing.youtubeUSD=y;pricing.estimateUSD=Number((t+y).toFixed(8));pricing.verifiedAt=stamp();return pricing;
}
export function normalizeResearch(input){
 const keywords=[...new Set(input.keywords.map(k=>k.trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean))];
 if(!keywords.length||keywords.length>5||keywords.some(k=>k.length>80))throw new Error('Enter one to five relevant search phrases (up to 80 characters each)');
 const market=markets.find(m=>m.code===input.locationCode);
 if(!market)throw new Error('Choose an available research market');
 if(!['en','ru','es','pt','fr','de'].includes(input.languageCode)||!['past_30_days','past_90_days','past_12_months'].includes(input.timeRange))throw new Error('Choose an available research language and period');
 return {keywords,query:keywords[0],locationCode:market.code,market:market.name,languageCode:input.languageCode,timeRange:input.timeRange,device:'desktop',type:'youtube',maxCostUSD:input.maxCostUSD??0.05};
}
export function researchPlan(input){
 const spec=normalizeResearch(input);
 return {spec,estimatedCostUSD:pricing.estimateUSD,maxCalls:2,operations:[
  {key:'youtube_trends',path:'/v3/keywords_data/google_trends/explore/live',estimatedCostUSD:pricing.trendUSD??0.011,data:[{keywords:spec.keywords,location_code:spec.locationCode,language_code:spec.languageCode,type:'youtube',time_range:spec.timeRange,item_types:['google_trends_graph']}]},
  {key:'youtube_search',path:'/v3/serp/youtube/organic/live/advanced',estimatedCostUSD:pricing.youtubeUSD??0.002,data:[{keyword:spec.query,location_code:spec.locationCode,language_code:spec.languageCode,device:'desktop'}]},
 ]};
}
export function unwrapResponse(result){
 if(result?.isError)throw new Error('DataForSEO returned an error; reconcile this request before retrying');
 if(Array.isArray(result?.tasks))return result;
 if(Array.isArray(result?.structuredContent?.tasks))return result.structuredContent;
 for(const c of result?.content||[]){if(c.type!=='text')continue;try{const parsed=JSON.parse(c.text);if(Array.isArray(parsed.tasks))return parsed;}catch{}}
 throw new Error('DataForSEO response did not include task IDs and costs; automatic retry is blocked');
}
export function sanitizeReceipt(raw,operation,spec){
 if(raw.tasks?.length!==1)throw new Error('Expected exactly one DataForSEO task for this operation');
 const t=raw.tasks[0];
 if(typeof t.id!=='string'||!t.id||!Number.isFinite(t.cost)||t.cost<0||!Number.isFinite(t.status_code))throw new Error('Incomplete DataForSEO task receipt');
 const d=t.data||{};
 if(d.location_code!==spec.locationCode||d.language_code!==spec.languageCode||
   (operation.key==='youtube_trends'?(d.type!=='youtube'||d.time_range!==spec.timeRange||digest(d.keywords)!==digest(spec.keywords)):d.keyword!==spec.query))throw new Error('DataForSEO receipt does not match the requested market, language or query');
 const results=(t.result||[]).slice(0,3).map(r=>({datetime:r.datetime||stamp(),locationCode:r.location_code,languageCode:r.language_code,
  keywords:r.keywords,keyword:r.keyword,
  items:(r.items||[]).slice(0,25).map(item=>operation.key==='youtube_trends'?{
   type:item.type,keywords:item.keywords,averages:item.averages,
   points:(item.data||[]).slice(0,400).map(p=>({from:p.date_from,to:p.date_to,timestamp:p.timestamp,values:p.values})),
  }:{type:item.type,rank:item.rank_absolute,title:item.title,url:item.url,description:item.description?.slice(0,600),videoId:item.video_id,
   videos:(item.items||[]).slice(0,8).map(v=>({title:v.title,url:v.url,videoId:v.video_id}))}),
 }));
 return {key:operation.key,endpoint:operation.path,taskId:t.id,statusCode:t.status_code,status:t.status_code===20000?'completed':'provider_error',
  costUSD:t.cost,observedAt:stamp(),parameters:operation.data[0],results};
}

export class ResearchService{
 constructor(home,{request,checkAccess}={}){this.dir=join(home,'research');mkdirSync(this.dir,{recursive:true,mode:0o700});this.request=request;this.checkAccess=checkAccess;}
 async access(options){return this.checkAccess(options);}
 async run(input,options,{onProgress=()=>{}}={}){
  let plan=researchPlan(input);const {spec}=plan;
  const fingerprint=digest({...spec,maxCostUSD:undefined}),path=join(this.dir,fingerprint+'.json'),lock=path+'.lock';
  const existing=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  if(existing?.status==='completed'&&Date.now()-Date.parse(existing.completedAt)<86400000){return {...existing,reused:true};}
  if(existing&&['requesting','uncertain','partial'].includes(existing.status))throw new Error('A previous research request needs reconciliation. It will not be sent again automatically.');
  await currentPricing();plan=researchPlan(input);
  if(plan.estimatedCostUSD>spec.maxCostUSD)throw new Error('The selected research cost limit is below the estimated two-request cost');
  try{mkdirSync(lock);}catch{throw new Error('This research is already running; check the existing job');}
  let r={id:randomUUID(),fingerprint,status:'prepared',startedAt:stamp(),spec,pricing,operations:[],totalCostUSD:0,limitations};
  try{
   // Nonbillable access check happens before the durable possibly-delivered fence.
   await this.access(options);
   if(existing){const history=join(this.dir,'history');mkdirSync(history,{recursive:true,mode:0o700});save(join(history,existing.id+'.json'),existing);}
   save(path,r);
   for(const op of plan.operations){
    if(r.totalCostUSD+op.estimatedCostUSD>spec.maxCostUSD){r.status='partial';save(path,r);throw new Error('Research reached its cost limit; saved receipts were retained');}
    const fence={key:op.key,endpoint:op.path,parameters:op.data[0],status:'requesting',effect:'possibly_delivered',submittedAt:stamp()};
    r.status='requesting';r.operations.push(fence);save(path,r);onProgress({label:op.key==='youtube_trends'?'Checking YouTube search interest':'Checking YouTube search results'});
    let clean;
    try{clean=sanitizeReceipt(unwrapResponse(await this.request({method:'POST',path:op.path,data:op.data,noAiMode:true},options)),op,spec);}
    catch(error){r.status='uncertain';r.error=error.message;r.operations[r.operations.length-1]={...fence,status:'uncertain'};save(path,r);throw error;}
    r.operations[r.operations.length-1]={...clean,effect:'independently_verified'};
    r.totalCostUSD=Number((r.totalCostUSD+clean.costUSD).toFixed(8));r.status='partial';save(path,r);
   }
   r.status='completed';r.completedAt=stamp();save(path,r);return {...r,reused:false};
  }finally{rmSync(lock,{recursive:true,force:true});}
 }
 summary(){return {pricing,markets,cacheHours:24,maxKeywords:5,limitations};}
}
