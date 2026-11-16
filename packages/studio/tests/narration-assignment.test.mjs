import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioStore, digest } from '../server/store.mjs';

const projectInput = () => ({ requestKey: randomUUID(), title: 'A narrated film', idea: 'Explain one idea.', templateId: 'kinetic', model: 'gpt-6.1-sol', effort: 'high', duration: 15, language: 'en' });
const wav = () => { const b = Buffer.alloc(44 + 48000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(48000, 40); return b; };
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'reel-narration-assignment-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const store = new StudioStore(home), project = store.create(projectInput()); mkdirSync(join(home, 'speech-audio')); mkdirSync(join(home, 'narration'));
  return { home, store, project, receipt: artifact(home) };
}
function artifact(home, id = 'a'.repeat(32), requestKey = randomUUID()) {
  const file = join(home, 'speech-audio', `${id}.wav`); writeFileSync(file, wav());
  return { requestKey, id, status: 'complete', effect: 'independently_verified', sha256: digest(wav()), file, duration: 1, mediaId: `speech-${id}` };
}

test('completed narration assignment persists only verified references, revisions and approval invalidation', t => {
  const { store, project, receipt, home } = fixture(t);
  const job = store.begin(project.id, { requestKey: randomUUID() }); const source = join(job.dir, 'video.mp4'); writeFileSync(source, 'video fixture');
  const version = store.addVersion(project.id, job.id, { path: source, media: { duration: 1 } }); store.approve(project.id, version.id, version.sha256, store.get(project.id).revision);
  const revision = store.get(project.id).revision;
  const assigned = store.assignNarration(project.id, { ...receipt, text: 'private entire script', key: 'private-key', wordTimings: [{ text: 'private words' }] }, revision);
  assert.equal(assigned.revision, revision + 1); assert.equal(assigned.status, 'review'); assert.equal(assigned.versions[0].approval, null);
  assert.deepEqual(assigned.narration, { ...receipt, bytes: wav().length });
  assert.deepEqual(new StudioStore(home).get(project.id).narration, assigned.narration);
  for (const secret of ['private entire script', 'private-key', 'private words']) assert.equal(readFileSync(store.path, 'utf8').includes(secret), false);
  const visible = store.public().projects.find(p => p.id === project.id).narration;
  assert.equal(visible.file, undefined); assert.equal(visible.mediaId, receipt.mediaId);
});

test('hash mismatch, duration mismatch, incomplete or uncertain receipts cannot change project state', t => {
  const { store, project, receipt } = fixture(t), before = readFileSync(store.path, 'utf8');
  for (const change of [{ sha256: '0'.repeat(64) }, { duration: 2 }, { status: 'reserved' }, { status: 'possibly_delivered', effect: 'possibly_delivered' }, { effect: 'delivered_unverified' }, { requestKey: 'bad' }, { mediaId: 'other' }, { id: '../escape' }]) {
    assert.throws(() => store.assignNarration(project.id, { ...receipt, ...change }, project.revision)); assert.equal(readFileSync(store.path, 'utf8'), before);
  }
});

test('audio outside owning home, symlink file and symlink directory are rejected even with matching bytes', t => {
  const { store, project, receipt, home } = fixture(t); const outside = mkdtempSync(join(tmpdir(), 'reel-other-audio-')); t.after(() => rmSync(outside, { recursive: true, force: true }));
  const externalFile = join(outside, `${receipt.id}.wav`); writeFileSync(externalFile, wav());
  assert.throws(() => store.assignNarration(project.id, { ...receipt, file: externalFile }), /owning Studio folder/);
  unlinkSync(receipt.file); symlinkSync(externalFile, receipt.file);
  assert.throws(() => store.assignNarration(project.id, receipt), /symlink/);
  unlinkSync(receipt.file); renameSync(join(home, 'speech-audio'), join(home, 'previous-audio')); symlinkSync(outside, join(home, 'speech-audio'));
  assert.throws(() => store.assignNarration(project.id, receipt), /symlink/); assert.equal(store.get(project.id).narration, undefined);
});

