'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const block = require('../blocks/list_folder_contents');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-list-folder-'));
  await fs.mkdir(path.join(root, 'alpha'));
  await fs.mkdir(path.join(root, 'empty'));
  await fs.writeFile(path.join(root, 'root.txt'), 'root');
  await fs.writeFile(path.join(root, 'alpha', 'nested.txt'), 'nested');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function execute(root, recursive = 'No') {
  const outputs = {};
  const action = await block.execute({ signal: new AbortController().signal }, { recursive }, { folder_path: root }, (name, value) => { outputs[name] = value; });
  return { action, outputs };
}

test('List Folder Contents accepts a text path and separates immediate files and folders', async t => {
  const root = await fixture(t);
  const { action, outputs } = await execute(root);
  assert.equal(action, 'success');
  assert.deepEqual(outputs.files, [path.join(root, 'root.txt')]);
  assert.deepEqual(outputs.folders, [path.join(root, 'alpha'), path.join(root, 'empty')]);
  assert.deepEqual(outputs.entries.map(entry => [entry.relativePath, entry.type]), [['alpha', 'folder'], ['empty', 'folder'], ['root.txt', 'file']]);
  assert.equal(outputs.entries.find(entry => entry.name === 'root.txt').size, 4);
  assert.equal(outputs.error_message, '');
});

test('List Folder Contents can recursively include nested files and reports invalid paths', async t => {
  const root = await fixture(t);
  const recursive = await execute(root, 'Yes');
  assert.equal(recursive.action, 'success');
  assert.ok(recursive.outputs.files.includes(path.join(root, 'alpha', 'nested.txt')));
  assert.ok(recursive.outputs.entries.some(entry => entry.relativePath === path.join('alpha', 'nested.txt')));

  const missing = await execute(path.join(root, 'missing'), 'Yes');
  assert.equal(missing.action, 'error');
  assert.deepEqual(missing.outputs.entries, []);
  assert.match(missing.outputs.error_message, /ENOENT/);
});

test('List Folder Contents accepts its folder path from a Text block in a workflow', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const root = await fixture(t);
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Folder workflow', workspaces: [{
    id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/files' } },
      { id: 'path', type: 'text', x: 0, y: 0, options: { text: root } },
      { id: 'list', type: 'list_folder_contents', x: 0, y: 0, options: { recursive: 'Yes' } },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'JSON', body: '[]', headers: '{}' } }
    ],
    connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'list', input: 'action', kind: 'action' },
      { id: 'v1', from: 'path', output: 'text', to: 'list', input: 'folder_path', kind: 'value' },
      { id: 'a2', from: 'list', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v2', from: 'list', output: 'entries', to: 'reply', input: 'body', kind: 'value' }
    ]
  }] };
  const app = createApp({ directory: root, document, definitions });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/files`);
  assert.equal(response.status, 200);
  const entries = await response.json();
  assert.ok(entries.some(entry => entry.relativePath === 'root.txt' && entry.type === 'file'));
  assert.ok(entries.some(entry => entry.relativePath === path.join('alpha', 'nested.txt') && entry.type === 'file'));
});
