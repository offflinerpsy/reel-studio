import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNarrationService } from '../server/narration.mjs';
import { listAzureSpeechVoices, synthesizeAzureSpeech } from '../server/speech-providers.mjs';

const wav = () => {
  const bytes = Buffer.alloc(44 + 48000); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(48000, 40); return bytes;
};
const script = 'This is the opening. This is the entire final sentence.';
const input = { requestKey: 'operation_0001', text: script, voice: 'en-US-GuyNeural', style: 'friendly', rate: '+5%' };
const getCredentials = async service => { assert.equal(service, 'azure'); return { key: 'own-secret-key', region: 'eastus' }; };
const listVoices = async () => ({ voices: [{ id: 'en-US-GuyNeural', locale: 'en-US', type: 'Neural', styles: ['friendly'] }] });
async function fixture(t) { const home = await mkdtemp(join(tmpdir(), 'reel-narration-')); t.after(() => rm(home, { recursive: true, force: true })); return home; }
function result() { return { audio: wav(), provider: 'Microsoft Azure Speech', model: 'azure-speech-neural-tts', wordTimings: [{ text: 'This', offset: 0, duration: 50 }, { text: 'sentence.', offset: 800, duration: 100 }] }; }

test('full script uses one own-account synthesis, saves private WAV and real timings, and returns source-free metadata', async t => {
  const home = await fixture(t); let calls = 0;
  const service = createNarrationService(home, { getCredentials, listVoices, synthesize: async request => {
    calls++; assert.equal(request.text, script); assert.equal(request.style, 'friendly'); assert.equal(request.rate, '+5%'); assert.equal(request.credentials.key, 'own-secret-key'); return result();
  } });
  const receipt = await service.generate(input); const cached = await service.generate(input);
  assert.equal(calls, 1); assert.equal(cached.reused, true); assert.equal(receipt.status, 'complete'); assert.equal(receipt.duration, 1);
  assert.equal(receipt.mediaId, `speech-${receipt.id}`); assert.equal(receipt.file, join(home, 'speech-audio', `${receipt.id}.wav`));
  assert.equal((await readFile(receipt.file)).compare(wav()), 0);
  assert.deepEqual(JSON.parse(await readFile(receipt.timingsPath, 'utf8')), { unit: 'milliseconds', words: result().wordTimings });
  const rawReceipt = await readFile(join(home, 'narration', `${receipt.id}.json`), 'utf8');
  for (const secret of [script, 'own-secret-key']) { assert.equal(rawReceipt.includes(secret), false); assert.equal(JSON.stringify(await service.read(receipt.id)).includes(secret), false); }
  assert.equal((await stat(join(home, 'narration', `${receipt.id}.json`))).mode & 0o777, 0o600);
  assert.equal((await service.reconcile(receipt.id)).status, 'complete'); assert.equal(calls, 1);
});

test('double click and transport ambiguity never replay synthesis, including a new service instance', async t => {
  const home = await fixture(t); let calls = 0; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const options = { getCredentials, listVoices, synthesize: async () => { calls++; await gate; throw new Error('secret-provider-token untrusted failure'); } };
  const service = createNarrationService(home, options);
  const first = service.generate(input); while (!calls) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(service.generate(input), /reserved|reconciliation|cannot be read/);
  release(); await assert.rejects(first, error => error.code === 'narration_synthesis_unverified' && !error.message.includes('secret-provider-token'));
  const other = createNarrationService(home, options); await assert.rejects(other.generate(input), /reconciliation/); assert.equal(calls, 1);
  const id = (await import('node:crypto')).createHash('sha256').update('narration:operation_0001').digest('hex').slice(0, 32);
  assert.equal((await other.reconcile(id)).effect, 'possibly_delivered'); assert.equal(calls, 1);
  assert.equal((await readFile(join(home, 'narration', `${id}.json`), 'utf8')).includes('secret-provider-token'), false);
});

