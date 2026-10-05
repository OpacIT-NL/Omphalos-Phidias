'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { convertJSONToHTMLDetail } = require('../blocks/convert_json_to_html_detail');
const { selectHTMLDetailRows } = require('../blocks/select_html_detail_rows');
const { createButtonDetailRow } = require('../blocks/create_button_detail_row');
const { sortHTMLDetailRows } = require('../blocks/sort_html_detail_rows');

test('Convert JSON to HTML Detail creates headed vertical rows and nested tables', () => {
  const html = convertJSONToHTMLDetail(JSON.stringify({
    ID: 'server 1/a', Name: 'Alpha & Beta', Details: { Status: 'Online' }, Roles: [{ Name: 'Admin' }, { Name: 'User' }]
  }));
  assert.match(html, /^<table class="phidias-detail-table">/);
  assert.match(html, /<tr><th scope="row">ID<\/th><td>server 1\/a<\/td><\/tr>/);
  assert.match(html, /<th scope="row">Name<\/th><td>Alpha &amp; Beta<\/td>/);
  assert.match(html, /<th scope="row">Details<\/th><td>\s*<table class="phidias-detail-table">/);
  assert.match(html, /<th scope="row">Status<\/th><td>Online<\/td>/);
  assert.match(html, /<th>Admin|<td>Admin/);
  assert.throws(() => convertJSONToHTMLDetail('[{"ID":1}]'), /requires a JSON object/);
  const circular = {}; circular.self = circular;
  assert.throws(() => convertJSONToHTMLDetail(circular), /circular objects/);
});

test('Select HTML Detail Rows filters top-level rows and preserves nested detail tables', () => {
  const source = convertJSONToHTMLDetail({ ID: 17, Name: 'Delphi', Details: { Status: 'Online' } });
  const filtered = selectHTMLDetailRows(`<main>${source}</main>`, ' name, Details ');
  assert.doesNotMatch(filtered, /scope="row">ID</);
  assert.match(filtered, /scope="row">Name/);
  assert.match(filtered, /scope="row">Details/);
  assert.match(filtered, /scope="row">Status/);
  assert.match(filtered, /^<main>/); assert.match(filtered, /<\/main>$/);
  assert.throws(() => selectHTMLDetailRows(source, 'Missing'), /Row not found: Missing/);
});

test('Create Button Detail Row appends a URL-encoded action row', () => {
  const source = convertJSONToHTMLDetail({ ID: 'server 1/a', Name: 'Alpha' });
  const result = createButtonDetailRow(source, 'Edit', '/systems/${text1}/edit?source=a&mode=full', 'id');
  assert.match(result, /<th scope="row">Edit<\/th>/);
  assert.match(result, /class="phidias-table-button phidias-detail-button"/);
  assert.match(result, /href="\/systems\/server%201%2Fa\/edit\?source=a&amp;mode=full"/);
  assert.throws(() => createButtonDetailRow(source, 'ID', '/edit', 'ID'), /Row already exists/);
  assert.throws(() => createButtonDetailRow(source, 'Edit', 'javascript:alert(1)', 'ID'), /unsafe scheme/);
});

test('Sort HTML Detail Rows orders by header or value', () => {
  const source = convertJSONToHTMLDetail({ Zulu: '2', Alpha: '10', Middle: '1' });
  const byHeader = sortHTMLDetailRows(source, 'Header', 'Ascending');
  assert.ok(byHeader.indexOf('>Alpha<') < byHeader.indexOf('>Middle<'));
  assert.ok(byHeader.indexOf('>Middle<') < byHeader.indexOf('>Zulu<'));
  const byValue = sortHTMLDetailRows(source, 'Value', 'Descending');
  assert.ok(byValue.indexOf('>10<') < byValue.indexOf('>2<'));
  assert.ok(byValue.indexOf('>2<') < byValue.indexOf('>1<'));
});

test('detail blocks connect from JSON text through filtering and a button row to HTML reply', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const text = (id, value) => ({ id, type: 'text', x: 0, y: 0, options: { text: value } });
  const document = { version: 1, name: 'Detail workflow', workspaces: [{ id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/detail' } },
      text('json', '{"ID":"abc 123","Name":"Delphi","Hidden":"remove me"}'),
      { id: 'convert', type: 'convert_json_to_html_detail', x: 0, y: 0, options: {} },
      text('rows', 'ID,Name'),
      { id: 'filter', type: 'select_html_detail_rows', x: 0, y: 0, options: {} },
      text('button-name', 'Edit'), text('url', '/edit/${text1}'), text('argument', 'ID'),
      { id: 'button', type: 'create_button_detail_row', x: 0, y: 0, options: {} },
      { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ], connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'convert', input: 'action', kind: 'action' },
      { id: 'v1', from: 'json', output: 'text', to: 'convert', input: 'json', kind: 'value' },
      { id: 'a2', from: 'convert', output: 'next', to: 'filter', input: 'action', kind: 'action' },
      { id: 'v2', from: 'convert', output: 'html', to: 'filter', input: 'html', kind: 'value' },
      { id: 'v3', from: 'rows', output: 'text', to: 'filter', input: 'rows', kind: 'value' },
      { id: 'a3', from: 'filter', output: 'success', to: 'button', input: 'action', kind: 'action' },
      { id: 'v4', from: 'filter', output: 'html', to: 'button', input: 'html', kind: 'value' },
      { id: 'v5', from: 'button-name', output: 'text', to: 'button', input: 'row_name', kind: 'value' },
      { id: 'v6', from: 'url', output: 'text', to: 'button', input: 'url', kind: 'value' },
      { id: 'v7', from: 'argument', output: 'text', to: 'button', input: 'argument_row', kind: 'value' },
      { id: 'a4', from: 'button', output: 'success', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v8', from: 'button', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ] }] };
  const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/detail`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /scope="row">ID/); assert.match(html, /scope="row">Name/);
  assert.doesNotMatch(html, /Hidden|remove me/);
  assert.match(html, /href="\/edit\/abc%20123"/);
});
