import test from 'node:test';

test('public descriptions reject links while evidence remains separate',()=>{for(const url of ['https://www.nasa.gov/','www.nasa.gov','nasa.gov']){const r=validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE,{topic:'Why is the sky blue?',keyPhrase:'Why is the sky blue?',title:'Why is the sky blue?',caption:'Why is the sky blue? Light scatters. '+url,hashtags:['#Science','#Sky','#Physics','#Shorts']});assert.ok(r.issues.some(x=>x.code==='public_link'));}const old=structuredClone(DEFAULT_EXAMPLE_PROFILE);delete old.editorial.publicLinks;assert.equal(validateProductionProfile(old).editorial.publicLinks,false);});
import assert from 'node:assert/strict';
import {DEFAULT_EXAMPLE_PROFILE, validateProductionProfile, buildProductionInstructions, validatePublicationCopy, resolveTopicStyle} from '../server/production-profiles.mjs';

test('default profile is stable, normalized, and carries production constraints', () => {
  const profile = validateProductionProfile(DEFAULT_EXAMPLE_PROFILE);
  assert.equal(profile.id, 'example-profile'); assert.equal(profile.production.width, 1080); assert.equal(profile.voice.voiceId, 'configure-your-voice'); assert.equal(profile.publication.schedule.intervalMinutes, 60);
  assert.deepEqual(profile, DEFAULT_EXAMPLE_PROFILE); assert.notEqual(profile, DEFAULT_EXAMPLE_PROFILE);
});

test('rejects unsafe, unknown, and oversized fields', () => {
  assert.throws(() => validateProductionProfile({...DEFAULT_EXAMPLE_PROFILE, unknown: true}), /not supported/);
  assert.throws(() => validateProductionProfile({...DEFAULT_EXAMPLE_PROFILE, name: 'x'.repeat(121)}), /exceeds/);
  assert.throws(() => validateProductionProfile(JSON.parse('{"__proto__": {"polluted": true}}')), /Unsafe field/);
  assert.throws(() => validateProductionProfile({...DEFAULT_EXAMPLE_PROFILE, publication: {...DEFAULT_EXAMPLE_PROFILE.publication, publicByDefault: true}}), /publicByDefault/);
});

test('instructions are self-contained and use supplied job paths', () => {
  const text = buildProductionInstructions(DEFAULT_EXAMPLE_PROFILE, {topic: 'Why is the sky blue?', kitDir: '/kit', outputDir: '/jobs/a'});
  assert.match(text, /editable template instructions at \/kit\/SKILL\.md/); assert.match(text, /do not read a handoff or prior chat/); assert.match(text, /\/jobs\/a/); assert.match(text, /gpt-6.1-sol/); assert.match(text, /Stay curious/);
});

test('publication validation reports meaningful flags without changing input', () => {
  const input = {topic: 'Why is the sky blue?', keyPhrase: 'Why is the sky blue?', title: 'Why is the sky blue?', caption: 'Why is the sky blue? Light scatters. Subscribe with your next question.', hashtags: ['#science','#sky','#physics','#curious']};
  const valid = validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE, input); assert.equal(valid.valid, true); assert.deepEqual(input.hashtags, ['#science','#sky','#physics','#curious']);
  const bad = validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE, {...input, title: 'A title', hashtags: ['#one']}); assert.equal(bad.valid, false); assert.ok(bad.issues.some(x => x.code === 'key_phrase_not_at_start')); assert.ok(bad.issues.some(x => x.code === 'hashtag_count'));
});

test('separate Studio hashtags and natural description CTA are accepted; film CTA stays in instructions', () => {
  const input = {topic: 'Why is the sky blue?', keyPhrase: 'Why is the sky blue?', title: 'Why is the sky blue?', caption: 'Why is the sky blue? Subscribe for the next question.', hashtags: ['#science','#sky','#physics','#curious']};
  assert.equal(validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE, input).valid, true);
  const instructions = buildProductionInstructions(DEFAULT_EXAMPLE_PROFILE, {topic: input.topic, kitDir: '/kit', outputDir: '/job'});
  assert.match(instructions, /End the film\/audio with the exact CTA/); assert.match(instructions, /Stay curious\. Subscribe/);
  assert.equal(validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE, {...input, caption: `${input.caption} #science`}).valid, true);
  assert.equal(validatePublicationCopy(DEFAULT_EXAMPLE_PROFILE, {...input, caption: `${input.caption} #science extra`}).issues[0].code, 'hashtags_midbody');
});

