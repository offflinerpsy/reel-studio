import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createSourceHostAuthorityVerifier} from './owner-host/authority-verifier.mjs';

// A root-provisioned private file installs the existing Store verifier. Tools
// cannot set it. Binding refresh can replace this file by CAS; the next Store
// call recreates its verifier without restarting a service or changing a job.
export function configuredAuthorityVerifier(home,{factory=createSourceHostAuthorityVerifier}={}) {
  const configPath=join(home,'reel-owner-authority.json');
  let loadedSha=null,loaded=null;
  return input=>{
    let before;
    try{before=lstatSync(configPath);}catch(error){if(error.code==='ENOENT')throw new Error('A trusted server authority verifier configuration is required. No ownership or job transition was accepted.');throw error;}
    if(!before.isFile()||before.isSymbolicLink()||(before.mode&0o077)!==0||before.size>65536||![0,process.getuid?.()].includes(before.uid))throw new Error('Reel authority config is not a bounded private server file.');
    const raw=readFileSync(configPath),after=lstatSync(configPath);
    if(raw.length>65536||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Reel authority config changed during read.');
    const sha=createHash('sha256').update(raw).digest('hex');
    if(sha!==loadedSha) {
      const next=factory({configPath,python:'/usr/bin/python3'});
      if(createHash('sha256').update(readFileSync(configPath)).digest('hex')!==sha)throw new Error('Reel authority config changed during verifier binding.');
      loaded=next;loadedSha=sha;
    }
    return loaded(input);
  };
}
