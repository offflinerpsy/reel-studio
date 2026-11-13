import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
const execFile = promisify(execFileCallback);
import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';

const DEFAULT_REGION = 'swedencentral';
const DEFAULT_VOICE = 'en-US-GuyNeural';
const MAX_TEXT = 5000;

const clean = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new TypeError(`Invalid ${label}`);
  return value.trim();
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requestId = value => sha256(Buffer.from(JSON.stringify(value))).slice(0, 32);
const regionId = value => { const v = clean(value, 'Azure Speech region').toLowerCase(); if (!/^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(v)) throw new TypeError('Invalid Azure Speech region'); return v; };

export const AZURE_SPEECH_MODEL = Object.freeze({
  id: 'azure-speech-neural-tts',
  provider: 'Microsoft Azure Speech',
  label: 'Azure Speech Neural TTS',
  outputFormat: 'riff-24khz-16bit-mono-pcm',
  region: DEFAULT_REGION,
});

// Explicit per-request opt-in. Existing standard voices and request fences keep
// their original model identity; selecting an HD voice never upgrades a route.
export const AZURE_DRAGON_HD_MODEL = Object.freeze({
  ...AZURE_SPEECH_MODEL,
  id: 'azure-speech-dragonhd-tts',
  label: 'Azure Speech Dragon HD TTS',
});

