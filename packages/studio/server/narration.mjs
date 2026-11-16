import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { azureSpeechConfig, listAzureSpeechVoices, synthesizeAzureSpeech, synthesizeAzureSpeechSdk, parsePcmWav } from './speech-providers.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);
const operationError = (code, message) => Object.assign(new Error(message), { code });
async function save(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
function normalize(input) {
  if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 5000) throw new TypeError('Narration requires a complete script of 1-5000 characters; longer scripts need an explicit separate operation');
  const requestKey = input.requestKey;
  if (requestKey !== undefined && !validKey(requestKey)) throw new TypeError('Invalid narration requestKey');
  const mode = input.mode || 'sdk', route = input.route || 'standard';
  if (!['sdk', 'rest'].includes(mode) || !['standard', 'dragonhd'].includes(route)) throw new TypeError('Invalid narration synthesis mode or route');
  if (typeof input.voice !== 'string' || !input.voice || input.voice.length > 100) throw new TypeError('Select an Azure Speech voice');
  const locale = input.locale || 'en-US';
  if (!/^[a-z]{2,3}-[A-Z]{2,4}$/.test(locale)) throw new TypeError('Invalid narration locale');
  const rate = input.rate || null, pitch = input.pitch || null, style = input.style || null;
  if (rate && (typeof rate !== 'string' || !/^(?:x-slow|slow|medium|fast|x-fast|[-+]?\d{1,3}%)$/.test(rate))) throw new TypeError('Invalid narration rate');
  if (pitch && (typeof pitch !== 'string' || !/^(?:[-+]?\d{1,3}(?:Hz|%))$/.test(pitch))) throw new TypeError('Invalid narration pitch');
  if (style && (typeof style !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(style))) throw new TypeError('Invalid narration style');
  if (route === 'dragonhd' && (rate || pitch || style)) throw new TypeError('DragonHD does not support prosody or style controls');
  return { requestKey, text: input.text, voice: input.voice, locale, mode, route, rate, pitch, style };
}

