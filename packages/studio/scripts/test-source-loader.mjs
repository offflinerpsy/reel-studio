import {resolve} from 'node:path';

// The isolated patch intentionally excludes generated UI/media/plugin metadata.
// This opt-in test loader reuses only their original read-only resource root;
// imports and executable server logic still resolve from the staged snapshot.
const indexURL=new URL('../server/index.mjs',import.meta.url).href;
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);
 if(url===indexURL&&process.env.REEL_TEST_RESOURCE_ROOT){
  const original="const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');";
  const source=typeof result.source==='string'?result.source:new TextDecoder().decode(result.source);
  const replacement='const root='+JSON.stringify(resolve(process.env.REEL_TEST_RESOURCE_ROOT))+';';
  // Node's test subprocess may inherit/register the same loader twice.
  if(!source.includes(original)){if(source.includes(replacement))return result;throw new Error('Staged index resource-root anchor changed.');}
  return {...result,source:source.replace(original,replacement)};
 }
 return result;
}
