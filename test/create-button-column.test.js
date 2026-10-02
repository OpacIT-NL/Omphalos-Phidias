'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createButtonColumn } = require('../blocks/create_button_column');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');

test('Create Button Column adds a header and row-specific encoded URLs', () => {
  const html = convertJSONToHTMLTable([
    { ID: 'server 1/a', Name: 'Alpha' },
    { ID: 'server&2', Name: 'Beta' }
  ]);
  const result = createButtonColumn(html, 'Edit', '/systems/${text1}/edit?source=a&mode=full', 'id');
  assert.match(result, /<th>ID<\/th><th>Name<\/th><th>Edit<\/th>/);
  assert.match(result, /href="\/systems\/server%201%2Fa\/edit\?source=a&amp;mode=full"/);
  assert.match(result, /href="\/systems\/server%262\/edit\?source=a&amp;mode=full"/);
  assert.equal((result.match(/class="phidias-table-button"/g) || []).length, 2);
  assert.equal((result.match(/role="button">Edit<\/a>/g) || []).length, 2);
});

test('Create Button Column preserves wrappers and nested tables and supports a URL without a placeholder', () => {
  const table = convertJSONToHTMLTable([{ ID: 'one', Details: { Status: 'Online' } }]);
  const result = createButtonColumn(`<main>${table}</main>`, 'Open', 'https://example.test/systems', 'ID');
  assert.match(result, /^<main><table>/); assert.match(result, /<th>Status<\/th>/);
  assert.match(result, /href="https:\/\/example\.test\/systems"/);
  assert.match(result, /<\/table><\/main>$/);
});

test('Create Button Column returns useful errors and rejects unsafe URL schemes', async () => {
  const block = require('../blocks/create_button_column'), html = convertJSONToHTMLTable([{ ID: 'one' }]), outputs = {};
  const action = await block.execute({}, {}, { html, column_name: 'Edit', url: '/edit/${text1}', argument_column: 'Missing' }, (name, value) => { outputs[name] = value; });
  assert.equal(action, 'error'); assert.equal(outputs.html, '');
  assert.match(outputs.error_message, /Argument column not found: Missing/);
  assert.throws(() => createButtonColumn(html, 'ID', '/edit', 'ID'), /Column already exists/);
  assert.throws(() => createButtonColumn(html, 'Edit', 'javascript:alert(1)', 'ID'), /unsafe scheme/);
});

test('Create Button Column accepts all four values from Text blocks', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const source = convertJSONToHTMLTable([{ ID: 'abc 123', Name: 'Alpha' }]);
  const text = (id, value) => ({ id, type: 'text', x: 0, y: 0, options: { text: value } });
  const document = { version: 1, name: 'Button workflow', workspaces: [{ id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/table' } },
      text('html', source), text('name', 'Edit'), text('url', '/edit/${text1}'), text('argument', 'ID'),
      { id: 'button', type: 'create_button_column', x: 0, y: 0, options: {} },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ], connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'button', input: 'action', kind: 'action' },
      { id: 'v1', from: 'html', output: 'text', to: 'button', input: 'html', kind: 'value' },
      { id: 'v2', from: 'name', output: 'text', to: 'button', input: 'column_name', kind: 'value' },
      { id: 'v3', from: 'url', output: 'text', to: 'button', input: 'url', kind: 'value' },
      { id: 'v4', from: 'argument', output: 'text', to: 'button', input: 'argument_column', kind: 'value' },
      { id: 'a2', from: 'button', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v5', from: 'button', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ] }] };
  const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const result = await (await fetch(`http://127.0.0.1:${address.port}/table`)).text();
  assert.match(result, /<th>Edit<\/th>/);
  assert.match(result, /href="\/edit\/abc%20123"/);
});
