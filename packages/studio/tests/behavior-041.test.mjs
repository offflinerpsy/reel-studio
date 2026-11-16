import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ResearchService} from '../server/research.mjs';

const settings = {keywords: ['solar wind'], locationCode: 2840, languageCode: 'en', timeRange: 'past_30_days', maxCostUSD: 0.013};

test('actual research cost stops the next request and a restart preserves the partial no-replay fence', async t => {
  const home = await mkdtemp(join(tmpdir(), 'reel-behavior-041-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  let requests = 0, checks = 0;
  const options = {checkAccess: async () => {checks++; return {status: 'verified'};}, request: async input => {
    requests++;
    return {tasks: [{id: 'first-task', status_code: 20000, cost: 0.02, data: input.data[0], result: []}]};
  }};
  const service = new ResearchService(home, options);
  await assert.rejects(service.run(settings, {}), /cost limit/);
  assert.equal(requests, 1); assert.equal(checks, 1);
  const [file] = (await readdir(join(home, 'research'))).filter(name => name.endsWith('.json'));
  const receipt = JSON.parse(await readFile(join(home, 'research', file), 'utf8'));
  assert.equal(receipt.status, 'partial'); assert.equal(receipt.totalCostUSD, 0.02);
  assert.equal(receipt.operations.length, 1); assert.equal(receipt.operations[0].effect, 'independently_verified');
  const reopened = new ResearchService(home, options);
  await assert.rejects(reopened.run({...settings, maxCostUSD: 1}, {}), /reconciliation/);
  assert.equal(requests, 1); assert.equal(checks, 1);
});
