import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const version=JSON.parse(await readFile('plugin.json','utf8')).version;
const ui=await build({entryPoints:['ui/app.jsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,minify:true,loader:{'.woff2':'dataurl','.jpg':'dataurl','.mp4':'dataurl'},define:{'process.env.NODE_ENV':'"production"','__REEL_UI_VERSION__':JSON.stringify(version)}});
const js=ui.outputFiles.find(f=>f.path.endsWith('.js'))?.text || ui.outputFiles[0].text;
const css=((await readFile('ui/style.css','utf8'))+'\n'+(await readFile('ui/workflow-panels.css','utf8')));
await writeFile('dist/workspace.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reel Studio</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);
if (!process.argv.includes('--ui-only')) {
await build({entryPoints:['server/index.mjs'],outfile:'dist/server.mjs',bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
await copyFile('server/owner-host/host_probe.py','dist/host_probe.py');
  console.log('Reel Studio: built server and app');
} else {
  console.log('Reel Studio: built app only');
}