test('current expected revision is required when supplied and failed stale assignment preserves saved receipt', t => {
  const { store, project, receipt } = fixture(t); const assigned = store.assignNarration(project.id, receipt, project.revision);
  assert.throws(() => store.assignNarration(project.id, null, project.revision), /project changed/);
  assert.deepEqual(store.get(project.id).narration, assigned.narration);
  const cleared = store.assignNarration(project.id, null, assigned.revision); assert.equal(cleared.narration, undefined); assert.equal(cleared.narrationHistory.length, 1);
});

test('requestKey cannot bind a different payload after replacement or clear', t => {
  const { store, project, receipt, home } = fixture(t); store.assignNarration(project.id, receipt);
  const second = artifact(home, 'b'.repeat(32)); store.assignNarration(project.id, second);
  const changed = artifact(home, 'c'.repeat(32), receipt.requestKey);
  assert.throws(() => store.assignNarration(project.id, changed), /immutable receipt payload/);
  store.assignNarration(project.id, null); assert.throws(() => store.assignNarration(project.id, changed), /immutable receipt payload/);
  store.assignNarration(project.id, receipt); assert.equal(store.get(project.id).narration.id, receipt.id);
  for (const entry of store.public().projects.find(p => p.id === project.id).narrationHistory) assert.equal(entry.file, undefined);
});

test('word timing file is validated privately and its content cannot enter project state', t => {
  const { store, project, receipt, home } = fixture(t), timingsPath = join(home, 'narration', `${receipt.id}.words.json`);
  const words = JSON.stringify({ unit: 'milliseconds', words: [{ text: 'private timing text', offset: 0, duration: 100 }] }); writeFileSync(timingsPath, words);
  const assigned = store.assignNarration(project.id, { ...receipt, wordTimingsPath: timingsPath, hasWordTimings: true });
  assert.equal(assigned.narration.timingsPath, timingsPath); assert.equal(assigned.narration.timingsSha256, digest(words)); assert.equal(readFileSync(store.path, 'utf8').includes('private timing text'), false);
  assert.equal(store.public().projects[0].narration.timingsPath, undefined);
  writeFileSync(timingsPath, JSON.stringify({ unit: 'milliseconds', words: [{ text: 'late', offset: 5000, duration: 100 }] }));
  assert.throws(() => store.assignNarration(project.id, { ...receipt, timingsPath }), /word timings are invalid/);
});

test('managed directions, active and uncertain jobs, and dependency checkpoints preserve producer admission', t => {
  const { store, project, receipt } = fixture(t);
  store.tx(state => { state.projects.find(p => p.id === project.id).productionLineId = randomUUID(); });
  assert.throws(() => store.assignNarration(project.id, receipt), /managed production direction owner/);
  store.tx(state => { delete state.projects.find(p => p.id === project.id).productionLineId; });
  const job = store.begin(project.id, { requestKey: randomUUID() }); assert.throws(() => store.assignNarration(project.id, receipt), /holds this project/);
  store.job(project.id, job.id, { status: 'uncertain' }); assert.throws(() => store.assignNarration(project.id, receipt), /holds this project/);
  store.tx(state => { const current = state.projects.find(p => p.id === project.id).jobs[0]; current.status = 'dependency_checkpoint'; });
  assert.throws(() => store.assignNarration(project.id, receipt), /holds this project/); assert.throws(() => store.assignNarration(project.id, null), /holds this project/);
});