test('requestKey guards changed inputs, new explicit intent can synthesize same script, corrupted artifacts never replay', async t => {
  const home = await fixture(t); let calls = 0;
  const service = createNarrationService(home, { getCredentials, listVoices, synthesize: async () => { calls++; return result(); } });
  const receipt = await service.generate(input);
  await assert.rejects(service.generate({ ...input, text: 'A changed script.' }), /different script/);
  await service.generate({ ...input, requestKey: 'operation_0002' }); assert.equal(calls, 2);
  await writeFile(receipt.file, 'corrupted'); assert.equal((await service.reconcile(receipt.id)).status, 'artifact_unverified');
  await assert.rejects(service.generate(input), /reconciliation/); assert.equal(calls, 2);
});

test('input and catalog eligibility fail before billing, and REST remains explicit without fabricated timings', async t => {
  const home = await fixture(t); let calls = 0;
  const service = createNarrationService(home, { getCredentials, listVoices, synthesize: async request => { calls++; assert.equal(request.mode, 'rest'); return { ...result(), wordTimings: null }; } });
  for (const bad of [{ text: 'x'.repeat(5001) }, { voice: 'missing' }, { style: 'shouting' }, { rate: 'invalid' }, { locale: '../en' }, { route: 'dragonhd' }]) await assert.rejects(service.generate({ ...input, ...bad }));
  assert.equal(calls, 0);
  const receipt = await service.generate({ ...input, mode: 'rest' }); assert.equal(receipt.hasWordTimings, false); assert.equal(receipt.timingsPath, null); assert.equal(calls, 1);
});

test('Azure auth injection uses the selected connection and does not borrow environment or host credentials', async () => {
  const credentials = { key: 'own-secret-key', region: 'eastus' }; let calls = 0;
  const fetchImpl = async (url, init) => { calls++; assert.match(url, /eastus\.tts\.speech\.microsoft\.com/); assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'own-secret-key'); if (!url.endsWith('voices/list')) assert.equal(init.body.includes(script), true); return new Response(url.endsWith('voices/list') ? '[]' : wav()); };
  const env = { AZURE_SPEECH_KEY: 'other-account-key', AZURE_SPEECH_REGION: 'westus', AZURE_SPEECH_CONFIG_PATH: '/nonexistent' };
  await listAzureSpeechVoices({ credentials, env, fetchImpl }); await synthesizeAzureSpeech({ credentials, env, fetchImpl, text: script });
  assert.equal((await listAzureSpeechVoices({ credentials: {}, env, fetchImpl })).configured, false); assert.equal(calls, 2);
});

test('durable operation keys resolve through restart without synthesis and saved listings remain source-free', async t => {
  const home = await fixture(t); let calls = 0;
  const options = { getCredentials, listVoices, synthesize: async () => { calls++; return result(); } };
  const service = createNarrationService(home, options); assert.deepEqual(await service.list(), []); assert.equal(await service.latest(), null);
  const receipt = await service.generate(input); assert.equal(receipt.requestKey, input.requestKey);
  const raw = JSON.parse(await readFile(join(home, 'narration', `${receipt.id}.json`), 'utf8')); assert.equal(raw.requestKey, input.requestKey);
  const restarted = createNarrationService(home, options);
  assert.deepEqual(await restarted.readByKey(input.requestKey), await restarted.read(receipt.id));
  assert.equal(await restarted.readByKey('unknown_operation'), null); assert.equal((await restarted.latest()).id, receipt.id);
  const listed = await restarted.list({ limit: 1 }); assert.equal(listed.length, 1); assert.equal(listed[0].id, receipt.id); assert.equal(listed[0].artifactVerification, 'not_rechecked');
  assert.equal(JSON.stringify(listed).includes(script), false); assert.equal(JSON.stringify(listed).includes('own-secret-key'), false); assert.equal(JSON.stringify(listed).includes('sentence.'), false);
  assert.equal(calls, 1);
});

