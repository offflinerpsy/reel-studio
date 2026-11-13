import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from './store.mjs';

// Native previews remain bounded; the immutable original is used for download/export.
export function ensurePreview(home,version){
 if(!/^[a-f0-9-]{36}$/.test(version.id))throw new Error('Invalid media identifier');
 const dir=join(home,'previews');mkdirSync(dir,{recursive:true,mode:0o700});
 const video=join(dir,version.id+'.mp4'),poster=join(dir,version.id+'.jpg'),receipt=join(dir,version.id+'.json');
 if(existsSync(receipt)&&existsSync(poster)){
  const r=JSON.parse(readFileSync(receipt,'utf8'));
  if(r.sourceSha256===version.sha256&&existsSync(r.video))return r;
 }
 if(digest(readFileSync(version.path))!==version.sha256)throw new Error('Original media changed');
 const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
 const run=args=>{const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});if(r.status!==0)throw new Error('Preview encoding failed');};
 let preview=version.path;
 const tmp=join(dir,version.id+'.partial.mp4');
 try{
  if(statSync(version.path).size>12*1024*1024){
   run(['-i',version.path,'-vf','scale=540:-2','-r','30','-c:v','libx264','-preset','fast','-crf','25','-maxrate','1200k','-bufsize','2400k','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart',tmp]);
   if(statSync(tmp).size>16*1024*1024)throw new Error('Preview exceeds transfer limit');
   renameSync(tmp,video);preview=video;
  }
  const at=Number.isFinite(version.media?.duration)?Math.min(1,version.media.duration/3):1;
  run(['-ss',String(at),'-i',preview,'-frames:v','1','-vf','scale=540:-2','-q:v','2',poster]);
  const r={sourceSha256:version.sha256,video:preview,poster,previewSha256:digest(readFileSync(preview)),posterSha256:digest(readFileSync(poster)),bytes:statSync(preview).size};
  writeFileSync(receipt,JSON.stringify(r,null,2),{mode:0o600});return r;
 }finally{rmSync(tmp,{force:true});}
}
