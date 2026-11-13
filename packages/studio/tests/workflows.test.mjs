import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StudioStore,digest} from '../server/store.mjs';
import {DEFAULT_EXAMPLE_PROFILE} from '../server/production-profiles.mjs';

const uid=()=>randomUUID();
function fixture(t){const home=mkdtempSync(join(tmpdir(),'reel-workflow-'));t.after(()=>rmSync(home,{recursive:true,force:true}));const s=new StudioStore(home),p=s.create({requestKey:uid(),title:'Why sky',idea:'Why is the sky blue?',templateId:'kinetic',model:'gpt-5.6-luna',effort:'medium',duration:15,language:'en'});return {s,p};}

test('schema 4 starts without profiles and snapshots an explicitly saved profile',t=>{const {s,p}=fixture(t);assert.equal(s.read().schema,4);assert.deepEqual(s.read().profiles,[]);const profile=s.saveProfile(DEFAULT_EXAMPLE_PROFILE);const assigned=s.profileAssign(p.id,{profileId:profile.id,topic:'Why is the sky blue?',keyPhrase:'Why is the sky blue?'},s.get(p.id).revision);assert.equal(assigned.productionProfile.id,profile.id);assert.equal(assigned.keyPhrase,'Why is the sky blue?');});
test('release plan creation is idempotent and rejects changed request payload',t=>{const {s}=fixture(t),connection={id:uid(),channel:'youtube',account:'UC1234567890123456789012',status:'browser_verified',archived:false};s.tx(state=>{state.accounts.push(connection);return state;});const plan={schemaVersion:1,id:uid(),requestKey:uid(),connectionId:connection.id,channel:'youtube',target:connection.account,startsAt:'2028-01-01T00:00:00.000Z',timezone:'UTC',intervalMinutes:60,items:[]};const input={requestKey:plan.requestKey,connectionId:plan.connectionId,startsAt:plan.startsAt,timezone:plan.timezone,intervalMinutes:plan.intervalMinutes,items:[]};const first=s.releasePlanCreate(input,plan);assert.equal(s.releasePlanCreate(input,plan).reused,true);assert.throws(()=>s.releasePlanCreate({...input,timezone:'Europe/London'},plan),/different/);assert.equal(first.status,'planned');});
test('public snapshot strips local artifact paths while publication job retains them',t=>{const {s,p}=fixture(t),j=s.begin(p.id,{requestKey:uid()}),source=join(j.dir,'film.mp4');writeFileSync(source,'fixture');const v=s.addVersion(p.id,j.id,{path:source,media:{duration:15}});const account={id:uid(),channel:'youtube',account:'UC1234567890123456789012',status:'browser_verified',archived:false};s.tx(state=>{state.accounts.push(account);return state;});s.targets(p.id,{youtube:account.id},s.get(p.id).revision);s.approve(p.id,v.id,v.sha256,s.get(p.id).revision);const a=s.preparePublish(p.id,v.id,'youtube',account.account,account.id);const job=s.publicationJob(a.id);assert.equal(job.videoPath,v.path);assert.equal(s.public().projects[0].versions[0].path,undefined);});
