'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const block = require('../blocks/enable_search_and_sorting_for_table');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');
const { convertJSONToHTMLDetail } = require('../blocks/convert_json_to_html_detail');
const { createButtonColumn } = require('../blocks/create_button_column');
const { createButtonDetailRow } = require('../blocks/create_button_detail_row');

test('Enable Search and Sorting for Table adds controls to every outer column', () => {
  const nested = { Status: 'Online' };
  const source = `<main>${convertJSONToHTMLTable([{ Name: 'Server 10', Count: 10, Details: nested }, { Name: 'Server 2', Count: 2, Details: nested }])}</main>`;
  const html = block.enableSearchAndSortingForTable(source);
  assert.match(html, /^<main><div class="phidias-table-search-sort">/);
  assert.equal((html.match(/class="phidias-table-search"/g) || []).length, 3);
  assert.equal((html.match(/class="phidias-table-search phidias-table-search--mobile"/g) || []).length, 3);
  assert.equal((html.match(/class="phidias-table-sort"/g) || []).length, 3);
  assert.match(html, /aria-label="Search Name"/);
  assert.match(html, /<details class="phidias-table-mobile-search"><summary>Search and filter<\/summary>/);
  assert.match(html, /<div class="phidias-table-scroll"><table>/);
  assert.match(html, /@media \(max-width:48rem\)/);
  assert.match(html, /min-height:2\.75rem/);
  assert.match(html, /peer\.dataset\.phidiasColumn === input\.dataset\.phidiasColumn/);
  assert.match(html, /localeCompare\(right\.value, undefined, \{ numeric: true/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /<\/script><\/main>$/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});

test('Enable Search and Sorting for Table excludes button columns', () => {
  const source = createButtonColumn(
    convertJSONToHTMLTable([{ Name: 'Alpha', Status: 'Online' }]),
    'Open',
    '/systems/${text1}',
    'Name'
  );
  const html = block.enableSearchAndSortingForTable(source);
  assert.equal((html.match(/class="phidias-table-search"/g) || []).length, 2);
  assert.equal((html.match(/class="phidias-table-search phidias-table-search--mobile"/g) || []).length, 2);
  assert.equal((html.match(/class="phidias-table-sort"/g) || []).length, 2);
  assert.doesNotMatch(html, /aria-label="Search Open"/);
  assert.match(html, /<th class="phidias-table-button-column"[^>]*><\/th>/);
  assert.match(html, />Open<\/a>/);
});

test('Enable Search and Sorting for Table keeps button detail rows outside filtering and sorting', () => {
  const source = createButtonDetailRow(
    convertJSONToHTMLDetail({ Name: 'Alpha', Status: 'Online' }),
    'Edit',
    '/systems/${text1}',
    'Name'
  );
  const html = block.enableSearchAndSortingForTable(source);
  assert.match(html, /<tr class="phidias-table-button-row">/);
  assert.match(html, /const isButtonRow = row =>/);
  assert.match(html, /if \(isButtonRow\(row\)\) \{\s*row\.hidden = false;/);
  assert.match(html, /\.filter\(row => !isButtonRow\(row\)\)/);
  assert.match(html, /original\.map\(row => isButtonRow\(row\) \? row : sorted\[sortedIndex\+\+\]\.row\)/);
});

test('Enable Search and Sorting for Table gives detail lists the mobile search panel', () => {
  const html = block.enableSearchAndSortingForTable(convertJSONToHTMLDetail({ Name: 'Server 10', Status: 'Online' }));
  assert.match(html, /<details class="phidias-table-mobile-search"><summary>Search and filter<\/summary>/);
  assert.match(html, /class="phidias-table-search phidias-table-search--mobile"/);
  assert.match(html, /<div class="phidias-table-scroll"><table class="phidias-detail-table">/);
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
