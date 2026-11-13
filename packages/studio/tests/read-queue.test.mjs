import test from 'node:test';
import assert from 'node:assert/strict';
import {singleFlightReads,pollReads} from '../ui/reads.mjs';

test('overlapping read refreshes share one response but public actions never coalesce',async()=>{
 let resolve,calls=0;const api=singleFlightReads(()=>{calls++;return new Promise(r=>resolve=r);});
 const a=api('reel_board'),b=api('reel_board');await Promise.resolve();assert.equal(calls,1);assert.equal(a,b);resolve('snapshot');assert.equal(await b,'snapshot');
 const c=api('reel_board');await Promise.resolve();assert.equal(calls,2);resolve('fresh');await c;
 api('reel_publish');api('reel_publish');assert.equal(calls,4);
});

test('slow polling waits for completion, skips hidden views, backs off and stops cleanly',async()=>{
 let callback,resolve,requests=0,scheduled=0,hidden=false,fail=false,delay;
 const stop=pollReads(()=>{requests++;if(fail)throw Error('offline');return new Promise(r=>resolve=r);},{visible:()=>!hidden,setTimer:(fn,ms)=>{callback=fn;delay=ms;return ++scheduled;},clearTimer:()=>{callback=null;}});
 assert.equal(scheduled,1);const first=callback();assert.equal(requests,1);assert.equal(scheduled,1);
 resolve();await first;assert.equal(scheduled,2);assert.equal(delay,15000);
 hidden=true;await callback();assert.equal(requests,1);hidden=false;fail=true;await callback();assert.equal(delay,30000);
 fail=false;const last=callback();stop();resolve();await last;assert.equal(callback,null);
});
