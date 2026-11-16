import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaIdFromSource,readNativeMedia} from '../ui/media-transfer.mjs';

test('native narration and existing HTTP previews keep the complete media identity',()=>{
 const speech='speech-'+'a'.repeat(32);
 assert.equal(mediaIdFromSource('reel-media://studio/'+speech),speech);
 assert.equal(mediaIdFromSource('http://127.0.0.1:43123/media/'+speech+'?key=private-preview-key'),speech);
 assert.equal(mediaIdFromSource('https://preview.example/media/preview-123'), 'preview-123');
 assert.equal(mediaIdFromSource('http://localhost/media/a%20poster.png'), 'a poster.png');
});

test('a native narration source reaches the scoped audio manifest without truncation',async()=>{
 const speech='speech-'+'b'.repeat(32),uris=[];
 const result=await readNativeMedia(async({uri})=>{
  uris.push(uri);
  if(uri==='reel-media-info://studio/'+speech)return {contents:[{text:JSON.stringify({bytes:4,chunkBytes:9*1024,chunks:1,sha256:'c'.repeat(64),mimeType:'audio/wav'})}]};
  assert.equal(uri,'reel-media-chunk://studio/'+speech+'/'+'c'.repeat(64)+'/0');
  return {contents:[{mimeType:'audio/wav',blob:'UklGRg=='}]};
 },mediaIdFromSource('reel-media://studio/'+speech));
 assert.equal(uris.length,2);assert.equal(result.mimeType,'audio/wav');assert.equal(result.blob,'UklGRg==');
});

test('unsupported namespaces and paths never become native media resource IDs',()=>{
 for(const source of ['reel-media://other/speech-123','reel-media://studio/','reel-media://studio/a%2Fb','reel-media://studio/a%5Cb','reel-media://studio/%00','reel-media://user@studio/id','https://example.test/other/id','file:///media/id','not a URL'])assert.throws(()=>mediaIdFromSource(source),/Unsupported media source/);
});
