import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshot,mergeProjectDetail,isFullProject} from '../ui/snapshots.mjs';

test('background index keeps exact loaded editor and full receipt fields while updating status',()=>{
 const project={id:'p',revision:2,detail:true,versions:[{id:'v',metadata:{title:'accepted'}}]};
 const current={revision:10,projects:[project],attempts:[{id:'a',channel:'youtube',target:'UCexact',receipt:'accepted evidence',status:'uploading'}],releasePlans:[{id:'plan'}]};
 const result=mergeSnapshot(current,{revision:11,compact:true,projects:[{id:'p',revision:2,detail:false}],attempts:[{id:'a',status:'published'}]});
 assert.equal(result.projects[0],project);
 assert.equal(result.attempts[0].receipt,'accepted evidence');
 assert.equal(result.attempts[0].status,'published');
 assert.deepEqual(result.releasePlans,current.releasePlans);
 assert.equal(current.attempts[0].status,'uploading');
});
test('changed project invalidates old detail and late hydration never overwrites its newer revision',()=>{
 const current={revision:10,projects:[{id:'p',revision:2,detail:true}],attempts:[]};
 const next=mergeSnapshot(current,{revision:11,compact:true,projects:[{id:'p',revision:3,detail:false}],attempts:[]});
 assert.equal(isFullProject(next.projects[0]),false);
 assert.equal(mergeProjectDetail(next,{id:'p',revision:2,detail:true}),next);
 assert.equal(mergeProjectDetail(next,{id:'p',revision:3,detail:true}).projects[0].revision,3);
 assert.equal(mergeSnapshot(next,current),next);
});
test('full draft without media is already hydrated and compact refresh cannot erase it',()=>{
 const full=mergeSnapshot(null,{revision:1,projects:[{id:'draft',revision:1,versions:[],idea:'complete idea'}],attempts:[]});
 assert.equal(isFullProject(full.projects[0]),true);
 const board=mergeSnapshot(full,{revision:1,compact:true,projects:[{id:'draft',revision:1,detail:false,idea:'short'}],attempts:[]});
 assert.equal(board.projects[0],full.projects[0]);
});
