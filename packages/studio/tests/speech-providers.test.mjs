import test,{after} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixtureHome=mkdtempSync(join(tmpdir(),'reel-speech-fixture-'));
const fixtureConfig=join(fixtureHome,'speech.json');
writeFileSync(fixtureConfig,'{}',{mode:0o600});
after(()=>rmSync(fixtureHome,{recursive:true,force:true}));
import assert from 'node:assert/strict';
import { azureSpeechConfig, listAzureSpeechVoices, synthesizeAzureSpeech } from '../server/speech-providers.mjs';

const wav = (() => { const b=Buffer.alloc(44+480); b.write('RIFF',0); b.writeUInt32LE(b.length-8,4); b.write('WAVE',8); b.write('fmt ',12); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(24000,24); b.writeUInt32LE(48000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(480,40); return b; })();

test('Azure Speech catalog never exposes credentials and preserves live voice fields', async () => {
  assert.deepEqual(azureSpeechConfig({ AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_CONFIG_PATH: '/tmp/reel-studio-no-speech-config' }), { configured: true, authMode: 'subscription_key', region: 'swedencentral', key: 'secret', token: null, resourceId: null, endpoint: null, subscriptionId: null, tenantId: null });
  const result = await listAzureSpeechVoices({ env: { AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_REGION: 'eastus', AZURE_SPEECH_CONFIG_PATH: '/tmp/reel-studio-no-speech-config' }, fetchImpl: async (url, init) => {
    assert.match(url, /eastus\.tts\.speech\.microsoft\.com/); assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'secret');
    return new Response(JSON.stringify([{ ShortName: 'en-US-GuyNeural', LocalName: 'Guy', Locale: 'en-US', Gender: 'Male', VoiceType: 'Neural', StyleList: ['friendly'] }]));
  } });
  assert.equal(result.voices[0].id, 'en-US-GuyNeural'); assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Azure Speech synthesis returns immutable request and audio receipts', async () => {
  const result = await synthesizeAzureSpeech({ text: 'Probe.', env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret' }, fetchImpl: async (url, init) => {
    assert.match(url, /swedencentral\.tts\.speech\.microsoft\.com/); assert.match(init.body, /en-US-GuyNeural/); return new Response(wav);
  } });
  assert.match(result.requestId, /^[a-f0-9]{32}$/); assert.equal(result.bytes, wav.length); assert.equal(result.sha256.length, 64); assert.equal(result.audio.compare(wav), 0); assert.equal(result.ssml.includes('Probe.'), true);
});

test('Azure Speech rejects unsafe endpoint input and malformed PCM', async () => {
  await assert.rejects(() => listAzureSpeechVoices({ env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_REGION: 'https://evil.example' }, fetchImpl: async () => new Response('') }), /Invalid Azure Speech region/);
  await assert.rejects(() => synthesizeAzureSpeech({ text: 'Probe.', env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret' }, fetchImpl: async () => new Response(Buffer.alloc(52)) }), /invalid WAV/);
});

test('Azure Speech once fence returns cached artifacts and refuses incomplete reservations', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'azure-speech-')); const receiptDir=join(root,'receipts'), outputDir=join(root,'audio');
  let calls=0; const fetchImpl=async () => { calls++; return new Response(wav); }; const input={mode:'rest',text:'Cache me.',env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig,AZURE_SPEECH_KEY:'secret'},receiptDir,outputDir,fetchImpl};
  const first=await (await import('../server/speech-providers.mjs')).synthesizeAzureSpeechOnce(input); const second=await (await import('../server/speech-providers.mjs')).synthesizeAzureSpeechOnce(input);
  assert.equal(calls,1); assert.equal(first.sha256,second.sha256); rmSync(root,{recursive:true,force:true});
});

test('Azure Speech style is catalog-bound and resource identity changes the request fence', async () => {
  const { synthesizeAzureSpeechOnce } = await import('../server/speech-providers.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'azure-speech-resource-'));
  const calls=[]; const fetchImpl=async (url, init) => { calls.push({url, body:init.body}); return new Response(wav); };
  const base={mode:'rest',text:'Style fence.',voice:'en-US-GuyNeural',voiceType:'Neural',style:'friendly',receiptDir:join(root,'receipts'),outputDir:join(root,'audio'),fetchImpl};
  const one=await synthesizeAzureSpeechOnce({...base,env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig,AZURE_SPEECH_KEY:'secret',AZURE_SPEECH_RESOURCE_ID:'/subscriptions/a/resourceGroups/r/providers/Microsoft.CognitiveServices/accounts/one',AZURE_SPEECH_ENDPOINT:'https://one.cognitiveservices.azure.com/'}});
  const two=await synthesizeAzureSpeechOnce({...base,env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig,AZURE_SPEECH_KEY:'secret',AZURE_SPEECH_RESOURCE_ID:'/subscriptions/a/resourceGroups/r/providers/Microsoft.CognitiveServices/accounts/two',AZURE_SPEECH_ENDPOINT:'https://two.cognitiveservices.azure.com/'}});
  assert.notEqual(one.requestId,two.requestId); assert.match(calls[0].body,/mstts:express-as/); assert.match(calls[0].body,/style="friendly"/); assert.equal(one.resourceIdentity.includes('/accounts/one'),true);
  await assert.rejects(() => synthesizeAzureSpeechOnce({...base,voice:'en-US-Grant:MAI-Voice-2.1',voiceType:'NeuralHD',env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig,AZURE_SPEECH_KEY:'secret'},receiptDir:join(root,'hd-receipts'),outputDir:join(root,'hd-audio')}), /NeuralHD/);
  assert.equal(calls.length,2); rmSync(root,{recursive:true,force:true});
});