test('begin freezes the selected verified narration and public job output removes all backend paths', t => {
  const { store, project, receipt, home } = fixture(t), timingsPath = join(home, 'narration', `${receipt.id}.words.json`);
  writeFileSync(timingsPath, JSON.stringify({ unit: 'milliseconds', words: [{ text: 'private spoken words', offset: 10, duration: 100 }] }));
  const assigned = store.assignNarration(project.id, { ...receipt, timingsPath });
  const job = store.begin(project.id, { requestKey: randomUUID(), expectedRevision: assigned.revision });
  assert.deepEqual(job.narration, assigned.narration); assert.deepEqual(store.verifyJobNarration(project.id, job.id), assigned.narration);
  assert.deepEqual(new StudioStore(home).verifyJobNarration(project.id, job.id), assigned.narration);
  store.tx(state => { const current = state.projects.find(p => p.id === project.id); current.jobs[0].narrationHistory = [{ ...receipt, timingsPath, audioPath: receipt.file, wordTimingsPath: timingsPath }]; current.narration = null; });
  assert.deepEqual(store.verifyJobNarration(project.id, job.id), assigned.narration);
  const visibleJob = store.public().projects.find(p => p.id === project.id).jobs[0];
  for (const ref of [visibleJob.narration, ...visibleJob.narrationHistory]) for (const pathKey of ['file', 'audioPath', 'timingsPath', 'wordTimingsPath']) assert.equal(ref[pathKey], undefined);
  assert.equal(visibleJob.narration.mediaId, receipt.mediaId); assert.equal(JSON.stringify(store.public()).includes(home), false);
  assert.equal(JSON.stringify(store.public()).includes('private spoken words'), false);
});

test('disk substitution after assignment blocks begin without creating or committing any job', t => {
  const { store, project, receipt } = fixture(t); const assigned = store.assignNarration(project.id, receipt);
  const changed = wav(); changed[changed.length - 1] = 12; writeFileSync(receipt.file, changed);
  const before = readFileSync(store.path, 'utf8');
  assert.throws(() => store.begin(project.id, { requestKey: randomUUID(), expectedRevision: assigned.revision }), /SHA-256/);
  assert.equal(readFileSync(store.path, 'utf8'), before); assert.equal(store.get(project.id).jobs.length, 0);
});

test('frozen job consumption rechecks audio and timing hashes and cannot consume uncertain or checkpoint jobs', t => {
  const { store, project, receipt, home } = fixture(t), timingsPath = join(home, 'narration', `${receipt.id}.words.json`);
  const timings = JSON.stringify({ unit: 'milliseconds', words: [{ text: 'word', offset: 0, duration: 100 }] }); writeFileSync(timingsPath, timings);
  store.assignNarration(project.id, { ...receipt, timingsPath }); const job = store.begin(project.id, { requestKey: randomUUID() });
  const before = readFileSync(store.path, 'utf8'), changed = wav(); changed[changed.length - 1] = 18; writeFileSync(receipt.file, changed);
  assert.throws(() => store.verifyJobNarration(project.id, job.id), /SHA-256/); assert.equal(readFileSync(store.path, 'utf8'), before);
  writeFileSync(receipt.file, wav()); writeFileSync(timingsPath, timings.replace('word', 'substituted'));
  assert.throws(() => store.verifyJobNarration(project.id, job.id), /word timing SHA-256/);
  writeFileSync(timingsPath, timings); store.job(project.id, job.id, { status: 'uncertain' });
  assert.throws(() => store.verifyJobNarration(project.id, job.id), /active admitted native job/);
  store.tx(state => { state.projects.find(p => p.id === project.id).jobs[0].status = 'dependency_checkpoint'; });
  assert.throws(() => store.verifyJobNarration(project.id, job.id), /dependency checkpoint/);
});

test('begin honors supplied project revision and existing job keeps its original frozen receipt', t => {
  const { store, project, receipt } = fixture(t), assigned = store.assignNarration(project.id, receipt);
  assert.throws(() => store.begin(project.id, { requestKey: randomUUID(), expectedRevision: project.revision }), /project changed/);
  const requestKey = randomUUID(), job = store.begin(project.id, { requestKey, expectedRevision: assigned.revision });
  const replay = store.begin(project.id, { requestKey, expectedRevision: assigned.revision }); assert.equal(replay.id, job.id); assert.deepEqual(replay.narration, job.narration); assert.equal(replay.reused, true);
});
