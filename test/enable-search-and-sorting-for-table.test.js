'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const block = require('../blocks/enable_search_and_sorting_for_table');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');

test('Enable Search and Sorting for Table adds controls to every outer column', () => {
  const nested = { Status: 'Online' };
  const source = `<main>${convertJSONToHTMLTable([{ Name: 'Server 10', Count: 10, Details: nested }, { Name: 'Server 2', Count: 2, Details: nested }])}</main>`;
  const html = block.enableSearchAndSortingForTable(source);
  assert.match(html, /^<main><div class="phidias-table-search-sort">/);
  assert.equal((html.match(/class="phidias-table-search"/g) || []).length, 3);
  assert.equal((html.match(/class="phidias-table-sort"/g) || []).length, 3);
  assert.match(html, /aria-label="Search Name"/);
  assert.match(html, /localeCompare\(right\.value, undefined, \{ numeric: true/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /<\/script><\/main>$/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});

test('Enable Search and Sorting for Table reports invalid input through its error output', async () => {
  const outputs = {};
  const action = await block.execute({}, {}, { html: '<p>No table</p>' }, (name, value) => { outputs[name] = value; });
  assert.equal(action, 'error');
  assert.equal(outputs.html, '');
  assert.match(outputs.error_message, /does not contain a table/);
});

test('Enable Search and Sorting for Table works in an exported application workflow', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const source = convertJSONToHTMLTable([{ Name: 'Zulu' }, { Name: 'Alpha' }]);
  const document = { version: 1, name: 'Interactive table', workspaces: [{ id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/table' } },
      { id: 'html', type: 'text', x: 0, y: 0, options: { text: source } },
      { id: 'enhance', type: 'enable_search_and_sorting_for_table', x: 0, y: 0, options: {} },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ], connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'enhance', input: 'action', kind: 'action' },
      { id: 'v1', from: 'html', output: 'text', to: 'enhance', input: 'html', kind: 'value' },
      { id: 'a2', from: 'enhance', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v2', from: 'enhance', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ] }] };
  const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/table`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(html, /phidias-table-search-sort/);
  assert.match(html, /Search Name/);
});