function hostSpeechConfig(env) {
  const path = env.AZURE_SPEECH_CONFIG_PATH || join(homedir(), '.config', 'reel-studio-speech.json');
  if (!existsSync(path)) return {};
  try { const value = JSON.parse(readFileSync(path, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { throw new Error('Invalid host-local Reel Studio Speech config'); }
}

export function azureSpeechConfig(env = process.env) {
  const host = hostSpeechConfig(env);
  const key = env.AZURE_SPEECH_KEY || env.AZURE_COGNITIVE_SERVICES_KEY || '';
  const cli = env.AZURE_SPEECH_USE_AZURE_CLI === '1' || host.auth === 'azure_cli';
  const token = env.AZURE_SPEECH_AAD_TOKEN || env.AZURE_COGNITIVE_SERVICES_AAD_TOKEN || '';
  const region = regionId(env.AZURE_SPEECH_REGION || host.region || DEFAULT_REGION);
  const resourceId = env.AZURE_SPEECH_RESOURCE_ID || host.resourceId || null;
  const endpointUrl = env.AZURE_SPEECH_ENDPOINT || host.endpoint || null;
  const subscriptionId = env.AZURE_SPEECH_SUBSCRIPTION_ID || host.subscriptionId || null;
  const tenantId = env.AZURE_SPEECH_TENANT_ID || host.tenantId || null;
  const managed = env.AZURE_SPEECH_USE_MANAGED_IDENTITY === '1';
  return { configured: Boolean(key || token || cli || managed), authMode: key ? 'subscription_key' : token ? 'entra_token' : cli ? 'azure_cli' : managed ? 'managed_identity' : 'none', region, key: key || null, token: token || null, resourceId, endpoint: endpointUrl, subscriptionId, tenantId };
}

async function managedIdentityToken(fetchImpl = fetch) {
  const url = 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fcognitiveservices.azure.com%2F';
  const response = await fetchImpl(url, { headers: { Metadata: 'true' }, redirect: 'error' });
  if (!response.ok) throw new Error(`Azure managed identity token request failed (${response.status})`);
  const body = await response.json();
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Azure managed identity returned no access token');
  return body.access_token;
}

async function azureCliToken(config, execFileImpl = execFile) {
  const account = JSON.parse((await execFileImpl('az', ['account', 'show', '--query', '{id:id,tenantId:tenantId,user:user.name}', '-o', 'json'], { timeout: 15000, maxBuffer: 64 * 1024 })).stdout);
  if (config.subscriptionId && account.id !== config.subscriptionId || config.tenantId && account.tenantId !== config.tenantId) { const error = new Error('Azure CLI account does not match the configured Speech subscription or tenant'); error.code = 'azure_speech_account_mismatch'; throw error; }
  const token = JSON.parse((await execFileImpl('az', ['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com/', '-o', 'json'], { timeout: 15000, maxBuffer: 64 * 1024 })).stdout);
  if (typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('Azure CLI returned no Speech access token');
  return token.accessToken;
}

async function resolveCredential({ env = process.env, fetchImpl = fetch, execFileImpl = execFile } = {}) {
  const config = azureSpeechConfig(env);
  if (!config.configured) return { ...config, credential: null };
  if (config.key) return { ...config, credential: { mode: 'subscription_key', value: config.key } };
  if (config.token) return { ...config, credential: { mode: 'entra_token', value: config.token } };
  if (config.authMode === 'azure_cli') return { ...config, credential: { mode: 'entra_token', value: await azureCliToken(config, execFileImpl) } };
  return { ...config, credential: { mode: 'entra_token', value: await managedIdentityToken(fetchImpl) } };
}

function authHeaders(credential, config = null) {
  if (!credential?.value) throw new Error('Azure Speech is not configured on this host');
  if (credential.mode === 'subscription_key') return { 'Ocp-Apim-Subscription-Key': credential.value };
  const value = config?.resourceId ? `aad#${config.resourceId}#${credential.value}` : credential.value;
  return { Authorization: `Bearer ${value}` };
}

function endpoint(region, path) {
  return `https://${regionId(region)}.tts.speech.microsoft.com/cognitiveservices/${path}`;
}
function resourceEndpoint(config, path) {
  const base = config.endpoint || (config.resourceId ? `https://${config.resourceId.split('/').at(-1)}.cognitiveservices.azure.com` : null);
  if (!base) throw new Error('Azure Entra Speech requires AZURE_SPEECH_RESOURCE_ID or AZURE_SPEECH_ENDPOINT');
  let parsed; try { parsed = new URL(base); } catch { throw new TypeError('Invalid Azure Speech resource endpoint'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !/^[A-Za-z0-9-]+\.cognitiveservices\.azure\.com$/.test(parsed.hostname)) throw new TypeError('Invalid Azure Speech resource endpoint');
  return `${parsed.origin}${path}`;
}

const voiceId = (value, route = 'standard') => { const v = clean(value, 'voice'); const valid = route === 'dragonhd' ? /^[A-Za-z]{2,4}-[A-Za-z0-9-]{2,60}:DragonHDLatestNeural$/.test(v) : /^[A-Za-z]{2,4}-[A-Za-z0-9-]{2,80}$/.test(v); if (!valid) throw new TypeError('Invalid Azure Speech voice'); return v; };
const localeId = value => { const v = clean(value, 'locale'); if (!/^[a-z]{2,3}-[A-Z]{2,4}$/.test(v)) throw new TypeError('Invalid Azure Speech locale'); return v; };
const rateValue = value => { if (value === undefined || value === null || value === '') return null; const v = clean(value, 'rate'); if (!/^(?:x-slow|slow|medium|fast|x-fast|[-+]?\d{1,3}%)$/.test(v)) throw new TypeError('Invalid Azure Speech rate'); return v; };
const pitchValue = value => { if (value === undefined || value === null || value === '') return null; const v = clean(value, 'pitch'); if (!/^(?:[-+]?\d{1,3}(?:Hz|%))$/.test(v)) throw new TypeError('Invalid Azure Speech pitch'); return v; };
const styleValue = value => { if (value === undefined || value === null || value === '') return null; const v = clean(value, 'style'); if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(v)) throw new TypeError('Invalid Azure Speech style'); return v; };
const resourceIdentity = config => { if (config.resourceId) return config.resourceId; if (config.endpoint) return new URL(config.endpoint).origin; return `azure-speech-region:${config.region}`; };
const assertStandardVoice = voiceType => { if (voiceType === 'NeuralHD') throw new Error('Azure Speech NeuralHD voices are not eligible for the standard Reel Studio route'); };

function speechModel({ route = 'standard', voice, voiceType, rate, pitch, style }) {
  if (route === 'standard') { assertStandardVoice(voiceType); return AZURE_SPEECH_MODEL; }
  if (route !== 'dragonhd') throw new TypeError('Invalid Azure Speech route');
  if (voiceType !== 'NeuralHD') throw new TypeError('DragonHD requires a verified NeuralHD catalog voice');
  voiceId(voice, route);
  if (rateValue(rate) || pitchValue(pitch) || styleValue(style)) throw new TypeError('DragonHD does not support prosody or express-as controls');
  return AZURE_DRAGON_HD_MODEL;
}

const speechUrl = (config, path) => config.endpoint || config.resourceId || config.credential.mode !== 'subscription_key'
  ? resourceEndpoint(config, `/tts/cognitiveservices/${path}`)
  : endpoint(config.region, path);

async function responseError(response) {
  let detail = '';
  try { detail = (await response.text()).slice(0, 300); } catch {}
  const error = new Error(`Azure Speech request failed (${response.status})`);
  error.code = `azure_speech_http_${response.status}`;
  error.detail = detail;
  return error;
}

/** Return the provider's current voice catalog. Credentials never appear in the result. */
export async function listAzureSpeechVoices({ env = process.env, fetchImpl = fetch, execFileImpl = execFile } = {}) {
  const config = await resolveCredential({ env, fetchImpl, execFileImpl });
  if (!config.configured) return { configured: false, provider: AZURE_SPEECH_MODEL.provider, voices: [], region: config.region };
  const url = speechUrl(config, 'voices/list');
  const response = await fetchImpl(url, {
    headers: authHeaders(config.credential, config), redirect: 'error',
  });
  if (!response.ok) throw await responseError(response);
  const raw = await response.json();
  const voices = Array.isArray(raw) ? raw.filter(v => v?.ShortName && v?.Locale).map(v => ({
    id: v.ShortName, name: v.LocalName || v.ShortName, locale: v.Locale,
    gender: v.Gender || 'Unknown', type: v.VoiceType || 'Neural', styles: Array.isArray(v.StyleList) ? v.StyleList : [],
  })) : [];
  return { configured: true, provider: AZURE_SPEECH_MODEL.provider, model: AZURE_SPEECH_MODEL.id, region: config.region, authMode: config.authMode, resourceId: config.resourceId, endpoint: config.endpoint, voices };
}

function ssml({ provider, text, voice, locale, rate, pitch, style }) {
  const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const prosody = [rate && `rate="${escape(rate)}"`, pitch && `pitch="${escape(pitch)}"`].filter(Boolean).join(' ');
  const spoken = prosody ? `<prosody ${prosody}>${escape(text)}</prosody>` : escape(text);
  const inner = style ? `<mstts:express-as style="${escape(style)}">${spoken}</mstts:express-as>` : spoken;
  const namespace = provider === AZURE_DRAGON_HD_MODEL.id ? ' xmlns="http://www.w3.org/2001/10/synthesis"' : '';
  return `<speak version="1.0"${namespace} xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escape(locale)}"><voice name="${escape(voice)}">${inner}</voice></speak>`;
}

/** Synthesize one deterministic request. The caller owns the output path and no-replay policy. */
export async function synthesizeAzureSpeech({ text, voice = DEFAULT_VOICE, locale = 'en-US', rate, pitch, style, voiceType, route = 'standard', env = process.env, fetchImpl = fetch, execFileImpl = execFile } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new TypeError(`Text must be 1-${MAX_TEXT} characters`);
  const model = speechModel({ route, voice, voiceType, rate, pitch, style });
  const config = await resolveCredential({ env, fetchImpl, execFileImpl });
  if (!config.configured) throw new Error('Azure Speech is not configured on this host');
  const input = { provider: model.id, resourceIdentity: resourceIdentity(config), region: config.region, voice: voiceId(voice, route), locale: localeId(locale), text, rate: rateValue(rate), pitch: pitchValue(pitch), style: styleValue(style), outputFormat: model.outputFormat };
  const id = requestId(input);
  const url = speechUrl(config, 'v1');
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error',
    headers: { ...authHeaders(config.credential, config), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': AZURE_SPEECH_MODEL.outputFormat, 'User-Agent': 'reel-studio-azure-speech/0.1' },
    body: ssml(input),
  });
  if (!response.ok) throw await responseError(response);
  const audio = Buffer.from(await response.arrayBuffer());
  const audioInfo = parsePcmWav(audio);
  return { requestId: id, provider: model.provider, model: model.id, region: config.region, authMode: config.authMode, resourceId: config.resourceId, resourceIdentity: input.resourceIdentity, voice: input.voice, locale: input.locale, style: input.style, format: model.outputFormat, bytes: audio.length, sha256: sha256(audio), duration: audioInfo.duration, audio, ssml: ssml(input), wordTimings: null };
}

export function parsePcmWav(audio) {
  const bytes = Buffer.from(audio || []);
  if (bytes.length < 44 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Azure Speech returned an invalid WAV payload');
  const declared = bytes.readUInt32LE(4); if (declared + 8 > bytes.length) throw new Error('WAV RIFF length is truncated');
  let offset = 12, fmt = null, data = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString(); const size = bytes.readUInt32LE(offset + 4); const start = offset + 8; const end = start + size;
    if (end > bytes.length) throw new Error('WAV chunk is truncated');
    if (id === 'fmt ') fmt = { format: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (id === 'data') data = { start, size };
    offset = end + (size % 2);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== 24000 || fmt.bits !== 16 || data.size <= 0 || data.size % 2) throw new Error('WAV is not valid 24 kHz mono PCM');
  return { ...fmt, dataBytes: data.size, duration: data.size / (fmt.rate * fmt.channels * fmt.bits / 8) };
}

/**
 * SDK synthesis captures real word-boundary events in the same synthesis call.
 * It is opt-in so the REST route remains available as an explicit no-timing fallback.
 */
export async function synthesizeAzureSpeechSdk({ text, voice = DEFAULT_VOICE, locale = 'en-US', rate, pitch, style, voiceType, route = 'standard', env = process.env, execFileImpl = execFile } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new TypeError(`Text must be 1-${MAX_TEXT} characters`);
  const model = speechModel({ route, voice, voiceType, rate, pitch, style });
  const config = await resolveCredential({ env, execFileImpl }); if (!config.configured) throw new Error('Azure Speech is not configured on this host');
  const input = { provider: model.id, resourceIdentity: resourceIdentity(config), region: config.region, voice: voiceId(voice, route), locale: localeId(locale), text, rate: rateValue(rate), pitch: pitchValue(pitch), style: styleValue(style), outputFormat: model.outputFormat };
  const id = requestId(input); const speech = config.credential.mode === 'subscription_key' ? speechSdk.SpeechConfig.fromSubscription(config.credential.value, config.region) : speechSdk.SpeechConfig.fromEndpoint(new URL(resourceEndpoint(config, '/')), { getToken: async () => ({ token: config.credential.value, expiresOnTimestamp: Date.now() + 300000 }) }); speech.speechSynthesisOutputFormat = speechSdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm; speech.voiceName = input.voice;
  const synthesizer = new speechSdk.SpeechSynthesizer(speech); const wordTimings = [];
  synthesizer.wordBoundary = (_sender, event) => { if (Number.isFinite(event.audioOffset) && typeof event.text === 'string') wordTimings.push({ text: event.text, offset: event.audioOffset / 10000, duration: Number(event.duration) / 10000 }); };
  let result; try { result = await new Promise((resolve, reject) => synthesizer.speakSsmlAsync(ssml(input), resolve, reject)); } finally { synthesizer.close(); }
  if (result.reason !== speechSdk.ResultReason.SynthesizingAudioCompleted) throw new Error(`Azure Speech SDK synthesis failed: ${result.errorDetails || result.reason}`);
  const audio = Buffer.from(result.audioData); const audioInfo = parsePcmWav(audio);
  return { requestId: id, provider: model.provider, model: model.id, region: config.region, authMode: config.authMode, resourceId: config.resourceId, resourceIdentity: input.resourceIdentity, voice: input.voice, locale: input.locale, style: input.style, format: model.outputFormat, bytes: audio.length, sha256: sha256(audio), duration: audioInfo.duration, audio, ssml: ssml(input), wordTimings: route === 'dragonhd' && !wordTimings.length ? null : wordTimings };
}

/** Reserve and atomically persist a synthesis receipt. An existing completed request is cacheable; an unfinished request is never replayed. */
export async function synthesizeAzureSpeechOnce({ receiptDir, outputDir, mode = 'sdk', ...request }) {
  if (typeof receiptDir !== 'string' || typeof outputDir !== 'string') throw new TypeError('receiptDir and outputDir are required');
  if (!['sdk', 'rest'].includes(mode)) throw new TypeError('Invalid Azure Speech synthesis mode');
  const env = request.env || process.env; const config = azureSpeechConfig(env); const model = speechModel({ ...request, voice: request.voice || DEFAULT_VOICE }); const input = { provider: model.id, mode, resourceIdentity: resourceIdentity(config), region: config.region, voice: voiceId(request.voice || DEFAULT_VOICE, request.route), locale: localeId(request.locale || 'en-US'), text: request.text, rate: rateValue(request.rate), pitch: pitchValue(request.pitch), style: styleValue(request.style), outputFormat: model.outputFormat }; const id = requestId(input);
  await mkdir(receiptDir, { recursive: true }); await mkdir(outputDir, { recursive: true }); const receiptPath = join(receiptDir, `${id}.json`); const audioPath = join(outputDir, `${id}.wav`);
  try { const existing = JSON.parse(await readFile(receiptPath, 'utf8')); if (existing.status === 'complete' && existing.audioPath === audioPath) { const cached = await readFile(audioPath); const parsed = parsePcmWav(cached); if (sha256(cached) !== existing.sha256 || cached.length !== existing.bytes || Math.abs(parsed.duration - existing.duration) > 0.000001) throw new Error('Cached Azure Speech artifact failed receipt validation; reconcile before retrying'); return { ...existing, audio: cached }; } throw new Error('Azure Speech request is possibly delivered; reconcile the existing receipt before retrying'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let handle; try { handle = await open(receiptPath, 'wx'); await handle.writeFile(JSON.stringify({ status: 'reserved', requestId: id, input, createdAt: new Date().toISOString() })); await handle.close(); } catch (error) { if (handle) await handle.close().catch(() => {}); if (error.code === 'EEXIST') throw new Error('Azure Speech request is possibly delivered; reconcile the existing receipt before retrying'); throw error; }
  try { const result = mode === 'sdk' ? await synthesizeAzureSpeechSdk(request) : await synthesizeAzureSpeech(request); const temporary = `${audioPath}.${process.pid}.tmp`; await writeFile(temporary, result.audio, { flag: 'wx' }); await rename(temporary, audioPath); const receipt = { status: 'complete', requestId: id, audioPath, sha256: result.sha256, bytes: result.bytes, duration: result.duration, provider: result.provider, model: result.model, mode, resourceIdentity: result.resourceIdentity, region: result.region, voice: result.voice, locale: result.locale, style: result.style, wordTimings: result.wordTimings, completedAt: new Date().toISOString() }; await writeFile(receiptPath, JSON.stringify(receipt, null, 2)); return { ...receipt, audio: result.audio }; } catch (error) { await writeFile(receiptPath, JSON.stringify({ status: 'possibly_delivered', requestId: id, input, error: error.message, updatedAt: new Date().toISOString() }, null, 2)); throw error; }
}

export function speechCatalogEntry(catalog) {
  return { ...AZURE_SPEECH_MODEL, configured: Boolean(catalog?.configured), voices: (catalog?.voices || []).map(({ id, name, locale, gender, type, styles }) => ({ id, name, locale, gender, type, styles })) };
}
