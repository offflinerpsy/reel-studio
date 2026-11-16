export function mediaIdFromSource(source){
 let url,id;
 try{
  url=new URL(source);
  if(url.username||url.password)throw new Error();
  if(url.protocol==='reel-media:'&&url.host==='studio')id=decodeURIComponent(url.pathname.slice(1));
  else if(['http:','https:'].includes(url.protocol)&&url.pathname.startsWith('/media/'))id=decodeURIComponent(url.pathname.slice('/media/'.length));
  else throw new Error();
  if(!id||id==='.'||id==='..'||/[\\/\u0000-\u001f\u007f]/.test(id))throw new Error();
 }catch{throw new Error('Unsupported media source');}
 return id;
}

export async function readNativeMedia(read,id,{signal,onProgress}={}){
 const check=()=>{if(signal?.aborted)throw new DOMException('Preview loading cancelled','AbortError');};check();
 const encoded=encodeURIComponent(id);
 const response=await read({uri:'reel-media-info://studio/'+encoded});
 const m=JSON.parse(response.contents?.[0]?.text||'null');
 if(!m||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>128*1024*1024||m.chunkBytes!==9*1024||m.chunks!==Math.ceil(m.bytes/m.chunkBytes)||!/^[a-f0-9]{64}$/.test(m.sha256)||!['video/mp4','audio/wav','image/jpeg','image/png','image/webp'].includes(m.mimeType))throw new Error('Invalid media manifest');
 const chunks=new Array(m.chunks);let next=0,completed=0;
 // Bounded requests avoid a multi-megabyte JSON line monopolizing the bridge.
 await Promise.all(Array.from({length:Math.min(3,m.chunks)},async()=>{
  while(next<m.chunks){check();const index=next++,r=await read({uri:`reel-media-chunk://studio/${encoded}/${m.sha256}/${index}`}),part=r.contents?.[0];check();
   if(!part?.blob||part.mimeType!==m.mimeType||atob(part.blob).length!==Math.min(m.chunkBytes,m.bytes-index*m.chunkBytes))throw new Error('Incomplete media transfer');
   chunks[index]=part.blob;onProgress?.(++completed/m.chunks);
  }
 }));
 const blob=chunks.join('');
 return {uri:'reel-media://studio/'+encoded,mimeType:m.mimeType,blob};
}
