import {randomUUID} from 'node:crypto';

const MAX_ITEMS=50;
const MAX_TEXT=4000;
const HASH=/^[a-f0-9]{64}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID=/^UC[A-Za-z0-9_-]{22}$/;
const ISO_OFFSET=/T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const SCHEDULE_KEYS=new Set(['startsAt','timezone','intervalMinutes']);
const ITEM_KEYS=new Set(['projectId','versionId','sha256','metadataHash','targetsHash','title']);

const fail=message=>{throw new Error(message);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(value,allowed,label)=>{if(!plain(value))fail(`${label} must be an object`);for(const key of Object.keys(value))if(!allowed.has(key))fail(`${label}.${key} is not supported`);};
const text=(value,label,max=200)=>{if(typeof value!=='string'||!value.trim())fail(`${label} is required`);if(value.length>max)fail(`${label} exceeds ${max} characters`);return value;};
const id=(value,label)=>{if(typeof value!=='string'||!UUID.test(value))fail(`${label} must be a UUID`);return value;};
const hash=(value,label)=>{if(typeof value!=='string'||!HASH.test(value))fail(`${label} must be a SHA-256 hash`);return value.toLowerCase();};
const dateValue=(value,label)=>{if(typeof value!=='string'||!ISO_OFFSET.test(value))fail(`${label} must be an ISO date with an explicit UTC offset`);const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i);const year=Number(parts?.[1]),month=Number(parts?.[2]),day=Number(parts?.[3]),hour=Number(parts?.[4]),minute=Number(parts?.[5]),second=Number(parts?.[6]??0);if(!parts||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)fail(`${label} is invalid`);const time=Date.parse(value);if(!Number.isFinite(time))fail(`${label} is invalid`);return time;};
const validTimezone=timezone=>{text(timezone,'timezone',100);try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{fail('timezone must be a valid IANA timezone');}return timezone;};
const nowMs=now=>{const time=now instanceof Date?now.getTime():Date.parse(now??new Date().toISOString());if(!Number.isFinite(time))fail('now is invalid');return time;};
const localDisplay=(time,timezone)=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(time));
const iso=time=>new Date(time).toISOString();

export function normalizeSchedule(input={}){
  keys(input,SCHEDULE_KEYS,'schedule');
  const startsAt=text(input.startsAt,'startsAt',80);const startMs=dateValue(startsAt,'startsAt');
  const timezone=validTimezone(input.timezone);const intervalMinutes=input.intervalMinutes===undefined?60:input.intervalMinutes;
  if(!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>10080)fail('intervalMinutes must be an integer from 1 to 10080');
  return {startsAt:iso(startMs),timezone,intervalMinutes};
}

function normalizeItem(item,index){
  keys(item,ITEM_KEYS,`items[${index}]`);
  return {projectId:id(item.projectId,`items[${index}].projectId`),versionId:id(item.versionId,`items[${index}].versionId`),sha256:hash(item.sha256,`items[${index}].sha256`),metadataHash:hash(item.metadataHash,`items[${index}].metadataHash`),targetsHash:hash(item.targetsHash,`items[${index}].targetsHash`),title:text(item.title,`items[${index}].title`,200)};
}

export function buildReleasePlan(input={},options={}){
  if(!plain(input))fail('release plan must be an object');
  const allowed=new Set(['requestKey','connectionId','channel','target','startsAt','timezone','intervalMinutes','items']);keys(input,allowed,'releasePlan');
  const requestKey=id(input.requestKey,'requestKey');const connectionId=id(input.connectionId,'connectionId');
  if(input.channel!=='youtube')fail('channel must be youtube');
  const target=text(input.target,'target',64);if(!CHANNEL_ID.test(target))fail('target must be a valid immutable YouTube channel ID');
  const schedule=normalizeSchedule({startsAt:input.startsAt,timezone:input.timezone,intervalMinutes:input.intervalMinutes});
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>MAX_ITEMS)fail(`items must contain 1 to ${MAX_ITEMS} items`);
  const items=input.items.map(normalizeItem);const seenPairs=new Set(),seenHashes=new Set();
  for(const item of items){const pair=`${item.projectId}:${item.versionId}`;if(seenPairs.has(pair))fail('duplicate projectId/versionId');seenPairs.add(pair);if(seenHashes.has(item.sha256))fail('duplicate content hashes');seenHashes.add(item.sha256);}
  const now=nowMs(options.now);const startMs=Date.parse(schedule.startsAt);const outItems=items.map((item,position)=>{const at=startMs+position*schedule.intervalMinutes*60000;if(at<=now)fail('release schedule contains a past slot');return {...item,position,scheduleAtUTC:iso(at),scheduleLocal:localDisplay(at,schedule.timezone),timezone:schedule.timezone,status:'planned',videoId:null,effect:'not_delivered'};});
  return {schemaVersion:1,id:randomUUID(),requestKey,connectionId,channel:'youtube',target,startsAt:schedule.startsAt,timezone:schedule.timezone,intervalMinutes:schedule.intervalMinutes,items:outItems};
}