test('key lookup preserves uncertain fences and resolves legacy and default operation identities', async t => {
  const home = await fixture(t); let calls = 0;
  const service = createNarrationService(home, { getCredentials, listVoices, synthesize: async () => { calls++; throw new Error('secret failure'); } });
  await assert.rejects(service.generate(input)); const uncertain = await service.readByKey(input.requestKey); assert.equal(uncertain.requestKey, input.requestKey); assert.equal(uncertain.effect, 'possibly_delivered');
  const restarted = createNarrationService(home, { getCredentials, listVoices, synthesize: async () => { calls++; return result(); } });
  assert.equal((await restarted.latest()).effect, 'possibly_delivered'); await assert.rejects(restarted.generate(input), /reconciliation/); assert.equal(calls, 1);
  const receiptPath = join(home, 'narration', `${uncertain.id}.json`); const legacy = JSON.parse(await readFile(receiptPath, 'utf8')); delete legacy.requestKey; await writeFile(receiptPath, JSON.stringify(legacy));
  assert.equal((await restarted.readByKey(input.requestKey)).requestKey, input.requestKey); assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).requestKey, undefined);
  const { requestKey, ...withoutKey } = input; const automatic = await restarted.generate(withoutKey); assert.equal(automatic.requestKey, automatic.id); assert.equal((await restarted.readByKey(automatic.requestKey)).id, automatic.id);
});

test('listing sorts safe receipts, bounds count, and latest independently rechecks selected artifacts', async t => {
  const home = await fixture(t); const service = createNarrationService(home, { getCredentials, listVoices, synthesize: async () => result() });
  const first = await service.generate(input), second = await service.generate({ ...input, requestKey: 'operation_0002' });
  const firstPath = join(home, 'narration', `${first.id}.json`); const raw = JSON.parse(await readFile(firstPath, 'utf8')); raw.completedAt = '2100-01-01T00:00:00.000Z'; await writeFile(firstPath, JSON.stringify(raw));
  assert.deepEqual((await service.list({ limit: 2 })).map(item => item.id), [first.id, second.id]);
  await writeFile(first.file, 'corrupted'); assert.equal((await service.latest()).status, 'artifact_unverified');
  for (const limit of [0, 101, 1.5]) await assert.rejects(service.list({ limit }), /1-100/);
  const invalid = 'f'.repeat(32); await writeFile(join(home, 'narration', `${invalid}.json`), 'not JSON own-secret-key');
  const listed = await service.list(); assert.equal(listed.find(item => item.id === invalid).status, 'receipt_unverified'); assert.equal(JSON.stringify(listed).includes('own-secret-key'), false);
});

test('listing stops at a bounded directory size and never invents a latest receipt beyond that boundary', async t => {
  const home = await fixture(t); const directory = join(home, 'narration'); await mkdir(directory);
  for (let start = 0; start < 4097; start += 100) await Promise.all(Array.from({ length: Math.min(100, 4097 - start) }, (_, offset) => writeFile(join(directory, `ignored-${start + offset}`), '')));
  const service = createNarrationService(home);
  await assert.rejects(service.list(), error => error.code === 'narration_list_limit'); await assert.rejects(service.latest(), error => error.code === 'narration_list_limit');
});

test('reconciliation does not verify substituted audio, timings or artifact directories through symlinks', async t => {
  for (const artifact of ['audio', 'timings', 'audio-directory']) {
    const home = await fixture(t); let calls = 0;
    const service = createNarrationService(home, {getCredentials, listVoices, synthesize: async () => {calls++; return result();}});
    const receipt = await service.generate(input);
    const path = artifact === 'audio' ? receipt.file : artifact === 'timings' ? receipt.timingsPath : join(home, 'speech-audio');
    await rename(path, `${path}.original`); await symlink(`${path}.original`, path);
    const read = await service.readByKey(input.requestKey);
    assert.equal(read.status, 'artifact_unverified', artifact);
    assert.equal(read.effect, 'delivered_unverified'); assert.equal(read.file, undefined);
    await assert.rejects(service.generate(input), /reconciliation/); assert.equal(calls, 1);
  }
});
