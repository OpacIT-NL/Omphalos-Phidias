'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp, loadDefinitions } = require('../runtime/app');
const { validate } = require('../runtime/validate');

const definitions = () => loadDefinitions(path.resolve(__dirname, '../blocks'));
const block = (id, type, options, x = 0, y = 0) => ({ id, type, x, y, options });
const edge = (id, from, output, to, input = 'action', kind = 'action') => ({ id, from, output, to, input, kind });

test('block definitions reload from disk instead of using stale module metadata', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-block-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'changing.js');
  await fs.writeFile(filename, "module.exports = { type: 'changing', name: 'Old', fields: [], outputs: [] };\n");
  assert.equal(loadDefinitions(directory).get('changing').name, 'Old');
  await fs.writeFile(filename, "module.exports = { type: 'changing', name: 'New', fields: [{ key: 'format', label: 'Format', type: 'select', choices: ['JSON', 'HTML'], default: 'JSON' }], outputs: [] };\n");
  const reloaded = loadDefinitions(directory).get('changing');
  assert.equal(reloaded.name, 'New');
  assert.deepEqual(reloaded.fields[0].choices, ['JSON', 'HTML']);
});

test('every imported block loads with normalized fields and typed ports', () => {
  const library = definitions();
  assert.ok(library.has('linux_command'));
  assert.deepEqual(library.get('merge_texts_advanced').fields.map(field => field.key), ['text']);
  assert.deepEqual(library.get('merge_texts_advanced').inputPorts.map(port => port.id), ['action', 'text1', 'text2', 'text3']);
  for (const [type, definition] of library) {
    assert.equal(definition.type, type);
    assert.ok(definition.name);
    assert.ok(Array.isArray(definition.fields));
    assert.ok(Array.isArray(definition.inputPorts));
    assert.ok(Array.isArray(definition.outputPorts));
    assert.equal(new Set(definition.inputPorts.map(port => port.id)).size, definition.inputPorts.length);
    assert.equal(new Set(definition.outputPorts.map(port => port.id)).size, definition.outputPorts.length);
  }
  const blocks = [...library.values()].map((definition, index) =>
    block(`block_${index}`, definition.type, Object.fromEntries(definition.fields.map(field => [field.key, field.default])), index * 10, 0));
  assert.doesNotThrow(() => validate({
    version: 1,
    name: 'Complete imported library',
    workspaces: [{ id: 'main', name: 'Main', active: false, blocks, connections: [] }]
  }, library));
});

test('imported value wires and action branches execute in an exported app', async t => {
  const library = definitions();
  const document = {
    version: 1,
    name: 'Imported data flow',
    workspaces: [{
      id: 'main', name: 'Main', active: true,
      blocks: [
        block('http', 'http', { method: 'GET', path: '/merge' }),
        block('left', 'text', { text: 'Hello ' }),
        block('right', 'text', { text: 'world' }),
        block('merge', 'merge_texts', { position_type: 'last', text1: '', text2: '', custom_position: 0 }),
        block('check', 'check_comparison', { comparison_type: 'equal', value1: '', value2: 'Hello world' }),
        block('yes', 'respond', { status: 200, body: '{{vars.merge.text}}' }),
        block('no', 'respond', { status: 409, body: 'wrong branch' })
      ],
      connections: [
        edge('a1', 'http', 'next', 'merge'),
        edge('v1', 'left', 'text', 'merge', 'text1', 'value'),
        edge('v2', 'right', 'text', 'merge', 'text2', 'value'),
        edge('a2', 'merge', 'action', 'check'),
        edge('v3', 'merge', 'text', 'check', 'value1', 'value'),
        edge('a3', 'check', 'action1', 'yes'),
        edge('a4', 'check', 'action2', 'no')
      ]
    }]
  };
  const errors = [];
  const app = createApp({ document, definitions: library, onError: error => errors.push(error) });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/merge`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Hello world');
  assert.deepEqual(errors, []);
});

test('Receiver accepts a connected ID and only runs for a matching Emitter', async t => {
  const library = definitions();
  const document = {
    version: 1,
    name: 'Emitter and receiver',
    workspaces: [{
      id: 'main', name: 'Main', active: true,
      blocks: [
        block('http', 'http', { method: 'GET', path: '/emit' }),
        block('matching-id', 'text', { text: 'systems' }),
        block('wrong-id', 'text', { text: 'other' }),
        block('payload', 'text', { text: 'receiver ran' }),
        block('emitter', 'emitter', { restriction_type: 'current', search_type: 'number' }),
        block('receiver', 'receiver', {}),
        block('wrong-receiver', 'receiver', {}),
        block('response', 'respond', { status: 200, body: 'missing receiver value' })
      ],
      connections: [
        edge('a1', 'http', 'next', 'emitter'),
        edge('v1', 'matching-id', 'text', 'emitter', 'id', 'value'),
        edge('v2', 'payload', 'text', 'emitter', 'value1', 'value'),
        edge('v3', 'matching-id', 'text', 'receiver', 'id', 'value'),
        edge('v4', 'wrong-id', 'text', 'wrong-receiver', 'id', 'value'),
        edge('a2', 'receiver', 'action', 'response'),
        edge('v5', 'receiver', 'value1', 'response', 'body', 'value')
      ]
    }]
  };
  assert.doesNotThrow(() => validate(structuredClone(document), library));
  const errors = [];
  const app = createApp({ document, definitions: library, onError: error => errors.push(error) });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/emit`);
  const responseBody = await response.text();
  assert.equal(response.status, 200, `${responseBody}: ${errors.map(error => error.stack || error.message).join(' | ')}`);
  assert.equal(responseBody, 'receiver ran');
  assert.deepEqual(errors, []);
});

test('imported write and read file blocks await action flow and expose output values', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-imported-'));
  const file = path.join(folder, 'nested', 'value.txt');
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const library = definitions();
  const document = {
    version: 1,
    name: 'Imported files',
    workspaces: [{
      id: 'main', name: 'Main', active: true,
      blocks: [
        block('http', 'http', { method: 'GET', path: '/file' }),
        block('write', 'write_file', { file_path: file, content: 'saved', conversion_type: 'text' }),
        block('read', 'read_file', { file_path: file, conversion_type: 'text' }),
        block('response', 'respond', { status: 200, body: '{{vars.read.content}}' }),
        block('missing', 'respond', { status: 404, body: 'missing' })
      ],
      connections: [
        edge('a1', 'http', 'next', 'write'),
        edge('a2', 'write', 'action', 'read'),
        edge('a3', 'read', 'action', 'response'),
        edge('a4', 'read', 'action2', 'missing')
      ]
    }]
  };
  const app = createApp({ document, definitions: library });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/file`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'saved');
  assert.equal(await fs.readFile(file, 'utf8'), 'saved');
});
