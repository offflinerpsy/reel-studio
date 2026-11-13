import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createMediaTransfer,MEDIA_CHUNK_BYTES} from '../server/media-transfer.mjs';
import {readNativeMedia} from '../ui/media-transfer.mjs';

test('bounded native transfer reassembles exact bytes and keeps UI requests bounded',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'reel-transfer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'preview.mp4'),bytes=randomBytes(MEDIA_CHUNK_BYTES*4+7);writeFileSync(file,bytes);
 const transfer=createMediaTransfer(id=>id==='allowed'?file:null);let active=0,maximum=0;
 const resource=await readNativeMedia(async({uri})=>{
  const url=new URL(uri),[id,sha,index]=url.pathname.slice(1).split('/');active++;maximum=Math.max(maximum,active);
  await new Promise(resolve=>setImmediate(resolve));
  try{if(url.protocol==='reel-media-info:')return {contents:[{text:JSON.stringify(transfer.manifest(id))}]};
   const chunk=transfer.chunk(id,sha,index);assert.ok(chunk.blob.length<=12288);return {contents:[chunk]};
  }finally{active--;}
 },'allowed');
 assert.deepEqual(Buffer.from(resource.blob,'base64'),bytes);assert.equal(resource.mimeType,'video/mp4');assert.equal(maximum,3);
 const m=transfer.manifest('allowed');assert.equal(m.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.throws(()=>transfer.manifest('../private'));assert.throws(()=>transfer.chunk('allowed','0'.repeat(64),0));
 for(const index of [-1,'01',m.chunks,1.5,'1e0'])assert.throws(()=>transfer.chunk('allowed',m.sha256,index));
 writeFileSync(file,randomBytes(bytes.length+1));assert.throws(()=>transfer.chunk('allowed',m.sha256,0),/changed/);
});

test('UI refuses incomplete native chunks and invalid manifests',async()=>{
 const manifest={bytes:3,chunkBytes:MEDIA_CHUNK_BYTES,chunks:1,sha256:'a'.repeat(64),mimeType:'video/mp4'};
 await assert.rejects(()=>readNativeMedia(async({uri})=>uri.includes('info:')?{contents:[{text:JSON.stringify(manifest)}]}:{contents:[{blob:'YQ==',mimeType:'video/mp4'}]},'allowed'),/Incomplete/);
 await assert.rejects(()=>readNativeMedia(async()=>({contents:[{text:JSON.stringify({...manifest,bytes:1e12})}]}),'allowed'),/Invalid/);
});

test('leaving a preview stops requesting chunks instead of occupying the connection',async()=>{
 const controller=new AbortController();let chunks=0;
 const manifest={bytes:MEDIA_CHUNK_BYTES*100,chunkBytes:MEDIA_CHUNK_BYTES,chunks:100,sha256:'a'.repeat(64),mimeType:'video/mp4'};
 await assert.rejects(()=>readNativeMedia(async({uri})=>{
  if(uri.includes('info:'))return {contents:[{text:JSON.stringify(manifest)}]};
  chunks++;controller.abort();return {contents:[{blob:Buffer.alloc(MEDIA_CHUNK_BYTES).toString('base64'),mimeType:'video/mp4'}]};
 },'allowed',{signal:controller.signal}),/cancelled/);
 assert.ok(chunks<=3);
});
