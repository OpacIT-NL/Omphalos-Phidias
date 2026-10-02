'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectHTMLTableColumns } = require('../blocks/select_html_table_columns');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');

test('Select HTML Table Columns keeps requested headings in original order', () => {
  const html = convertJSONToHTMLTable([
    { Name: 'Alice', Role: 'Admin', Email: 'alice@example.test' },
    { Name: 'Bob', Role: 'User', Email: 'bob@example.test' }
  ]);
  const filtered = selectHTMLTableColumns(html, 'email, NAME');
  assert.match(filtered, /<th>Name<\/th><th>Email<\/th>/);
  assert.doesNotMatch(filtered, /<th>Role<\/th>|>Admin<|>User</);
  assert.match(filtered, /<td>Alice<\/td><td>alice@example\.test<\/td>/);
  assert.match(filtered, /<td>Bob<\/td><td>bob@example\.test<\/td>/);
});

test('Select HTML Table Columns preserves wrappers and nested tables inside selected cells', () => {
  const table = convertJSONToHTMLTable([{ Name: 'Server A', Details: { Status: 'Online', Region: 'EU' }, Secret: 'remove-me' }]);
  const html = `<!doctype html><main>${table}</main>`;
  const filtered = selectHTMLTableColumns(html, 'Name, Details');
  assert.match(filtered, /^<!doctype html><main><table>/);
  assert.match(filtered, /<th>Status<\/th><th>Region<\/th>/);
  assert.match(filtered, />Online<|>EU</);
  assert.doesNotMatch(filtered, /Secret|remove-me/);
  assert.match(filtered, /<\/table><\/main>$/);
});

test('Select HTML Table Columns reports missing or invalid selections', async () => {
  const block = require('../blocks/select_html_table_columns');
  const outputs = {};
  const action = await block.execute({}, {}, { html: '<table><tr><th>Name</th></tr><tr><td>Alice</td></tr></table>', columns: 'Unknown' }, (name, value) => { outputs[name] = value; });
  assert.equal(action, 'error');
  assert.equal(outputs.html, '');
  assert.match(outputs.error_message, /Column not found: Unknown/);
  assert.throws(() => selectHTMLTableColumns('not a table', 'Name'), /does not contain a table/);
  assert.throws(() => selectHTMLTableColumns('<table><tr><td>Alice<\/td><\/tr><\/table>', 'Name'), /does not contain column headings/);
});

test('Select HTML Table Columns accepts HTML and column names from Text blocks', async t => {
  const path = require('node:path');
  const { createApp, loadDefinitions } = require('../runtime/app');
  const source = '<table><thead><tr><th>Name</th><th>Private</th></tr></thead><tbody><tr><td>Alice</td><td>hidden</td></tr></tbody></table>';
  const document = { version: 1, name: 'Column workflow', workspaces: [{
    id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/table' } },
      { id: 'html', type: 'text', x: 0, y: 0, options: { text: source } },
      { id: 'columns', type: 'text', x: 0, y: 0, options: { text: 'Name' } },
      { id: 'select', type: 'select_html_table_columns', x: 0, y: 0, options: {} },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ],
    connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'select', input: 'action', kind: 'action' },
      { id: 'v1', from: 'html', output: 'text', to: 'select', input: 'html', kind: 'value' },
      { id: 'v2', from: 'columns', output: 'text', to: 'select', input: 'columns', kind: 'value' },
      { id: 'a2', from: 'select', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v3', from: 'select', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ]
  }] };
  const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/table`);
  assert.equal(response.status, 200);
  const filtered = await response.text();
  assert.match(filtered, /<th>Name<\/th>/);
  assert.doesNotMatch(filtered, /Private|hidden/);
});
