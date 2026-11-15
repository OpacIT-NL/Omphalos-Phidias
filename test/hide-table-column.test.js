'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convertJSONToHTMLTable } = require('../blocks/convert_json_to_html_table');
const { hideTableColumn } = require('../blocks/hide_table_column');
const { createButtonColumn } = require('../blocks/create_button_column');
const { enableSearchAndSortingForTable } = require('../blocks/enable_search_and_sorting_for_table');

test('Hide Table Column hides matching headers and cells without removing their values', () => {
  const source = convertJSONToHTMLTable([
    { ID: 'vhins', Name: 'Vhins' },
    { ID: 'phans', Name: 'Phans' }
  ]);
  const result = hideTableColumn(source, 'id');

  assert.match(result, /data-phidias-hidden-table-column/);
  assert.equal((result.match(/phidias-table-hidden-column/g) || []).length, 4);
  assert.match(result, /<th[^>]*hidden[^>]*>ID<\/th>/);
  assert.match(result, /<td[^>]*hidden[^>]*>vhins<\/td>/);
  assert.match(result, /<td[^>]*hidden[^>]*>phans<\/td>/);
  assert.match(result, /<th>Name<\/th>/);
  assert.match(result, /<td>Vhins<\/td>/);
});

test('Create Button Column can use values from an already hidden column', () => {
  const source = convertJSONToHTMLTable([{ ID: 'abc 123', Name: 'Alpha' }]);
  const hidden = hideTableColumn(source, 'ID');
  const result = createButtonColumn(hidden, 'Edit', '/edit/${text1}', 'ID');

  assert.match(result, /href="\/edit\/abc%20123"/);
  assert.match(result, />abc 123<\/td>/);
  assert.match(result, /phidias-table-hidden-column/);
});

test('Hide Table Column works after search and sorting enhancement', () => {
  const source = convertJSONToHTMLTable([{ ID: 'one', Name: 'Alpha' }]);
  const enhanced = enableSearchAndSortingForTable(source);
  const result = hideTableColumn(enhanced, 'ID');

  assert.match(result, /<th[^>]*data-phidias-header="ID"[^>]*phidias-table-hidden-column|<th[^>]*phidias-table-hidden-column[^>]*data-phidias-header="ID"/);
  assert.match(result, />one<\/td>/);
});

test('search and sorting skips columns that were hidden first', () => {
  const source = convertJSONToHTMLTable([{ ID: 'one', Name: 'Alpha' }]);
  const enhanced = enableSearchAndSortingForTable(hideTableColumn(source, 'ID'));

  assert.doesNotMatch(enhanced, /Search ID/);
  assert.match(enhanced, /Search Name/);
  assert.match(enhanced, />one<\/td>/);
});

test('Hide Table Column reports missing columns through its error branch', async () => {
  const block = require('../blocks/hide_table_column');
  const outputs = {};
  const action = await block.execute({}, {}, {
    html: '<table><tr><th>Name</th></tr><tr><td>Alpha</td></tr></table>',
    column: 'ID'
  }, (name, value) => { outputs[name] = value; });

  assert.equal(action, 'error');
  assert.equal(outputs.html, '');
  assert.match(outputs.error_message, /Column not found: ID/);
});

