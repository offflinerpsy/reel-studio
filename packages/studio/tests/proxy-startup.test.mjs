import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../server/index.mjs';

const id='11111111-1111-4111-8111-111111111111';
const fullState={
 schema:4,revision:7,updatedAt:'2026-10-20T00:00:00.000Z',runtime:'remote_linux',paused:false,
 templates:[{id:'kinetic',name:'Kinetic',color:'#000',tag:'Motion',description:'d',previewURL:'https://media/preview.jpg',posterURL:'https://media/poster.jpg',builtIn:true}],
 profiles:[{id:'profile',name:'Saved recipe',revision:2,model:{name:'gpt',effort:'medium'}}],productionLines:[],operations:{directions:[]},compute:{target:'linux',targets:[]},connections:[],attempts:[],accounts:[],research:{status:'ready'},catalog:{models:[{id:'old'}],account:{planType:'pro'}},
 projects:[{id,title:'Exact project',idea:'A detailed idea',status:'review',createdAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z',revision:7,productionLineId:null,computeTarget:'linux',template:{id:'kinetic',name:'Kinetic',color:'#000'},productionProfile:{id:'profile',name:'Saved recipe'},versions:[{id:'version',number:1,approval:{},metadata:{title:'full'},artifacts:{editableSource:'source.zip'},url:'https://media/video.mp4'}],jobs:[]}]
};

test('proxy startup routes old full-state backend through compact projection and exact hydration',async t=>{
 const calls=[];
 const catalog={models:[{id:'old'}],account:{planType:'pro'}};
 const home=mkdtempSync(join(tmpdir(),'reel-proxy-startup-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const app=await createStudio({home,rpcForwarder:async(name)=>{calls.push(name);if(name==='reel_state')return {structuredContent:{snapshot:fullState}};if(name==='reel_models')return {structuredContent:{catalog,snapshot:fullState}};throw new Error(`unexpected ${name}`);},runtime:{close:async()=>{}}});
 t.after(()=>app.close());
 const board=await app.invoke('reel_board');
 assert.equal(board.structuredContent.snapshot.compact,true);
 assert.equal(board.structuredContent.snapshot.projects[0].detail,false);
 assert.equal(board.structuredContent.snapshot.projects[0].versions[0].metadata,undefined);
 assert.equal(board.structuredContent.snapshot.projects[0].versions[0].url,'https://media/video.mp4');
 const project=await app.invoke('reel_project',{projectId:id});
 assert.equal(project.structuredContent.project.detail,true);
 assert.equal(project.structuredContent.project.versions[0].metadata.title,'full');
 const models=await app.invoke('reel_models');
 assert.deepEqual(models.structuredContent.catalog,catalog);
 assert.equal(models.structuredContent.snapshot.compact,true);
 assert.equal(models.structuredContent.snapshot.projects[0].versions[0].metadata,undefined);
 assert.deepEqual(calls,['reel_state','reel_state','reel_models']);
});
