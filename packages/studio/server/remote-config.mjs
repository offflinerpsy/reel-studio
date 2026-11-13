// Explicit trusted configuration for the optional SSH route. Never discover a
// machine-specific configuration implicitly; fail closed on unsafe SSH inputs.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join,normalize,resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const pluginRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const defaultLocalHome=()=>join(homedir(),'.local','share','reel-studio-worker');
export const defaultLocalPlugin=()=>pluginRoot;

function remotePath(value,name){
 if(typeof value!=='string'||value.endsWith('/')||!/^\/[A-Za-z0-9_.\/-]+$/.test(value)||posix.normalize(value)!==value||value.split('/').some(part=>part==='.'||part==='..'))throw new Error(`Invalid ${name}: expected a normalized absolute POSIX path with safe characters`);
 return value;
}
function localPath(value,name){
 if(typeof value!=='string'||!isAbsolute(value)||value.endsWith('/')||value.includes('\0')||normalize(value)!==value)throw new Error(`Invalid ${name}: expected a normalized absolute path`);
 return value;
}
export function validateRemoteConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Remote configuration must be a JSON object');
 const allowed=new Set(['sshHost','remoteHome','remotePlugin','remoteNode','localHome','localPlugin','codexBinary']);
 if(Object.keys(value).some(key=>!allowed.has(key)))throw new Error('Remote configuration has unknown fields');
 const sshHost=value.sshHost;
 if(typeof sshHost!=='string'||!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(sshHost)||sshHost.includes('..'))throw new Error('Invalid sshHost: use an SSH hostname or user@hostname without options');
 const config={sshHost,remoteHome:remotePath(value.remoteHome,'remoteHome'),remotePlugin:remotePath(value.remotePlugin,'remotePlugin'),remoteNode:remotePath(value.remoteNode,'remoteNode'),localHome:localPath(value.localHome??defaultLocalHome(),'localHome'),localPlugin:localPath(value.localPlugin??defaultLocalPlugin(),'localPlugin')};
 if(value.codexBinary!==undefined)config.codexBinary=localPath(value.codexBinary,'codexBinary');
 return Object.freeze(config);
}
export function loadRemoteConfig(path=process.env.REEL_REMOTE_CONFIG){
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||normalize(path)!==path)throw new Error('Set REEL_REMOTE_CONFIG to a normalized absolute JSON file path to enable the remote route');
 let data;try{data=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('The remote configuration file could not be read as JSON');}
 return validateRemoteConfig(data);
}