test('Azure CLI credential refresh checks the existing subscription and tenant without persisting tokens', async () => {
  const calls=[]; const execFileImpl=async (bin,args) => { calls.push([bin,args]); if(args[1]==='show') return {stdout:JSON.stringify({id:'sub-1',tenantId:'tenant-1',user:'person@example.test'})}; return {stdout:JSON.stringify({accessToken:'short-lived-token'})}; };
  const env={AZURE_SPEECH_CONFIG_PATH:fixtureConfig,AZURE_SPEECH_USE_AZURE_CLI:'1',AZURE_SPEECH_SUBSCRIPTION_ID:'sub-1',AZURE_SPEECH_TENANT_ID:'tenant-1',AZURE_SPEECH_RESOURCE_ID:'/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/speech',AZURE_SPEECH_ENDPOINT:'https://speech.cognitiveservices.azure.com/'};
  const catalog=await listAzureSpeechVoices({env,execFileImpl,fetchImpl:async (_url,init)=>{assert.equal(init.headers.Authorization,'Bearer aad#/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/speech#short-lived-token');return new Response('[]');}});
  assert.equal(catalog.authMode,'azure_cli'); assert.equal(calls.length,2); assert.equal(calls[1][1][0],'account');
  await assert.rejects(() => listAzureSpeechVoices({env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig,...env,AZURE_SPEECH_TENANT_ID:'wrong'},execFileImpl,fetchImpl:async()=>new Response('[]')}), /does not match/);
});

test('DragonHD opt-in preserves the selected resource and caches the single narration', async () => {
  const { synthesizeAzureSpeechOnce } = await import('../server/speech-providers.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'azure-dragonhd-')); let calls = 0;
  const request = { mode: 'rest', route: 'dragonhd', voice: 'en-GB-Ryan:DragonHDLatestNeural', voiceType: 'NeuralHD', locale: 'en-GB', text: 'Moist air rises & cools.', receiptDir: join(root, 'receipts'), outputDir: join(root, 'audio'), env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_ENDPOINT: 'https://existing.cognitiveservices.azure.com' }, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://existing.cognitiveservices.azure.com/tts/cognitiveservices/v1');
    assert.match(init.body, /xmlns="http:\/\/www.w3.org\/2001\/10\/synthesis"/);
    assert.match(init.body, /en-GB-Ryan:DragonHDLatestNeural/); assert.match(init.body, /rises &amp; cools/);
    assert.doesNotMatch(init.body, /<prosody|<mstts:express-as/); return new Response(wav);
  } };
  try {
    const first = await synthesizeAzureSpeechOnce(request); const second = await synthesizeAzureSpeechOnce(request);
    assert.equal(calls, 1); assert.equal(first.requestId, second.requestId); assert.equal(first.model, 'azure-speech-dragonhd-tts');
    assert.equal(first.resourceIdentity, 'https://existing.cognitiveservices.azure.com'); assert.equal(first.wordTimings, null);
    assert.equal((await readFile(join(root, 'receipts', first.requestId + '.json'), 'utf8')).includes('secret'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('DragonHD requires explicit route and catalog type, and rejects unsupported controls before dispatch', async () => {
  let calls = 0; const base = { text: 'Probe.', voice: 'en-GB-Ryan:DragonHDLatestNeural', voiceType: 'NeuralHD', locale: 'en-GB', env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret' }, fetchImpl: async () => { calls++; return new Response(wav); } };
  await assert.rejects(() => synthesizeAzureSpeech(base), /NeuralHD/);
  await assert.rejects(() => synthesizeAzureSpeech({ ...base, route: 'dragonhd', voiceType: 'Neural' }), /verified NeuralHD/);
  await assert.rejects(() => synthesizeAzureSpeech({ ...base, route: 'dragonhd', voice: 'en-US-Grant:MAI-Voice-2.1' }), /Invalid Azure Speech voice/);
  for (const control of [{ rate: '+5%' }, { pitch: '+2%' }, { style: 'friendly' }]) await assert.rejects(() => synthesizeAzureSpeech({ ...base, route: 'dragonhd', ...control }), /does not support/);
  await assert.rejects(() => synthesizeAzureSpeech({ ...base, route: 'other' }), /Invalid Azure Speech route/);
  assert.equal(calls, 0);
});

test('Explicit subscription-key resource endpoint is used for the free voice catalog', async () => {
  const result = await listAzureSpeechVoices({ env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_ENDPOINT: 'https://existing.cognitiveservices.azure.com' }, fetchImpl: async (url) => {
    assert.equal(url, 'https://existing.cognitiveservices.azure.com/tts/cognitiveservices/voices/list'); return new Response('[]');
  } });
  assert.equal(result.configured, true);
  await assert.rejects(() => listAzureSpeechVoices({ env:{AZURE_SPEECH_CONFIG_PATH:fixtureConfig, AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_ENDPOINT: 'https://wrong.example' }, fetchImpl: async () => { throw new Error('Must not dispatch'); } }), /Invalid Azure Speech resource endpoint/);
});
