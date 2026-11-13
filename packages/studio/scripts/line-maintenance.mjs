#!/usr/bin/env node
import {readFileSync,lstatSync} from 'node:fs';
import {maintainLine,readLineMaintenance} from '../server/maintenance-api.mjs';

// One protected packet, not shell commands, arbitrary paths or an agent job.
try{
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--input-file')throw new Error('Use --input-file with the exact private maintenance packet.');
  const st=lstatSync(args[1]);
  if(!st.isFile()||st.isSymbolicLink()||st.size>65536||(st.mode&0o777)!==0o600)throw new Error('The maintenance packet must be a bounded 0600 file.');
  const input=JSON.parse(readFileSync(args[1],'utf8'));
  const result=input.action==='read'?readLineMaintenance(input):maintainLine(input);
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  process.stdout.write(JSON.stringify({ok:false,error:String(error.message).slice(0,400),...(error.maintenanceResult?{result:error.maintenanceResult,configActivated:error.configActivated,reconcileSameTarget:true}:{}),productionStarted:false})+'\n');
  process.exitCode=1;
}
