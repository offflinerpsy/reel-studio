import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=process.cwd();const version=JSON.parse(await readFile('plugin.json','utf8')).version;
const out=resolve('../release',`reel-studio-${version}`);await mkdir(out,{recursive:true});
for(const entry of ['plugin.json','.codex-plugin','mcp.json','assets','dist','skills','README.md','THIRD_PARTY_LICENSES.txt'])await cp(join(source,entry),join(out,entry),{recursive:true});
await mkdir(join(out,'scripts'),{recursive:true});await cp('scripts/run-server.sh',join(out,'scripts/run-server.sh'));
await mkdir(join(out,'server'),{recursive:true});
for(const name of ['mac-worker.mjs','mac-protocol-proxy.mjs','mac-ui-relay.mjs','stdio-compress.mjs','compute-router.mjs','codex-runtime.mjs','revision-inputs.mjs'])await cp(join('server',name),join(out,'server',name));
await cp('../docs/PRODUCT-DESIGN.md',join(out,'PRODUCT-DESIGN.md'));
await mkdir(join(out,'licenses'),{recursive:true});
for(const name of ['react','react-dom','lucide-react','@modelcontextprotocol/sdk','@modelcontextprotocol/ext-apps','@openai/mcp-extensions','zod','esbuild']){
 for(const base of ['LICENSE','LICENSE.md','LICENSE.txt']){try{await cp(join('node_modules',name,base),join(out,'licenses',name.replace('/','-')+'-'+base));break;}catch{}}
}
await writeFile(join(out,'SOURCE.json'),JSON.stringify({source,version,compiledAt:new Date().toISOString(),serverSha256:createHash('sha256').update(await readFile('dist/server.mjs')).digest('hex')},null,2));
console.log(out);
