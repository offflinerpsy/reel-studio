import test from 'node:test';
import assert from 'node:assert/strict';
import {channelOverview,publishedCount} from '../server/channel-overview.mjs';

test('channel cards include historical releases and deduplicate aliases without mixing exact accounts',()=>{
 const accounts=[{id:'a',channel:'youtube',account:'UC-one',label:'First',status:'browser_verified'},{id:'alias',channel:'youtube',account:'UC-one',label:'Duplicate connection'},{id:'b',channel:'youtube',account:'UC-two',label:'Second'}];
 const pub={status:'published',effect:'independently_verified',channel:'youtube',target:'UC-one',projectId:'old',url:'https://www.youtube.com/shorts/abcdefghijk'};
 const attempts=[pub,{...pub,url:'https://youtube.com/watch?v=abcdefghijk&utm_source=test'},{...pub,status:'scheduled',url:'https://youtube.com/shorts/lmnopqrstuv'},{...pub,effect:'delivered_unverified',url:'https://youtube.com/shorts/lmnopqrstuv'},{...pub,target:'UC-two',projectId:'other',url:'https://youtu.be/zyxwvutsrqp'}];
 const s={accounts,productionLines:[{id:'line',channel:'youtube',target:'UC-one',name:'Linux',ownerHost:'linux',mode:'production',status:'active'}],attempts,projects:[{id:'old',status:'review',jobs:[]},{id:'queued',productionLineId:'line',jobs:[{status:'running'}]},{id:'targeted',targets:{youtube:'alias'},jobs:[]},{id:'other',jobs:[]},{id:'unrelated',jobs:[]}]};
 const [one,two]=channelOverview(s);
 assert.equal(one.counts.published,1);assert.equal(one.counts.projects,3);assert.equal(one.counts.activeJobs,1);assert.equal(one.counts.readyForReview,1);assert.deepEqual(one.connectionIds,['a','alias']);assert.equal(one.directions[0].ownerHost,'linux');
 assert.equal(two.counts.published,1);assert.equal(two.counts.projects,1);assert.equal(publishedCount(attempts),2);
});
test('missing public receipt and a matching connection ID with the wrong frozen account do not inflate releases',()=>{
 const pub={status:'published',effect:'independently_verified',channel:'youtube',target:'UC-other',connectionId:'a',url:'https://youtube.com/shorts/abcdefghijk'};
 const s={accounts:[{id:'a',channel:'youtube',account:'UC-exact',label:'Exact'}],projects:[],productionLines:[],attempts:[pub,{...pub,target:'UC-exact',url:null},{...pub,target:'UC-exact',url:'file:///private'}]};
 assert.equal(channelOverview(s)[0].counts.published,0);
});
test('a published current master is not awaiting review, while a new unpublished revision is',()=>{
 const pub={status:'published',effect:'independently_verified',channel:'youtube',target:'UC-exact',url:'https://youtube.com/shorts/abcdefghijk'};
 const s={accounts:[{id:'a',channel:'youtube',account:'UC-exact',label:'Exact'}],productionLines:[],projects:[{id:'released',status:'review',jobs:[],versions:[{id:'v1'}]},{id:'revised',status:'review',jobs:[],versions:[{id:'old'},{id:'new'}]}],attempts:[{...pub,projectId:'released',versionId:'v1'},{...pub,projectId:'revised',versionId:'old',url:'https://youtube.com/shorts/lmnopqrstuv'}]};
 assert.equal(channelOverview(s)[0].counts.readyForReview,1);
});