const EVIDENCE_KEYS=new Set(['videoId','url','videoUrl','observedAccount','scheduledAtUTC','timezone','observation','source','status','publishedAt']);
const exactYouTubeUrl=(url,videoId)=>typeof url==='string'&&((url===`https://youtube.com/shorts/${videoId}`)||(url===`https://www.youtube.com/shorts/${videoId}`)||(url===`https://studio.youtube.com/video/${videoId}/edit`));
function normalizeEvidence(item,receipt,options={}){
  if(!plain(item))fail('item must be an object');if(!plain(receipt))fail('receipt must be an object');keys(receipt,EVIDENCE_KEYS,'receipt');
  const videoId=receipt.videoId;if(!VIDEO_ID.test(videoId||''))fail('receipt.videoId must be an 11-character YouTube ID');
  if(item.videoId!=null&&item.videoId!==videoId)fail('receipt conflicts with existing videoId');
  const url=receipt.url??receipt.videoUrl;if(!options.public&&!exactYouTubeUrl(url,videoId))fail('receipt URL must exactly match the video ID');
  const target=options.target??item.target;if(receipt.observedAccount!==target||!CHANNEL_ID.test(receipt.observedAccount))fail('receipt observedAccount does not match target');
  if(receipt.scheduledAtUTC!==item.scheduleAtUTC)fail('receipt scheduledAtUTC does not match planned slot');
  if(receipt.timezone!==item.timezone)fail('receipt timezone does not match plan');
  text(receipt.observation,'receipt.observation',MAX_TEXT);if(receipt.source!=='native_youtube_studio')fail('receipt source must be native_youtube_studio');if(receipt.status!=='scheduled')fail('receipt status must be scheduled');
  return {videoId,url,observedAccount:receipt.observedAccount,scheduledAtUTC:receipt.scheduledAtUTC,timezone:receipt.timezone,observation:receipt.observation,source:receipt.source,status:'scheduled',effect:'delivered_unverified'};
}

export function validateScheduleEvidence(item,receipt,options={}){return normalizeEvidence(item,receipt,options);}

export function recordPublicEvidence(item,receipt,options={}){
  if(!plain(item)||!plain(receipt))fail('item and receipt must be objects');keys(receipt,EVIDENCE_KEYS,'receipt');
  const videoId=receipt.videoId;if(!VIDEO_ID.test(videoId||''))fail('receipt.videoId must be an 11-character YouTube ID');if(item.videoId!=null&&item.videoId!==videoId)fail('receipt conflicts with existing videoId');
  const url=receipt.url??receipt.videoUrl;const canonical=[`https://youtube.com/shorts/${videoId}`,`https://www.youtube.com/shorts/${videoId}`,`https://youtube.com/watch?v=${videoId}`,`https://www.youtube.com/watch?v=${videoId}`];if(!canonical.includes(url))fail('public evidence URL must exactly match the video ID');
  const target=options.target??item.target;if(receipt.observedAccount!==target||!CHANNEL_ID.test(receipt.observedAccount))fail('receipt observedAccount does not match target');text(receipt.observation,'receipt.observation',MAX_TEXT);if(receipt.source!=='native_youtube_public')fail('public evidence source must be native_youtube_public');if(receipt.status!=='public_verified')fail('public evidence status must be public_verified');
  if(options.now!==undefined&&item.scheduleAtUTC&&dateValue(item.scheduleAtUTC,'item.scheduleAtUTC')>nowMs(options.now))fail('public evidence is before the scheduled slot');
  return {videoId,url,observedAccount:receipt.observedAccount,observation:receipt.observation,source:receipt.source,status:'public_verified',...(receipt.publishedAt?{publishedAt:receipt.publishedAt}:{})};
}
