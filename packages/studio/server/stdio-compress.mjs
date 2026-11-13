// Lossless framing for the existing private SSH route; no alternate endpoint.
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function encodeFrame(line){
 if(Buffer.byteLength(line)<16384)return line;
 return JSON.stringify({reelWire:1,gzip:gzipSync(line).toString('base64')});
}
export function decodeFrame(line){
 if(!line.startsWith('{"reelWire":1,"gzip":"'))return line;
 const frame=JSON.parse(line);
 return gunzipSync(Buffer.from(frame.gzip,'base64'),{maxOutputLength:256*1024*1024}).toString('utf8');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const entry=resolve(dirname(fileURLToPath(import.meta.url)),'../dist/server.mjs');
 const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','inherit']});
 process.stdin.pipe(child.stdin);
 createInterface({input:child.stdout}).on('line',line=>process.stdout.write(encodeFrame(line)+'\n'));
 child.once('error',()=>{console.error('Linux Studio transport could not start.');process.exitCode=1;});
 child.once('exit',code=>process.exit(code??1));
 process.stdout.once('error',()=>child.kill('SIGTERM'));
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>child.kill(signal));
}