/** Private, engine-independent full-script synthesis. No call is replayed after its durable fence. */
export function createNarrationService(home, { getCredentials = async () => null, listVoices = listAzureSpeechVoices, synthesize, fetchImpl = fetch } = {}) {
  if (typeof home !== 'string' || !home) throw new TypeError('Narration home is required');
  const directory = join(home, 'narration'), audioDirectory = join(home, 'speech-audio');
  const receiptPath = id => join(directory, `${id}.json`);
  async function initialize() { await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(audioDirectory, { recursive: true, mode: 0o700 }); }
  function publicReceipt(receipt, extra = {}) {
    const { id, requestKey, fingerprint, status, effect, createdAt, completedAt, provider, model, mode, route, voice, locale, rate, pitch, style, scriptCharacters, bytes, sha256, duration, hasWordTimings } = receipt;
    return { id, requestId: id, requestKey, fingerprint, status, effect, createdAt, completedAt, provider, model, mode, route, voice, locale, rate, pitch, style, scriptCharacters, bytes, sha256, duration, hasWordTimings,
      ...(status === 'complete' ? { mediaId: `speech-${id}`, file: join(audioDirectory, `${id}.wav`), audioPath: join(audioDirectory, `${id}.wav`), timingsPath: hasWordTimings ? join(directory, `${id}.words.json`) : null } : {}), ...extra };
  }
  async function metadata(id) {
    if (!validId(id)) throw new TypeError('Invalid narration receipt ID');
    let handle, receipt;
    try {
      handle = await open(receiptPath(id), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 64 * 1024) throw new Error('Receipt size is invalid');
      receipt = JSON.parse(await handle.readFile('utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw operationError('narration_receipt_invalid', 'Narration receipt cannot be read; reconcile the existing operation'); }
    finally { if (handle) await handle.close(); }
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.id !== id) throw operationError('narration_receipt_invalid', 'Narration receipt identity mismatch');
    return receipt;
  }
  async function read(id) {
    const receipt = await metadata(id); if (!receipt) return null;
    if (receipt.status === 'complete') {
      try {
        const audio = await readFile(join(audioDirectory, `${id}.wav`)); const info = parsePcmWav(audio);
        if (hash(audio) !== receipt.sha256 || audio.length !== receipt.bytes || Math.abs(info.duration - receipt.duration) > 0.000001) throw new Error('mismatch');
        if (receipt.hasWordTimings) {
          const timings = await readFile(join(directory, `${id}.words.json`));
          if (hash(timings) !== receipt.timingsSha256) throw new Error('timings mismatch');
        }
      } catch { return publicReceipt({ ...receipt, status: 'artifact_unverified', effect: 'delivered_unverified' }); }
    }
    return publicReceipt(receipt);
  }
  async function readByKey(requestKey) {
    if (!validKey(requestKey)) throw new TypeError('Invalid narration requestKey');
    const id = hash(`narration:${requestKey}`).slice(0, 32);
    const found = await read(id);
    if (found) {
      if (found.requestKey !== undefined && found.requestKey !== requestKey) throw operationError('narration_receipt_invalid', 'Narration requestKey does not match its saved receipt');
      return { ...found, requestKey };
    }
    // Unkeyed earlier callers keep their fingerprint-derived ID. New receipts
    // persist that same ID as their automatically assigned operation key.
    if (validId(requestKey)) {
      const legacy = await read(requestKey);
      if (legacy && (legacy.requestKey === undefined || legacy.requestKey === requestKey)) return { ...legacy, requestKey };
    }
    return null;
  }
  async function list({ limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Narration list limit must be 1-100');
    let entries;
    try { entries = await opendir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw operationError('narration_list_failed', 'Could not read saved narration receipts'); }
    const results = []; let scanned = 0;
    for await (const entry of entries) {
      if (++scanned > 4096) throw operationError('narration_list_limit', 'Saved narration listing exceeded its bounded directory limit; resolve a known operation with readByKey');
      const match = /^([a-f0-9]{32})\.json$/.exec(entry.name); if (!match) continue;
      let receipt;
      try { receipt = await metadata(match[1]); }
      catch { receipt = { id: match[1], status: 'receipt_unverified', effect: 'possibly_delivered' }; }
      if (receipt) results.push(publicReceipt(receipt, { artifactVerification: 'not_rechecked' }));
    }
    const time = receipt => { const value = Date.parse(receipt.completedAt || receipt.createdAt); return Number.isFinite(value) ? value : 0; };
    return results.sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id)).slice(0, limit);
  }
  async function generate(input) {
    const normalized = normalize(input); await initialize();
    // Read once: the selected credentials cannot drift between voice validation,
    // fingerprinting and synthesis, and are never persisted in receipts.
    let credentials;
    try { credentials = (await getCredentials('azure')) ?? undefined; }
    catch { throw operationError('narration_not_configured', 'Could not read the selected Azure Speech connection'); }
    const config = azureSpeechConfig(process.env, credentials);
    if (!config.configured) throw operationError('narration_not_configured', 'Configure your Azure Speech connection first');
    const resource = config.resourceId || config.endpoint || config.region;
    const credentialIdentity = config.key || config.token ? hash(config.key || config.token) : config.authMode;
    const { requestKey, ...request } = normalized;
    const fingerprint = hash(JSON.stringify({ ...request, resource, credentialIdentity }));
    const id = hash(requestKey === undefined ? fingerprint : `narration:${requestKey}`).slice(0, 32);
    const existing = await read(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw operationError('narration_request_changed', 'This narration operation already belongs to a different script, voice, settings or connection; use a new requestKey');
      if (existing.status === 'complete') return { ...existing, reused: true };
      throw operationError('narration_reconciliation_required', `Narration ${id} needs reconciliation and will not be synthesized again`);
    }
    let catalog;
    try { catalog = await listVoices({ credentials, fetchImpl }); }
    catch { throw operationError('narration_catalog_failed', 'Could not verify the Azure Speech voice catalog; no synthesis was submitted'); }
    const voice = catalog?.voices?.find(value => value.id === request.voice && value.locale === request.locale);
    if (!voice) throw new TypeError('Select a voice from the current Azure Speech catalog');
    if (request.route === 'standard' && voice.type === 'NeuralHD') throw new TypeError('NeuralHD requires the explicit DragonHD route');
    if (request.route === 'dragonhd' && (voice.type !== 'NeuralHD' || !/^[A-Za-z]{2,4}-[A-Za-z0-9-]{2,60}:DragonHDLatestNeural$/.test(voice.id))) throw new TypeError('Select a verified DragonHD catalog voice');
    if (request.style && !(voice.styles || []).includes(request.style)) throw new TypeError('Select a style from the current voice catalog');
    const receipt = { id, requestKey: requestKey ?? id, fingerprint, status: 'reserved', effect: 'possibly_delivered', createdAt: stamp(), mode: request.mode, route: request.route, voice: request.voice, locale: request.locale, rate: request.rate, pitch: request.pitch, style: request.style, scriptCharacters: request.text.length };
    let handle;
    try {
      handle = await open(receiptPath(id), 'wx', 0o600); await handle.writeFile(JSON.stringify(receipt)); await handle.sync();
    } catch (error) {
      if (error.code === 'EEXIST') throw operationError('narration_reconciliation_required', `Narration ${id} is already reserved; it will not be submitted twice`);
      throw error;
    } finally { if (handle) await handle.close(); }
    try {
      const generateSpeech = synthesize || (request.mode === 'sdk' ? synthesizeAzureSpeechSdk : synthesizeAzureSpeech);
      const result = await generateSpeech({ ...request, voiceType: voice.type, credentials, fetchImpl });
      const audio = Buffer.from(result.audio); const info = parsePcmWav(audio);
      const timings = result.wordTimings;
      if (timings !== null && timings !== undefined && (!Array.isArray(timings) || timings.some(word => typeof word?.text !== 'string' || !Number.isFinite(word.offset) || word.offset < 0 || !Number.isFinite(word.duration) || word.duration < 0 || word.offset + word.duration > info.duration * 1000 + 100))) throw new Error('Invalid word boundaries');
      const hasWordTimings = Array.isArray(timings) && timings.length > 0;
      const file = join(audioDirectory, `${id}.wav`), temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, audio, { flag: 'wx', mode: 0o600 }); await rename(temporary, file);
      let timingsSha256;
      if (hasWordTimings) { const timingBytes = Buffer.from(JSON.stringify({ unit: 'milliseconds', words: timings })); timingsSha256 = hash(timingBytes); await writeFile(join(directory, `${id}.words.json`), timingBytes, { flag: 'wx', mode: 0o600 }); }
      const completed = { ...receipt, status: 'complete', effect: 'independently_verified', completedAt: stamp(), provider: result.provider, model: result.model, bytes: audio.length, sha256: hash(audio), duration: info.duration, hasWordTimings, timingsSha256 };
      await save(receiptPath(id), completed); return publicReceipt(completed, { reused: false });
    } catch {
      await save(receiptPath(id), { ...receipt, status: 'possibly_delivered', effect: 'possibly_delivered', updatedAt: stamp(), errorCode: 'narration_synthesis_unverified' });
      throw operationError('narration_synthesis_unverified', `Narration ${id} may have been synthesized; reconcile the saved operation before any new request`);
    }
  }
  return { generate, read, readByKey, list, async latest() { const [receipt] = await list({ limit: 1 }); return receipt ? read(receipt.id) : null; }, async reconcile(id) { return read(id); } };
}
