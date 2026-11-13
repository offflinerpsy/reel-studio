import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';

const IG = 'https://graph.instagram.com/v26.0';
const YT = 'https://www.googleapis.com';
const error = (code, message, effect = 'not_delivered') => ({ ok: false, effect, error: { code, message } });
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new TypeError(`Invalid ${label}`);
  return value;
};
const numericId = (value, label) => {
  if (!/^\d+$/.test(required(value, label))) throw new TypeError(`Invalid ${label}`);
  return value;
};
const captionText = (value = '', max) => {
  if (typeof value !== 'string' || value.length > max) throw new TypeError('Invalid caption');
  return value;
};
function publicVideoUrl(value) {
  let u;
  try { u = new URL(required(value, 'video URL')); } catch { throw new TypeError('Invalid video URL'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port || isIP(host) || host.includes(':') ||
      !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|arpa|test|invalid|example)$/.test(host)) {
    throw new TypeError('Video URL must use a public HTTPS hostname');
  }
  return u.href;
}
function youtubeSession(value) {
  let u;
  try { u = new URL(required(value, 'upload session')); } catch { throw new TypeError('Invalid upload session'); }
  if (u.origin !== YT || u.pathname !== '/upload/youtube/v3/videos' || u.username || u.password ||
      u.searchParams.get('uploadType') !== 'resumable' || !u.searchParams.get('upload_id')) {
    throw new TypeError('Invalid upload session');
  }
  return u.href;
}
async function request(url, init, fetchImpl, effectful = false) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error' });
    let data = null;
    try { data = await response.json(); } catch { /* Never preserve raw provider response. */ }
    if (!response.ok) {
      const effect = effectful && response.status >= 500 ? 'possibly_delivered' : 'not_delivered';
      return { response, result: error(`http_${response.status}`, 'Provider request failed', effect) };
    }
    return { response, data };
  } catch {
    return { result: error('transport_error', 'Provider response was not received', effectful ? 'possibly_delivered' : 'not_delivered') };
  }
}
const bearer = token => ({ Authorization: `Bearer ${required(token, 'access token')}` });
const json = (token, body) => ({ method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function connectorCatalog() {
  return [
    { id: 'telegram', label: 'Telegram', capability: 'direct_publish', status: 'not_authenticated', prerequisites: ['Bot token', 'Exact target chat/channel', 'Channel permission to post'], note: 'A successful send still requires channel readback.' },
    { id: 'instagram', label: 'Instagram Reels', capability: 'direct_publish', status: 'not_authenticated', prerequisites: ['Professional account', 'Instagram Login app and user token', 'instagram_business_basic and instagram_business_content_publish', 'Public HTTPS media staging'], note: 'Own or managed accounts can use Standard Access; other businesses need review and verification.' },
    { id: 'youtube', label: 'YouTube Shorts', capability: 'resumable_upload', status: 'not_authenticated', prerequisites: ['YouTube channel OAuth grant', 'youtube.upload plus read scope for verification', 'API project audit for unrestricted public uploads'], note: 'Unverified API projects are private-only; Shorts classification follows eligible dimensions and duration.' },
    { id: 'tiktok', label: 'TikTok', capability: 'manual_handoff', status: 'manual_only', prerequisites: ['Owner opens TikTok and finishes publishing'], note: 'TikTok Direct Post rules exclude a private utility for accounts its owner or team manages.' },
  ];
}

export async function publishTelegram({ filePath, caption = '', chatId, token, fetchImpl = fetch }) {
  required(token, 'bot token');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new TypeError('Invalid bot token');
  if (typeof chatId !== 'string' || !/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(chatId)) throw new TypeError('Invalid chat ID');
  captionText(caption, 1024);
  required(filePath, 'file path');
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > 50 * 1024 * 1024) throw new TypeError('Invalid Telegram video size');
  const body = new FormData();
  body.set('chat_id', chatId);
  body.set('caption', caption);
  body.set('supports_streaming', 'true');
  body.set('video', new Blob([await readFile(filePath)], { type: 'video/mp4' }), 'video.mp4');
  const r = await request(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body }, fetchImpl, true);
  if (r.result) return r.result;
  if (r.data?.ok === false) return error('telegram_rejected', 'Telegram rejected the send');
  if (r.data?.ok !== true) return error('invalid_receipt', 'Telegram send requires reconciliation', 'possibly_delivered');
  const message = r.data.result;
  if (!Number.isSafeInteger(message?.message_id) || !Number.isSafeInteger(message?.chat?.id)) return error('invalid_receipt', 'Telegram send requires reconciliation', 'possibly_delivered');
  if (/^-?\d+$/.test(chatId) && String(message.chat.id) !== chatId) return error('target_mismatch', 'Telegram target requires reconciliation', 'possibly_delivered');
  if (message.message_id === 0) return { ok: true, effect: 'delivered_unverified', status: 'processing', chatId: String(message.chat.id), messageId: 0 };
  if (message.message_id < 0) return error('invalid_receipt', 'Telegram send requires reconciliation', 'possibly_delivered');
  return { ok: true, effect: 'delivered_unverified', status: 'sent', chatId: String(message.chat.id), messageId: message.message_id, fileId: message.video?.file_id ?? null };
}

