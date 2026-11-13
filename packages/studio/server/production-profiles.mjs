const MAX = Object.freeze({
  id: 80, name: 120, text: 5000, topic: 240, keyPhrase: 160, hashtags: 12, title: 100,
});
const LANGUAGE_CODES = new Set(['en', 'es', 'pt-BR', 'fr', 'ru', 'de', 'it', 'ja', 'ko', 'zh', 'ar']);
const TOPIC_IDS = new Set(['space', 'physics', 'biology', 'chemistry', 'earth']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const SAFE_PLAYLIST_URL = /^https:\/\/(?:www\.)?youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/;
const TOPIC_CATEGORIES = Object.freeze([
  { id: 'space', title: 'Space & Astronomy', palette: ['#091b31', '#27566b', '#ff9466', '#fff3d2'], motifs: 'Bright paper planets, orbital arcs and sparse layered stars.' },
  { id: 'physics', title: 'Everyday Physics & Technology', palette: ['#102d34', '#2b5e62', '#ff9466', '#e8f1e5'], motifs: 'Cut-paper wave strips, simple circuits, copper and teal shapes; no stars.' },
  { id: 'biology', title: 'Biology & the Human Body', palette: ['#16332b', '#44684b', '#ff9466', '#f0ead5'], motifs: 'Leaves, cells, skin or food shapes chosen for the question; no space texture.' },
  { id: 'chemistry', title: 'Everyday Chemistry', palette: ['#30283b', '#64526c', '#b7e5c5', '#f6eee0'], motifs: 'Molecule cutouts, material layers, bubbles and kitchen surfaces; no space texture.' },
  { id: 'earth', title: 'Earth & Weather', palette: ['#193842', '#39766d', '#ff9466', '#edf1dc'], motifs: 'Layered terrain, clouds, air currents or sky sheets; no universal star field.' },
]);

const clone = value => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function walkSafe(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((item, i) => walkSafe(item, `${path}[${i}]`));
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key)) throw new Error(`Unsafe field ${path}.${key}`);
    walkSafe(value[key], `${path}.${key}`);
  }
}

