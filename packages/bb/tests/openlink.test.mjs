import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openProtectedSetupLink');
assert.ok(declaration, 'the real BB URL boundary is exported for focused verification');
const compiled = ts.transpileModule(declaration.getText(ast), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
const {openProtectedSetupLink} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const token = 'a'.repeat(64);

test('protected setup URLs use the supported BB URL handler and retain the exact capability', () => {
  const seen = [];
  for (const service of ['runtime', 'azure', 'dataforseo', 'telegram', 'youtube']) {
    const url = `http://127.0.0.1:43127/setup/${service}?key=${token}`;
    assert.deepEqual(openProtectedSetupLink(url, value => { seen.push(value); return true; }), {isError: false});
    assert.equal(seen.at(-1), url);
  }
  assert.deepEqual(openProtectedSetupLink(`http://127.0.0.1:43127/setup/azure?key=${token}`, () => false), {isError: true});
  assert.deepEqual(openProtectedSetupLink(`http://127.0.0.1:80/setup/azure?key=${token}`, () => true), {isError: false});
  assert.deepEqual(openProtectedSetupLink(`http://127.0.0.1:43127/setup/azure?key=${token}`, () => { throw Error('blocked'); }), {isError: true});
});

test('host aliases, external targets, credentials, traversal and extra query flags cannot reach the BB handler', () => {
  let calls = 0;
  for (const url of [
    `https://127.0.0.1:1234/setup/azure?key=${token}`,
    `http://localhost:1234/setup/azure?key=${token}`,
    `http://127.1:1234/setup/azure?key=${token}`,
    `http://2130706433:1234/setup/azure?key=${token}`,
    `http://127.0.0.1.evil.invalid:1234/setup/azure?key=${token}`,
    `http://127.0.0.1:65536/setup/azure?key=${token}`,
    `http://127.0.0.1:0/setup/azure?key=${token}`,
    `http://127.0.0.1:1234/setup/unknown?key=${token}`,
    `http://user@127.0.0.1:1234/setup/azure?key=${token}`,
    `http://127.0.0.1:1234/setup/a/../azure?key=${token}`,
    `http://127.0.0.1:1234/setup/azure?key=${token}&redirect=https://evil.invalid`,
    `http://127.0.0.1:1234/setup/azure?key=${token}&key=${token}`,
    `http://127.0.0.1:1234/setup/azure?key=${token}#fragment`,
    'javascript:alert(1)', 'file:///etc/passwd', '', null,
  ]) assert.deepEqual(openProtectedSetupLink(url, () => { calls++; return true; }), {isError: true}, String(url));
  assert.equal(calls, 0);
});

test('the bridge advertises only its guarded openLink handler without enabling iframe popups', () => {
  assert.match(source, /openLinks:\{\}/);
  assert.match(source, /bridge\.onopenlink=.*openProtectedSetupLink\(url,value=>navigateRef\.current\.openUrl\(value\)\)/);
  assert.match(source, /sandbox="allow-scripts"/);
  assert.doesNotMatch(source, /window\.open\(|allow-popups/);
});