test('custom profile settings are honored and key phrase matching uses a boundary', () => {
  const custom = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  custom.id = 'other-brand-v1'; custom.name = 'Other Brand'; custom.brand = 'Other Brand'; custom.audience = {language: 'English', locale: 'en-GB', market: 'United Kingdom'}; custom.model.effort = 'xhigh'; custom.captions.languages = ['en', 'de']; custom.publication.schedule.intervalMinutes = 120; custom.publication.schedule.timezone = 'Europe/London'; custom.editorial.style = 'plain mechanism-first prose'; custom.editorial.exactCTA = 'Ask another question.';
  validateProductionProfile(custom);
  const instructions = buildProductionInstructions(custom, {topic: 'Ice physics', kitDir: '/kit', outputDir: '/job'});
  assert.match(instructions, /Other Brand.*en-GB/); assert.match(instructions, /xhigh/); assert.match(instructions, /en, de/); assert.match(instructions, /plain mechanism-first prose/); assert.match(instructions, /120 minutes in Europe\/London/); assert.match(instructions, /Ask another question/);
  const bad = validatePublicationCopy(custom, {topic: 'Iceberg facts', keyPhrase: 'ice', title: 'Iceberg facts', caption: 'Iceberg facts explained.', hashtags: ['#ice','#science','#facts','#learn']});
  assert.ok(bad.issues.filter(issue => issue.code === 'key_phrase_not_at_start').length >= 2);
});

test('topic style and typography constraints are selected for future films', () => {
  const profile = validateProductionProfile(DEFAULT_EXAMPLE_PROFILE);
  assert.equal(resolveTopicStyle(profile, 'biology').title, 'Biology & the Human Body');
  assert.deepEqual(resolveTopicStyle(profile).palette, ['#091b31', '#27566b', '#ff9466', '#fff3d2']);
  assert.match(buildProductionInstructions(profile, {topic: 'Why is food spicy?', kitDir: '/kit', outputDir: '/job'}), /Select exactly one topic category/);
  assert.match(buildProductionInstructions(profile, {topic: 'Why is food spicy?', kitDir: '/kit', outputDir: '/job'}), /diagram labels >=44px/);
  assert.throws(() => resolveTopicStyle(profile, 'ocean'), /Unsupported topic/);
});

test('old profile revisions remain valid without optional style fields', () => {
  const legacy = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  delete legacy.visuals.topic; delete legacy.visuals.typography; delete legacy.publication.playlists;
  assert.equal(validateProductionProfile(legacy).id, 'example-profile');
  assert.doesNotThrow(() => buildProductionInstructions(legacy, {topic: 'Why is the sky blue?', kitDir: '/kit', outputDir: '/job'}));
});

test('playlist entries require plain ids and YouTube playlist urls', () => {
  const profile = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  profile.publication.playlists = [{category: 'space', id: 'PL_space_01', title: 'Space & Astronomy', url: 'https://www.youtube.com/playlist?list=PL_space_01'}];
  assert.doesNotThrow(() => validateProductionProfile(profile));
  profile.publication.playlists[0].url = 'javascript:alert(1)';
  assert.throws(() => validateProductionProfile(profile), /safe YouTube playlist URL/);
});

test('topic and playlist collections reject ambiguous mappings', () => {
  const duplicateTopic = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  duplicateTopic.visuals.topic.categories[1].id = 'space';
  assert.throws(() => validateProductionProfile(duplicateTopic), /unique category IDs/);
  const reversed = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  reversed.visuals.topic.parallaxPx = [55, 18];
  assert.throws(() => validateProductionProfile(reversed), /ascending range/);
  const unknown = structuredClone(DEFAULT_EXAMPLE_PROFILE);
  unknown.publication.playlists = [{category: 'space', id: 'PL_space_01', title: 'Space', url: 'https://www.youtube.com/playlist?list=PL_space_02', extra: true}];
  assert.throws(() => validateProductionProfile(unknown), /not supported/);
  assert.throws(() => validateProductionProfile({...DEFAULT_EXAMPLE_PROFILE, visuals: {...DEFAULT_EXAMPLE_PROFILE.visuals, topic: {...DEFAULT_EXAMPLE_PROFILE.visuals.topic, categories: DEFAULT_EXAMPLE_PROFILE.visuals.topic.categories.map(c => ({...c, extra: true}))}}}), /not supported/);
});
