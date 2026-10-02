'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sortHTMLTable } = require('../blocks/sort_html_table');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');

function positions(html, values) { return values.map(value => html.indexOf(`>${value}<`)); }

test('Sort HTML Table sorts naturally in ascending and descending order', () => {
  const html = convertJSONToHTMLTable([
    { Name: 'Server 10', Count: 10 },
    { Name: 'server 2', Count: 2 },
    { Name: 'Server 1', Count: 1 }
  ]);
  const ascending = sortHTMLTable(html, ' name ', 'Ascending');
  assert.deepEqual(positions(ascending, ['Server 1', 'server 2', 'Server 10']).slice().sort((a, b) => a - b), positions(ascending, ['Server 1', 'server 2', 'Server 10']));
  const descending = sortHTMLTable(html, 'Count', 'Descending');
  assert.deepEqual(positions(descending, ['10', '2', '1']).slice().sort((a, b) => a - b), positions(descending, ['10', '2', '1']));
  assert.match(descending, /<th>Name<\/th><th>Count<\/th>/);
});

test('Sort HTML Table preserves wrappers, nested cells, headings, and footers', () => {
  const nestedA = convertJSONToHTMLTable({ Status: 'Offline' });
  const nestedB = convertJSONToHTMLTable({ Status: 'Online' });
  const html = `<main><table><thead><tr><th>Name</th><th>Details</th></tr></thead><tbody><tr><td>Zulu</td><td>${nestedA}</td></tr><tr><td>Alpha</td><td>${nestedB}</td></tr></tbody><tfoot><tr><td>Total</td><td>2</td></tr></tfoot></table></main>`;
  const sorted = sortHTMLTable(html, 'Name', 'Ascending');
  assert.ok(sorted.indexOf('>Alpha<') < sorted.indexOf('>Zulu<'));
  assert.match(sorted, /<table><thead>/);
  assert.match(sorted, /<th>Status<\/th>/);
  assert.ok(sorted.indexOf('>Total<') > sorted.indexOf('>Zulu<'));
  assert.match(sorted, /^<main>/); assert.match(sorted, /<\/main>$/);
});

test('Sort HTML Table exposes errors for missing columns', async () => {
  const block = require('../blocks/sort_html_table'), outputs = {};
  const action = await block.execute({}, { direction: 'Ascending' }, { html: '<table><tr><th>Name</th></tr><tr><td>Alice</td></tr></table>', column: 'Unknown' }, (name, value) => { outputs[name] = value; });
  assert.equal(action, 'error'); assert.equal(outputs.html, '');
  assert.match(outputs.error_message, /Column not found: Unknown/);
});

test('Sort HTML Table accepts its HTML and column from Text blocks', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const source = convertJSONToHTMLTable([{ Name: 'Zulu' }, { Name: 'Alpha' }]);
  const document = { version: 1, name: 'Sort workflow', workspaces: [{ id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/table' } },
      { id: 'html', type: 'text', x: 0, y: 0, options: { text: source } },
      { id: 'column', type: 'text', x: 0, y: 0, options: { text: 'Name' } },
      { id: 'sort', type: 'sort_html_table', x: 0, y: 0, options: { direction: 'Ascending' } },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ], connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'sort', input: 'action', kind: 'action' },
      { id: 'v1', from: 'html', output: 'text', to: 'sort', input: 'html', kind: 'value' },
      { id: 'v2', from: 'column', output: 'text', to: 'sort', input: 'column', kind: 'value' },
      { id: 'a2', from: 'sort', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v3', from: 'sort', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ] }] };
  const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const sorted = await (await fetch(`http://127.0.0.1:${address.port}/table`)).text();
  assert.ok(sorted.indexOf('>Alpha<') < sorted.indexOf('>Zulu<'));
});