export async function createInstagramContainer({ videoUrl, caption = '', accessToken, accountId, fetchImpl = fetch }) {
  numericId(accountId, 'Instagram account ID');
  const r = await request(`${IG}/${accountId}/media`, json(accessToken, { media_type: 'REELS', video_url: publicVideoUrl(videoUrl), caption: captionText(caption, 2200) }), fetchImpl, true);
  if (r.result) return r.result;
  if (!/^\d+$/.test(r.data?.id ?? '')) return error('invalid_receipt', 'Instagram container requires reconciliation', 'possibly_delivered');
  return { ok: true, effect: 'delivered_unverified', status: 'container_created', containerId: r.data.id, accountId };
}
export async function getInstagramStatus({ containerId, accessToken, fetchImpl = fetch }) {
  numericId(containerId, 'Instagram container ID');
  const r = await request(`${IG}/${containerId}?fields=status_code`, { headers: bearer(accessToken) }, fetchImpl);
  if (r.result) return r.result;
  if (!['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED'].includes(r.data?.status_code)) return error('invalid_status', 'Instagram returned an unknown status');
  return { ok: true, effect: 'not_delivered', status: r.data.status_code, containerId };
}
export async function publishInstagramContainer({ containerId, accountId, accessToken, fetchImpl = fetch }) {
  numericId(containerId, 'Instagram container ID'); numericId(accountId, 'Instagram account ID');
  const r = await request(`${IG}/${accountId}/media_publish`, json(accessToken, { creation_id: containerId }), fetchImpl, true);
  if (r.result) return r.result;
  if (!/^\d+$/.test(r.data?.id ?? '')) return error('invalid_receipt', 'Instagram publish requires reconciliation', 'possibly_delivered');
  return { ok: true, effect: 'delivered_unverified', status: 'published', mediaId: r.data.id, containerId, accountId };
}
export async function readInstagramMedia({ mediaId, accessToken, fetchImpl = fetch }) {
  numericId(mediaId, 'Instagram media ID');
  const r = await request(`${IG}/${mediaId}?fields=id,media_type,permalink,username`, { headers: bearer(accessToken) }, fetchImpl);
  if (r.result) return r.result;
  if (r.data?.id !== mediaId) return error('invalid_receipt', 'Instagram media identity did not match');
  let permalink = null;
  try { const u = new URL(r.data.permalink); if (u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname)) permalink = u.href; } catch {}
  return { ok: true, effect: 'not_delivered', mediaId, mediaType: r.data.media_type, permalink, username: r.data.username };
}

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export async function startYouTubeUpload({ accessToken, byteLength, metadata, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > 256 * 1024 ** 3) throw new TypeError('Invalid video size');
  if (!metadata || typeof metadata !== 'object' || typeof metadata.snippet?.title !== 'string' || metadata.snippet.title.length > 100 || !metadata.snippet.title.trim()) throw new TypeError('Invalid YouTube metadata');
  if (!['private', 'unlisted', 'public'].includes(metadata.status?.privacyStatus)) throw new TypeError('Explicit YouTube privacy is required');
  const payload = { snippet: {}, status: {} };
  for (const key of ['title', 'description', 'tags', 'categoryId', 'defaultLanguage']) if (metadata.snippet[key] !== undefined) payload.snippet[key] = metadata.snippet[key];
  for (const key of ['privacyStatus', 'publishAt', 'selfDeclaredMadeForKids', 'containsSyntheticMedia']) if (metadata.status[key] !== undefined) payload.status[key] = metadata.status[key];
  const init = json(accessToken, payload);
  init.headers['X-Upload-Content-Length'] = String(byteLength);
  init.headers['X-Upload-Content-Type'] = 'video/mp4';
  const r = await request(`${YT}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, init, fetchImpl, true);
  if (r.result) return r.result;
  let sessionUri;
  try { sessionUri = youtubeSession(r.response.headers.get('location')); } catch { return error('invalid_session', 'YouTube upload session requires reconciliation', 'possibly_delivered'); }
  // Session URI is a secret: caller must store it securely and exclude it from logs/UI.
  return { ok: true, effect: 'delivered_unverified', status: 'session_created', sessionUri, byteLength };
}
async function youtubePut({ sessionUri, accessToken, byteLength, body, contentRange, fetchImpl }) {
  try {
    const response = await fetchImpl(youtubeSession(sessionUri), { method: 'PUT', redirect: 'error', headers: { ...bearer(accessToken), 'Content-Type': 'video/mp4', 'Content-Range': contentRange, 'Content-Length': String(body?.length ?? 0) }, body });
    if (response.status === 308) {
      const range = response.headers.get('range');
      if (range !== null && !/^bytes=0-\d+$/.test(range)) return error('invalid_range', 'YouTube upload progress requires reconciliation', 'possibly_delivered');
      const uploadedBytes = range ? Number(range.split('-')[1]) + 1 : 0;
      if (!Number.isSafeInteger(uploadedBytes) || uploadedBytes > byteLength) return error('invalid_range', 'YouTube upload progress requires reconciliation', 'possibly_delivered');
      return { ok: true, effect: 'delivered_unverified', status: 'uploading', uploadedBytes };
    }
    if (!response.ok) return error(`http_${response.status}`, 'YouTube upload request failed', response.status >= 500 ? 'possibly_delivered' : 'not_delivered');
    let data; try { data = await response.json(); } catch {}
    if (!/^[A-Za-z0-9_-]{11}$/.test(data?.id ?? '')) return error('invalid_receipt', 'YouTube upload requires reconciliation', 'possibly_delivered');
    return { ok: true, effect: 'delivered_unverified', status: 'uploaded', videoId: data.id };
  } catch { return error('transport_error', 'YouTube upload response was not received', 'possibly_delivered'); }
}
export async function uploadYouTubeVideo({ sessionUri, accessToken, filePath, startByte = 0, fetchImpl = fetch }) {
  youtubeSession(sessionUri); required(accessToken, 'access token'); required(filePath, 'file path');
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > 256 * 1024 ** 3) throw new TypeError('Invalid video size');
  if (!Number.isSafeInteger(startByte) || startByte < 0 || startByte >= info.size) throw new TypeError('Invalid upload offset');
  // Single PUT; for large files the caller should provide a streaming/chunk implementation.
  if (info.size > 300 * 1024 * 1024) throw new TypeError('Buffered upload exceeds local limit');
  const body = (await readFile(filePath)).subarray(startByte);
  return youtubePut({ sessionUri, accessToken, byteLength: info.size, body, contentRange: `bytes ${startByte}-${info.size - 1}/${info.size}`, fetchImpl });
}
export async function getYouTubeUploadStatus({ sessionUri, accessToken, byteLength, fetchImpl = fetch }) {
  youtubeSession(sessionUri); required(accessToken, 'access token');
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new TypeError('Invalid video size');
  return youtubePut({ sessionUri, accessToken, byteLength, body: Buffer.alloc(0), contentRange: `bytes */${byteLength}`, fetchImpl });
}
export async function readYouTubeVideo({ videoId, accessToken, fetchImpl = fetch }) {
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new TypeError('Invalid video ID');
  const r = await request(`${YT}/youtube/v3/videos?part=snippet,status,processingDetails&id=${videoId}`, { headers: bearer(accessToken) }, fetchImpl);
  if (r.result) return r.result;
  const v = r.data?.items?.find(item => item.id === videoId);
  if (!v) return error('video_not_found', 'YouTube video was not found');
  return { ok: true, effect: 'not_delivered', videoId, channelId: v.snippet?.channelId, privacyStatus: v.status?.privacyStatus, uploadStatus: v.status?.uploadStatus, processingStatus: v.processingDetails?.processingStatus, permalink: `https://www.youtube.com/watch?v=${videoId}` };
}