function object(value, path, keys, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object`); return false;
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push(`${path}.${key} is not supported`);
  return true;
}
function requiredString(value, path, max, issues) {
  if (typeof value !== 'string' || !value.trim()) issues.push(`${path} must be a non-empty string`);
  else if (value.length > max) issues.push(`${path} exceeds ${max} characters`);
}
function exact(value, expected, path, issues) { if (value !== expected) issues.push(`${path} must be ${JSON.stringify(expected)}`); }
function finite(value, path, min, max, issues) {
  if (!Number.isFinite(value) || value < min || value > max) issues.push(`${path} must be a number from ${min} to ${max}`);
}

const DEFAULT = {
  schemaVersion: 1, revision: 1, id: 'example-profile', name: 'Example profile', brand: 'Your studio',
  audience: { language: 'English', locale: 'en-US', market: 'United States' },
  production: { format: '9:16', width: 1080, height: 1920, fps: 30, bodySeconds: 60, ctaSeconds: 5.5 },
  model: { name: 'gpt-6.1-sol', effort: 'high', speed: 'standard', fallbackPolicy: 'none' },
  voice: { name: 'Choose your voice', provider: 'ElevenLabs', voiceId: 'configure-your-voice', route: 'ElevenLabs', preserveEndings: true },
  audio: { music: 'none', sfx: 'sparse' },
  visuals: { art: 'original GPT Image', palette: { deepink: '#101c30', cream: '#fff3d2', tangerine: '#ff9466', mint: '#b7e5c5' }, diagrams: 'causal topic diagrams', labels: 'restrained', captionsBurnedIn: false, topic: { required: true, categories: TOPIC_CATEGORIES, defaultCategory: 'space', layersMin: 3, parallaxPx: [18, 55], paperPivotDegrees: 2, causalForegroundPriority: true }, typography: { canvasWidth: 1080, canvasHeight: 1920, diagramLabelsMinPx: 44, bodyNotesMinPx: 52, headlineMinPx: 84 } },
  captions: { languages: ['en', 'es', 'pt-BR', 'fr', 'ru'], timed: true },
  research: { sources: 'primary factual sources', dataForSEO: 'cached bounded requests with costs and task IDs', guarantees: 'no trends or reach guarantees' },
  editorial: { keyPhraseAtStart: true, publicLinks: false, separateYouTubeH1: false, style: 'concise concrete mechanism and qualifiers; no AI filler or keyword stuffing', hashtags: '4-5 topic-relevant hashtags at end only', exactCTA: 'Stay curious. Subscribe, tap like, and drop your next big question below.' },
  qa: ['decode', 'rendered pixels', 'complete speech and CTA', 'caption timing', 'media hash', 'editable source'],
  publication: { defaultVisibility: 'private_review', approval: 'exact verified immutable target', replayPolicy: 'no replay', schedule: { intervalMinutes: 60, timezone: 'America/New_York', status: 'planned_until_native_receipt' }, publicByDefault: false, channelSelection: 'external', playlists: [] },
};

export const DEFAULT_EXAMPLE_PROFILE = clone(DEFAULT);

export function validateProductionProfile(input) {
  const issues = [];
  try { walkSafe(input); } catch (error) { throw error; }
  const top = ['schemaVersion','revision','id','name','brand','audience','production','model','voice','audio','visuals','captions','research','editorial','qa','publication'];
  if (!object(input, '$', top, issues)) throw new Error(issues.join('; '));
  for (const key of top) if (!own(input, key)) issues.push(`$.${key} is required`);
  if (issues.length) throw new Error(issues.join('; '));
  exact(input.schemaVersion, 1, '$.schemaVersion', issues); finite(input.revision, '$.revision', 1, 999999, issues);
  for (const key of ['id','name','brand']) requiredString(input[key], `$.${key}`, key === 'id' ? MAX.id : MAX.name, issues);
  if (object(input.audience, '$.audience', ['language','locale','market'], issues)) {
    for (const key of ['language','locale','market']) requiredString(input.audience[key], `$.audience.${key}`, 80, issues);
  }
  if (object(input.production, '$.production', ['format','width','height','fps','bodySeconds','ctaSeconds'], issues)) {
    exact(input.production.format, '9:16', '$.production.format', issues); exact(input.production.width, 1080, '$.production.width', issues); exact(input.production.height, 1920, '$.production.height', issues); exact(input.production.fps, 30, '$.production.fps', issues); finite(input.production.bodySeconds, '$.production.bodySeconds', 1, 600, issues); finite(input.production.ctaSeconds, '$.production.ctaSeconds', 0, 60, issues);
  }
  if (object(input.model, '$.model', ['name','effort','speed','fallbackPolicy'], issues)) { requiredString(input.model.name, '$.model.name', 100, issues); if (!['low','medium','high','xhigh'].includes(input.model.effort)) issues.push('$.model.effort must be low, medium, high, or xhigh'); exact(input.model.speed, 'standard', '$.model.speed', issues); exact(input.model.fallbackPolicy, 'none', '$.model.fallbackPolicy', issues); }
  if (object(input.voice, '$.voice', ['name','provider','voiceId','route','preserveEndings','rate','pitch','style'], issues)) { for (const key of ['name','provider','voiceId','route']) requiredString(input.voice[key], `$.voice.${key}`, 160, issues); for (const key of ['rate','pitch','style']) if (input.voice[key] !== undefined && (typeof input.voice[key] !== 'string' || input.voice[key].length > 20)) issues.push(`$.voice.${key} must be a short string`); if (input.voice.preserveEndings !== true) issues.push('$.voice.preserveEndings must be true'); }
  if (object(input.audio, '$.audio', ['music','sfx'], issues)) { requiredString(input.audio.music, '$.audio.music', 120, issues); requiredString(input.audio.sfx, '$.audio.sfx', 120, issues); }
  if (object(input.visuals, '$.visuals', ['art','palette','diagrams','labels','captionsBurnedIn','topic','typography'], issues)) {
    for (const key of ['art','diagrams','labels']) requiredString(input.visuals[key], `$.visuals.${key}`, 200, issues);
    if (input.visuals.captionsBurnedIn !== false) issues.push('$.visuals.captionsBurnedIn must be false');
    if (object(input.visuals.palette, '$.visuals.palette', ['deepink','cream','tangerine','mint'], issues)) for (const key of ['deepink','cream','tangerine','mint']) { requiredString(input.visuals.palette[key], `$.visuals.palette.${key}`, 20, issues); if (!/^#[0-9a-f]{6}$/i.test(input.visuals.palette[key] || '')) issues.push(`$.visuals.palette.${key} must be a hex color`); }
    if (input.visuals.topic !== undefined && object(input.visuals.topic, '$.visuals.topic', ['required','categories','defaultCategory','layersMin','parallaxPx','paperPivotDegrees','causalForegroundPriority'], issues)) {
      if (input.visuals.topic.required !== true) issues.push('$.visuals.topic.required must be true');
      if (!Array.isArray(input.visuals.topic.categories) || input.visuals.topic.categories.length !== 5) issues.push('$.visuals.topic.categories must contain five categories');
      else { const ids = new Set(); input.visuals.topic.categories.forEach((category, i) => { if (category && typeof category === 'object') { for (const key of Object.keys(category)) if (!['id','title','palette','motifs'].includes(key)) issues.push(`$.visuals.topic.categories[${i}].${key} is not supported`); } if (!category || typeof category !== 'object' || !TOPIC_IDS.has(category.id)) issues.push(`$.visuals.topic.categories[${i}].id must be a supported topic category`); else { if (ids.has(category.id)) issues.push('$.visuals.topic.categories must contain unique category IDs'); ids.add(category.id); requiredString(category.title, `$.visuals.topic.categories[${i}].title`, 120, issues); requiredString(category.motifs, `$.visuals.topic.categories[${i}].motifs`, 500, issues); if (!Array.isArray(category.palette) || category.palette.length !== 4 || category.palette.some(color => !/^#[0-9a-f]{6}$/i.test(color))) issues.push(`$.visuals.topic.categories[${i}].palette must contain four hex colors`); } }); }
      if (!TOPIC_IDS.has(input.visuals.topic.defaultCategory)) issues.push('$.visuals.topic.defaultCategory must be a supported topic category');
      finite(input.visuals.topic.layersMin, '$.visuals.topic.layersMin', 3, 12, issues); if (!Array.isArray(input.visuals.topic.parallaxPx) || input.visuals.topic.parallaxPx.length !== 2 || input.visuals.topic.parallaxPx.some(x => !Number.isFinite(x) || x < 18 || x > 55) || input.visuals.topic.parallaxPx[0] > input.visuals.topic.parallaxPx[1]) issues.push('$.visuals.topic.parallaxPx must be an ascending range from 18 to 55 pixels'); finite(input.visuals.topic.paperPivotDegrees, '$.visuals.topic.paperPivotDegrees', 0, 2, issues); if (input.visuals.topic.causalForegroundPriority !== true) issues.push('$.visuals.topic.causalForegroundPriority must be true');
    }
    if (input.visuals.typography !== undefined && object(input.visuals.typography, '$.visuals.typography', ['canvasWidth','canvasHeight','diagramLabelsMinPx','bodyNotesMinPx','headlineMinPx'], issues)) { exact(input.visuals.typography.canvasWidth, 1080, '$.visuals.typography.canvasWidth', issues); exact(input.visuals.typography.canvasHeight, 1920, '$.visuals.typography.canvasHeight', issues); finite(input.visuals.typography.diagramLabelsMinPx, '$.visuals.typography.diagramLabelsMinPx', 44, 240, issues); finite(input.visuals.typography.bodyNotesMinPx, '$.visuals.typography.bodyNotesMinPx', 52, 240, issues); finite(input.visuals.typography.headlineMinPx, '$.visuals.typography.headlineMinPx', 84, 240, issues); }
  }
  if (object(input.captions, '$.captions', ['languages','timed'], issues)) { if (!Array.isArray(input.captions.languages) || input.captions.languages.length < 1 || input.captions.languages.length > 10 || input.captions.languages.some(code => !LANGUAGE_CODES.has(code))) issues.push('$.captions.languages must contain one to ten supported language codes'); if (input.captions.timed !== true) issues.push('$.captions.timed must be true'); }
  if (object(input.research, '$.research', ['sources','dataForSEO','guarantees'], issues)) for (const key of ['sources','dataForSEO','guarantees']) requiredString(input.research[key], `$.research.${key}`, 500, issues);
  if (object(input.editorial, '$.editorial', ['keyPhraseAtStart','publicLinks','separateYouTubeH1','style','hashtags','exactCTA'], issues)) { if (input.editorial.publicLinks !== undefined && input.editorial.publicLinks !== false) issues.push('$.editorial.publicLinks must be false'); if (input.editorial.keyPhraseAtStart !== true) issues.push('$.editorial.keyPhraseAtStart must be true'); if (input.editorial.separateYouTubeH1 !== false) issues.push('$.editorial.separateYouTubeH1 must be false'); for (const key of ['style','hashtags','exactCTA']) requiredString(input.editorial[key], `$.editorial.${key}`, MAX.text, issues); }
  if (!Array.isArray(input.qa) || input.qa.length < 3 || input.qa.some(x => typeof x !== 'string' || x.length > 120)) issues.push('$.qa must contain at least three bounded checks');
  if (object(input.publication, '$.publication', ['defaultVisibility','approval','replayPolicy','schedule','publicByDefault','channelSelection','playlists'], issues)) { exact(input.publication.defaultVisibility, 'private_review', '$.publication.defaultVisibility', issues); for (const key of ['approval','replayPolicy','channelSelection']) requiredString(input.publication[key], `$.publication.${key}`, 200, issues); if (input.publication.publicByDefault !== false) issues.push('$.publication.publicByDefault must be false'); if (input.publication.playlists !== undefined) { if (!Array.isArray(input.publication.playlists) || input.publication.playlists.length > 5) issues.push('$.publication.playlists must contain zero to five entries'); else { const categories = new Set(), ids = new Set(); input.publication.playlists.forEach((entry, i) => { if (entry && typeof entry === 'object') for (const key of Object.keys(entry)) if (!['category','id','title','url'].includes(key)) issues.push(`$.publication.playlists[${i}].${key} is not supported`); if (!entry || typeof entry !== 'object' || !TOPIC_IDS.has(entry.category)) issues.push(`$.publication.playlists[${i}].category must be a supported topic category`); else { if (categories.has(entry.category)) issues.push('$.publication.playlists categories must be unique'); categories.add(entry.category); for (const key of ['id','title','url']) requiredString(entry[key], `$.publication.playlists[${i}].${key}`, key === 'title' ? 120 : 240, issues); if (!SAFE_ID.test(entry.id || '')) issues.push(`$.publication.playlists[${i}].id must be a safe plain ID`); else if (ids.has(entry.id)) issues.push('$.publication.playlists IDs must be unique'); else ids.add(entry.id); if (!SAFE_PLAYLIST_URL.test(entry.url || '')) issues.push(`$.publication.playlists[${i}].url must be a safe YouTube playlist URL`); else if (entry.url.split('list=')[1] !== entry.id) issues.push(`$.publication.playlists[${i}].url list ID must equal entry.id`); } }); } } if (object(input.publication.schedule, '$.publication.schedule', ['intervalMinutes','timezone','status'], issues)) { finite(input.publication.schedule.intervalMinutes, '$.publication.schedule.intervalMinutes', 1, 10080, issues); if (typeof input.publication.schedule.timezone !== 'string' || !input.publication.schedule.timezone.trim()) issues.push('$.publication.schedule.timezone must be an IANA timezone'); else { try { new Intl.DateTimeFormat('en-US', {timeZone: input.publication.schedule.timezone}); } catch { issues.push('$.publication.schedule.timezone must be an IANA timezone'); } } requiredString(input.publication.schedule.status, '$.publication.schedule.status', 120, issues); } }
  if (issues.length) throw new Error(issues.join('; '));
  const normalized = clone(input); normalized.editorial.publicLinks = false; return normalized;
}

export function buildProductionInstructions(profile, { topic, kitDir, outputDir, execution } = {}) {
  const p = validateProductionProfile(profile);
  for (const [value, field, max] of [[topic, 'topic', MAX.topic], [kitDir, 'kitDir', 500], [outputDir, 'outputDir', 500]]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
    if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
  }
  const topicConfig = p.visuals.topic;
  const typography = p.visuals.typography;
  const categoryContract = 'Write the selected topic category to BRIEF.json and DELIVERY.json metadata.category. Keep internal classification out of viewer-facing copy; preserve topic-specific source and causal scenes.';
  const styleLine = topicConfig ? `Select exactly one topic category for “${topic.trim()}” using this mapping: ${topicConfig.categories.map(c => `${c.id}=${c.title}; palette ${c.palette.join(', ')}; motifs ${c.motifs}`).join(' | ')}. Never use a universal space backdrop. Build at least ${topicConfig.layersMin} independently moving paper layers with ${topicConfig.parallaxPx[0]}–${topicConfig.parallaxPx[1]}px parallax and pivots no larger than ${topicConfig.paperPivotDegrees} degrees, keeping the causal foreground dominant.` : 'Select a topic-matched background when available and keep the causal foreground dominant.';
  const typeLine = typography ? `Typography at 1080x1920: diagram labels >=${typography.diagramLabelsMinPx}px, explanatory notes >=${typography.bodyNotesMinPx}px, headings >=${typography.headlineMinPx}px; preserve safe margins and line wrapping.` : 'Use readable typography with safe margins and line wrapping.';
  const playlists = (p.publication.playlists?.length ? `Playlist lookup: use only the saved category mapping (${p.publication.playlists.map(x => `${x.category}→${x.id}`).join(', ')}); verify the intended immutable channel and native playlist before an authorized attachment. Private stock records the intended category only; it gets no public playlist attachment or release target until specifically authorized.` : 'Playlist lookup: resolve the selected category to its saved native playlist mapping when the owner supplies IDs; never invent IDs or URLs.') + ' ' + categoryContract;
  return `Produce one self-contained ${p.brand} / ${p.name} short video for ${p.audience.market} in ${p.audience.language} (${p.audience.locale}) about “${topic.trim()}”. Read the editable template instructions at ${kitDir.trim()}/SKILL.md. Use that template and the saved profile and write this job’s editable source, evidence, renders, hashes, and QA outputs under ${outputDir.trim()}; do not read a handoff or prior chat.\n\nFormat: ${p.production.format}, ${p.production.width}x${p.production.height}, ${p.production.fps} fps; body about ${p.production.bodySeconds} seconds plus a ${p.production.ctaSeconds}-second CTA. Use ${execution?.model||p.model.name} at ${execution?.effort||p.model.effort} effort and ${execution?.serviceTier||p.model.speed} speed with no silent fallback. Voice: ${p.voice.name} through ${p.voice.route} (${p.voice.voiceId}); preserve complete word endings. Music policy: ${p.audio.music}; SFX policy: ${p.audio.sfx}.\n\nCreate ${p.visuals.art} art using ${p.visuals.palette.deepink}, ${p.visuals.palette.cream}, ${p.visuals.palette.tangerine}, and ${p.visuals.palette.mint}, with ${p.visuals.diagrams}. ${styleLine} ${typeLine} Keep labels ${p.visuals.labels}; captions are timed and do not burn every spoken caption into the picture. Include captions in ${p.captions.languages.join(', ')}. Research primary factual sources and reuse existing cached bounded DataForSEO evidence with costs and task IDs; no new paid research except explicit preapproved research receipts; make no trends or reach guarantees.\n\nPublic descriptions must contain no external URLs or source-credit blocks. Retain scientific sources only in internal metadata.evidence and research records. Open with the natural question/key phrase. Keep the explanation ${p.editorial.style}; avoid a separate YouTube H1. End the film/audio with the exact CTA: “${p.editorial.exactCTA}”. Run QA for ${p.qa.join(', ')}. ${playlists} Publication is private production/review by default, never automatically public: require an exact verified immutable target and approval, never replay an uncertain effect. Scheduling is ${p.publication.schedule.intervalMinutes} minutes in ${p.publication.schedule.timezone}, planned until a native receipt; planned or scheduled work is not public, and channel selection remains external.`;
}

export function resolveTopicStyle(profile, category) {
  const p = validateProductionProfile(profile), selected = category || p.visuals.topic?.defaultCategory;
  if (!p.visuals.topic || !selected) return null;
  const style = p.visuals.topic.categories.find(item => item.id === selected);
  if (!style) throw new Error(`Unsupported topic category: ${selected}`);
  return clone(style);
}

export function validatePublicationCopy(profile, { topic, keyPhrase, title, caption, hashtags } = {}) {
  const p = validateProductionProfile(profile), issues = [];
  const phrase = typeof keyPhrase === 'string' ? keyPhrase.trim() : '';
  const starts = value => { if (typeof value !== 'string') return false; const text = value.trim().toLocaleLowerCase(), needle = phrase.toLocaleLowerCase(); return text.startsWith(needle) && (text.length === needle.length || /[^\p{L}\p{N}_]/u.test(text[needle.length])); };
  if (!phrase || phrase.length > MAX.keyPhrase) issues.push({ code: 'key_phrase_invalid', field: 'keyPhrase', message: 'Provide a bounded key phrase.' });
  if (typeof topic !== 'string' || !topic.trim() || topic.length > MAX.topic) issues.push({ code: 'topic_invalid', field: 'topic', message: 'Provide a bounded topic.' });
  if (typeof title !== 'string' || !title.trim() || title.length > MAX.title) issues.push({ code: 'title_invalid', field: 'title', message: 'Title is required and must be at most 100 characters.' });
  if (typeof caption !== 'string' || !caption.trim() || caption.length > MAX.text) issues.push({ code: 'caption_invalid', field: 'caption', message: 'Caption is required and bounded.' });
  if (phrase && !starts(title)) issues.push({ code: 'key_phrase_not_at_start', field: 'title', message: 'Title must start with the natural question/key phrase.' });
  if (phrase && !starts(caption)) issues.push({ code: 'key_phrase_not_at_start', field: 'caption', message: 'Description must start with the natural question/key phrase.' });
  if (!Array.isArray(hashtags) || hashtags.length < 4 || hashtags.length > 5) issues.push({ code: 'hashtag_count', field: 'hashtags', message: 'Use four or five topic-relevant hashtags at the end only.' });
  else { const seen = new Set(); hashtags.forEach((tag, i) => { if (typeof tag !== 'string' || !/^#[A-Za-z0-9_]+$/.test(tag)) issues.push({ code: 'hashtag_invalid', field: `hashtags[${i}]`, message: 'Hashtags must be simple #tags.' }); else if (seen.has(tag.toLowerCase())) issues.push({ code: 'hashtag_duplicate', field: `hashtags[${i}]`, message: 'Hashtags must be unique.' }); else seen.add(tag.toLowerCase()); }); if (typeof caption === 'string') { const embedded = [...caption.matchAll(/#[A-Za-z0-9_]+/g)].map(match => match[0]); if (embedded.length && !caption.trim().endsWith(embedded.join(' '))) issues.push({ code: 'hashtags_midbody', field: 'caption', message: 'Embedded or mid-body hashtags are not allowed.' }); if (embedded.some(tag => !seen.has(tag.toLowerCase()))) issues.push({ code: 'hashtags_unrelated', field: 'caption', message: 'Description hashtags must match the separate hashtag array.' }); } }
  if (typeof caption === 'string' && /as an ai|in this video|unlock the power|dive into/i.test(caption)) issues.push({ code: 'ai_filler', field: 'caption', message: 'Remove generic AI filler.' });
  if (typeof caption === 'string' && /https?:\/\/|www\.|mailto:|\b[a-z0-9-]+\.(?:com|org|gov|edu|net|io|co|dev|pro|be)\b/i.test(caption)) issues.push({code:'public_link',field:'caption',message:'Remove external links from the public description. Keep sources in internal evidence.'});
  return { valid: issues.length === 0, issues };
}
