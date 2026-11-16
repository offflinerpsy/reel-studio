// Private installation preferences. This file never contains provider credentials.
import {readFileSync,writeFileSync,renameSync,existsSync,chmodSync,lstatSync,mkdirSync} from 'node:fs';
import {join,isAbsolute,normalize} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateRemoteConfig} from './remote-config.mjs';

const path=z.string().min(2).max(2000).refine(v=>isAbsolute(v)&&normalize(v)===v&&!/[\x00-\x1f]/.test(v)&&!v.endsWith('/'),'Use a normalized absolute path');
export const settingsSchema=z.object({
 mode:z.enum(['local','ssh']),localHome:path,localPlugin:path,
 engine:z.enum(['codex','claude']).optional(),
 remote:z.object({sshHost:z.string().max(250),remoteHome:z.string().max(2000),remotePlugin:z.string().max(2000),remoteNode:z.string().max(2000)}).strict().optional(),
 telegramChatId:z.string().max(100).refine(v=>v===''||/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(v),'Use an exact Telegram chat ID or channel @handle').default('')
}).strict().superRefine((v,ctx)=>{if(v.mode==='ssh'||v.remote){try{validateRemoteConfig({...v.remote,localHome:v.localHome,localPlugin:v.localPlugin});}catch{ctx.addIssue({code:'custom',message:'Check the SSH host and normalized absolute remote paths',path:['remote']});}}});
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
function privateWrite(file,value){
 if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('Settings path must not be a symbolic link');
 const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,file);chmodSync(file,0o600);
}
export function installationSettings({home,pluginRoot,runtimeLabel,env=process.env}){
 const file=join(home,'installation-settings.json');
 const defaults=()=>({mode:'local',localHome:home,localPlugin:pluginRoot,telegramChatId:'',engine:'codex'});
 function read(){let config=defaults(),saved=false;if(existsSync(file)){if(lstatSync(file).isSymbolicLink())throw new Error('Settings path must not be a symbolic link');try{config=settingsSchema.parse(JSON.parse(readFileSync(file,'utf8')));saved=true;}catch{throw new Error('The private installation settings file is invalid; correct or remove it on this server');}}
  config.engine??='codex';
  return {config,saved,active:{runtime:runtimeLabel,host:hostname(),home,pluginRoot,telegram:{credentialEnv:'REEL_TELEGRAM_BOT_TOKEN',targetEnv:'REEL_TELEGRAM_CHAT_ID',credentialsPresent:Boolean(env.REEL_TELEGRAM_BOT_TOKEN),target:env.REEL_TELEGRAM_CHAT_ID||'',deliveryVerified:false}},requiresReconnect:true};
 }
 function save(value){const config=settingsSchema.parse(value);config.engine??=read().config.engine;privateWrite(file,config);return read();}
 function setEngine(engine){return save({...read().config,engine:z.enum(['codex','claude']).parse(engine)});}
 function setup(){const {config}=read(),dir=join(home,'installation-setup');if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new Error('Setup directory must not be a symbolic link');mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const runner=join(config.localPlugin,'scripts','run-server.sh');let command,remoteConfigPath=null;
  if(config.mode==='ssh'){remoteConfigPath=join(dir,'remote.json');privateWrite(remoteConfigPath,validateRemoteConfig({...config.remote,localHome:config.localHome,localPlugin:config.localPlugin}));command=`REEL_REMOTE_CONFIG=${quote(remoteConfigPath)} ${quote(runner)}`;}
  else command=`env -u REEL_REMOTE_CONFIG REEL_STUDIO_HOME=${quote(config.localHome)} ${quote(runner)}`;
  return {command,remoteConfigPath,telegramTargetCommand:config.telegramChatId?`export REEL_TELEGRAM_CHAT_ID=${quote(config.telegramChatId)}`:null,credentialEnv:'REEL_TELEGRAM_BOT_TOKEN',requiresReconnect:true,applied:false};
 }
 return {read,save,setup,setEngine};
}
