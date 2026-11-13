import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../server/connectors.mjs';
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const secret = 'secret-token';
const sessionUri = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=secret-session';

test('catalog describes prerequisites without implying authentication', () => {
  assert.equal(c.connectorCatalog().length, 4);
  assert.equal(c.connectorCatalog().find(x => x.id === 'tiktok').capability, 'manual_handoff');
  assert.equal(c.connectorCatalog().find(x => x.id === 'telegram').status, 'not_authenticated');
});
test('Telegram multipart protocol, verified response and transport uncertainty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reel-connector-'));
  try {
    const filePath = join(dir, 'video.mp4'); await writeFile(filePath, Buffer.from('video'));
    const args = { filePath, caption: 'hello', chatId: '-100123', token: '123:fake_secret' };
    const result = await c.publishTelegram({ ...args, fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.telegram.org/bot123:fake_secret/sendVideo');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('chat_id'), '-100123'); assert.equal(init.body.get('video').type, 'video/mp4');
      return reply({ ok: true, result: { message_id: 12, chat: { id: -100123 }, video: { file_id: 'file123' } } });
    } });
    assert.equal(result.effect, 'delivered_unverified'); assert.equal(result.messageId, 12);
    let calls = 0;
    const lost = await c.publishTelegram({ ...args, fetchImpl: async () => { calls++; throw Error('123:fake_secret'); } });
    assert.equal(calls, 1); assert.equal(lost.effect, 'possibly_delivered');
    assert.ok(!JSON.stringify(lost).includes('fake_secret'));
    const pending = await c.publishTelegram({ ...args, fetchImpl: async () => reply({ ok: true, result: { message_id: 0, chat: { id: -100123 } } }) });
    assert.equal(pending.status, 'processing');
    const mismatch = await c.publishTelegram({ ...args, fetchImpl: async () => reply({ ok: true, result: { message_id: 12, chat: { id: -100999 } } }) });
    assert.equal(mismatch.effect, 'possibly_delivered');
    const malformed = await c.publishTelegram({ ...args, fetchImpl: async () => new Response('not JSON') });
    assert.equal(malformed.effect, 'possibly_delivered');
  } finally { await rm(dir, { recursive: true }); }
});
test('Instagram Login container, status, publish and readback protocols', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, `Bearer ${secret}`); assert.equal(init.redirect, 'error');
    if (calls === 1) { assert.equal(url, 'https://graph.instagram.com/v26.0/123/media'); assert.equal(JSON.parse(init.body).media_type, 'REELS'); return reply({ id: '456' }); }
    if (calls === 2) { assert.equal(url, 'https://graph.instagram.com/v26.0/456?fields=status_code'); return reply({ status_code: 'FINISHED' }); }
    if (calls === 3) { assert.equal(JSON.parse(init.body).creation_id, '456'); return reply({ id: '789' }); }
    return reply({ id: '789', permalink: 'https://www.instagram.com/reel/abc/', username: 'owner', media_type: 'VIDEO' });
  };
  assert.equal((await c.createInstagramContainer({ videoUrl: 'https://media.example.com/video.mp4', accessToken: secret, accountId: '123', fetchImpl })).containerId, '456');
  assert.equal((await c.getInstagramStatus({ containerId: '456', accessToken: secret, fetchImpl })).status, 'FINISHED');
  assert.equal((await c.publishInstagramContainer({ containerId: '456', accountId: '123', accessToken: secret, fetchImpl })).effect, 'delivered_unverified');
  assert.equal((await c.readInstagramMedia({ mediaId: '789', accessToken: secret, fetchImpl })).username, 'owner');
});
test('Instagram rejects unsafe URL before fetching and redacts provider errors', async () => {
  for (const videoUrl of ['http://media.example.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://u:p@media.example.com/a']) {
    await assert.rejects(c.createInstagramContainer({ videoUrl, accessToken: secret, accountId: '123', fetchImpl: () => { throw Error('must not fetch'); } }), TypeError);
  }
  const r = await c.publishInstagramContainer({ accountId: '123', containerId: '456', accessToken: secret, fetchImpl: async () => reply({ error: { message: secret } }, 500) });
  assert.equal(r.effect, 'possibly_delivered'); assert.ok(!JSON.stringify(r).includes(secret));
});
test('YouTube resumable init, status, upload and readback use fixed hosts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reel-youtube-'));
  try {
    const metadata = { snippet: { title: 'Title' }, status: { privacyStatus: 'private' } };
    const init = await c.startYouTubeUpload({ accessToken: secret, byteLength: 5, metadata, fetchImpl: async (url, opts) => {
      assert.equal(new URL(url).hostname, 'www.googleapis.com'); assert.equal(opts.headers['X-Upload-Content-Length'], '5');
      assert.equal(JSON.parse(opts.body).status.privacyStatus, 'private'); return reply({}, 200, { location: sessionUri });
    } }); assert.equal(init.status, 'session_created');
    const progress = await c.getYouTubeUploadStatus({ sessionUri, accessToken: secret, byteLength: 5, fetchImpl: async (url, opts) => {
      assert.equal(url, sessionUri); assert.equal(opts.headers['Content-Range'], 'bytes */5'); return new Response(null, { status: 308, headers: { range: 'bytes=0-2' } });
    } }); assert.equal(progress.uploadedBytes, 3);
    const filePath = join(dir, 'video.mp4'); await writeFile(filePath, 'video');
    const uploaded = await c.uploadYouTubeVideo({ sessionUri, accessToken: secret, filePath, fetchImpl: async (url, opts) => {
      assert.equal(opts.headers['Content-Range'], 'bytes 0-4/5'); assert.equal(opts.body.length, 5); return reply({ id: 'abcdefghijk' }, 201);
    } }); assert.equal(uploaded.videoId, 'abcdefghijk');
    const resumed = await c.uploadYouTubeVideo({ sessionUri, accessToken: secret, filePath, startByte: 3, fetchImpl: async (url, opts) => {
      assert.equal(opts.headers['Content-Range'], 'bytes 3-4/5'); assert.equal(opts.body.length, 2); return reply({ id: 'abcdefghijk' }, 201);
    } }); assert.equal(resumed.status, 'uploaded');
    const read = await c.readYouTubeVideo({ videoId: 'abcdefghijk', accessToken: secret, fetchImpl: async () => reply({ items: [{ id: 'abcdefghijk', snippet: { channelId: 'channel' }, status: { privacyStatus: 'private' }, processingDetails: { processingStatus: 'succeeded' } }] }) });
    assert.equal(read.privacyStatus, 'private'); assert.equal(read.effect, 'not_delivered');
    await assert.rejects(c.getYouTubeUploadStatus({ sessionUri: 'https://evil.dev/upload', accessToken: secret, byteLength: 5 }), TypeError);
    const lost = await c.getYouTubeUploadStatus({ sessionUri, accessToken: secret, byteLength: 5, fetchImpl: async () => { throw Error(sessionUri); } });
    assert.equal(lost.effect, 'possibly_delivered'); assert.ok(!JSON.stringify(lost).includes('secret-session'));
  } finally { await rm(dir, { recursive: true }); }
});
