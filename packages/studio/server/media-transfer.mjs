import {readFileSync,statSync,openSync,readSync,closeSync} from 'node:fs';
import {extname} from 'node:path';
import {createHash} from 'node:crypto';

// Keep each native bridge response small. The media resolver still owns access.
export const MEDIA_CHUNK_BYTES=9*1024;
export function createMediaTransfer(resolveMedia){
 const cache=new Map();
 function manifest(id){
  const file=resolveMedia(id);if(!file)throw new Error('Media not found');
  const st=statSync(file);if(!st.isFile()||st.size<1||st.size>128*1024*1024)throw new Error('Media size is unsupported');
  const key=[file,st.size,st.mtimeMs,st.ctimeMs].join(':');
  if(cache.get(id)?.key!==key){
   const sha256=createHash('sha256').update(readFileSync(file)).digest('hex');
   const mimeType=extname(file)==='.mp4'?'video/mp4':extname(file)==='.png'?'image/png':extname(file)==='.webp'?'image/webp':'image/jpeg';
   cache.set(id,{key,file,value:{bytes:st.size,chunkBytes:MEDIA_CHUNK_BYTES,chunks:Math.ceil(st.size/MEDIA_CHUNK_BYTES),sha256,mimeType}});
  }
  return cache.get(id);
 }
 return {
  manifest:id=>manifest(id).value,
  chunk(id,sha256,index){
   const m=manifest(id);if(sha256!==m.value.sha256)throw new Error('Media changed; reload its manifest');
   if(!/^(0|[1-9]\d*)$/.test(String(index))||!Number.isSafeInteger(Number(index))||Number(index)>=m.value.chunks)throw new Error('Invalid media chunk');
   const offset=Number(index)*MEDIA_CHUNK_BYTES,buffer=Buffer.alloc(Math.min(MEDIA_CHUNK_BYTES,m.value.bytes-offset));
   const fd=openSync(m.file,'r');try{if(readSync(fd,buffer,0,buffer.length,offset)!==buffer.length)throw new Error('Incomplete media chunk');}finally{closeSync(fd);}
   return {blob:buffer.toString('base64'),mimeType:m.value.mimeType};
  }
 };
}
