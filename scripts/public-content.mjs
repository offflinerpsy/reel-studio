import {createHash} from 'node:crypto';

// A supporting publication gate, not a substitute for exact-tree/manual review.
// These three font files were reviewed with their upstream license notices.
const fonts=new Map([
 ['studio/skills/kinetic-promo-video/assets/runtime/Anton.ttf','fd9301f2837c99df2be07cc7f0be66e9470f5354d8fcf1606027c67fcd637a53'],
 ['studio/skills/kinetic-promo-video/assets/runtime/Manrope.ttf','3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6'],
 ['studio/skills/portfolio-showreel-video/assets/starter/assets/runtime/Manrope.ttf','3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6'],
]);
// Sanitized software showcase assets: review changes before updating an exact digest.
// Unlike fonts, these paths are identical in the source tree and standalone package.
const showcaseMedia=new Map([
 ['docs/media/reel-studio-demo.gif','8f519cf14af1e7ef45c14947a0594a84e342e7a07997634da1270478e0057934'],
 ['docs/media/reel-studio-demo.mp4','03dddf420e93fdc3d40d710606c927e6c2e4cb5a8e72bde753578c048b8f1a67'],
 ['docs/media/reel-studio-overview.png','990c2ce8c868673b34e3d345aaf5d5498d30af6b6dceacf94b9604572f3975a7'],
]);
const rules=[
 ['private path',/\/(?:Users|home)\/[A-Za-z0-9_.-]+|\/root\/|[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[A-Za-z0-9_.-]+/g],
 ['private identifier',/\b(?:thr|proj|host)_[A-Za-z0-9_-]{12,}\b/g],
 ['private channel identifier',/\bUC[A-Za-z0-9_-]{22}\b/g],
 ['credential',/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{20,}|\d{8,12}:[A-Za-z0-9_-]{30,})\b/g],
 ['credential',/["']?(?:AZURE_SPEECH_KEY|AWS_SECRET_ACCESS_KEY|api[_-]?key|client[_-]?secret|access[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_+./=-]{20,}["']|^\s*(?:AZURE_SPEECH_KEY|AWS_SECRET_ACCESS_KEY|API_KEY|CLIENT_SECRET|ACCESS_TOKEN)\s*=\s*[A-Za-z0-9_+./=-]{20,}\s*$/gim],
];
const numericChannelFixtures=new Set(['UC'+'1234567890123456789012','UC'+'9999999999999999999999']);
function fixtureMatch(name,label,value){
 // Only named synthetic identities in test source or this extracted helper are exempt, never an
 // arbitrary token, path or a private ID merely because it appears in tests.
 const testSource=/^(?:packages\/(?:studio|bb)\/)?tests\/.*\.test\.mjs$/.test(name)
  ||name==='packages/studio/tests/runtime-adoption-fixtures.mjs';
 if(!testSource)return false;
 return label==='private identifier'&&/^(?:thr|proj|host)_fixture_/.test(value)
  ||label==='private channel identifier'&&numericChannelFixtures.has(value);
}
function instanceData(value){
 if(!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(instanceData);
 if(typeof value.channel==='string'&&typeof value.account==='string')return true;
 if(Array.isArray(value.accounts)&&value.accounts.length>0)return true;
 if(value.connections&&typeof value.connections==='object'&&Object.keys(value.connections).length>0)return true;
 if('schema' in value&&'revision' in value&&'projects' in value&&'accounts' in value)return true;
 return Object.values(value).some(instanceData);
}
export function inspectPublicContent(name,data){
 name=name.split('\\').join('/');const findings=[];
 if(showcaseMedia.has(name))return showcaseMedia.get(name)===createHash('sha256').update(data).digest('hex')?[]:['unreviewed media bytes'];
 if(/\.(?:mp4|mov|m4v|webm|mp3|wav|m4a|gif|png|jpe?g|webp|avif|heic)$/i.test(name))return ['media file'];
 if(data.includes(0)){
  const canonical=name.replace(/^packages\//,'');
  if(fonts.get(canonical)!==createHash('sha256').update(data).digest('hex'))findings.push('unexpected binary');
  return findings;
 }
 const text=data.toString('utf8');
 for(const [label,pattern] of rules){pattern.lastIndex=0;if(!findings.includes(label)&&[...text.matchAll(pattern)].some(m=>!fixtureMatch(name,label,m[0])))findings.push(label);}
 if(/^\s*[\[{]/.test(text)){try{if(instanceData(JSON.parse(text)))findings.push('private instance data');}catch{/* Schema validation belongs to the owning tool. */}}
 return findings;
}
