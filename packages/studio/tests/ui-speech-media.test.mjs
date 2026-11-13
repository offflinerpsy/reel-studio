import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('speech samples use the native media resolver while preview mode keeps direct URLs', async () => {
  const app = await readFile(new URL('../ui/app.jsx', import.meta.url), 'utf8');
  const panels = await readFile(new URL('../ui/workflow-panels.jsx', import.meta.url), 'utf8');
  assert.match(app, /mediaResolver=\{src=>boot\?Promise\.resolve\(\{url:src\}\):nativeMedia\(src\)\}/);
  assert.match(app, /readNativeMedia\(params=>bridge\.readServerResource\(params\)/);
  assert.match(panels, /<SpeechSamplePlayer src=\{sample\.audioURL\} mediaResolver=\{mediaResolver\}\/>/);
  assert.doesNotMatch(panels, /<audio[^>]+src=\{sample\.audioURL\}/);
  assert.match(panels, /Sample audio could not load in this panel/);
});
