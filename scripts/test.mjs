import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root} from './common.mjs';
const checks=[['node',['--test','tests/tooling.test.mjs'],root],['node',['--test','--test-timeout=30000','tests/store.test.mjs','tests/workflow-guards.test.mjs','tests/ui-startup.test.mjs'],join(root,'packages/studio')],['node',['--test','--test-timeout=30000','tests/gateway.test.mjs','tests/handoffs.test.mjs'],join(root,'packages/bb')]];
for(const [cmd,args,cwd] of checks) { const r=spawnSync(cmd,args,{cwd,stdio:'inherit',timeout:120000}); if(r.error) console.error(r.error.message); if(r.status!==0) process.exit(r.status ?? 1); }
