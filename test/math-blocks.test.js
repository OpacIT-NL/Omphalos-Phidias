'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { calculate, percentage, round, aggregateNumbers, transformJSON } = require('../blocks/math_helpers.cjs');

test('Math Operation supports arithmetic, extrema, powers, and rounding', () => {
  assert.equal(calculate(8, 3, 'Add'), 11); assert.equal(calculate(8, 3, 'Subtract'), 5);
  assert.equal(calculate(8, 3, 'Multiply'), 24); assert.equal(calculate(8, 4, 'Divide'), 2);
  assert.equal(calculate(8, 3, 'Modulo'), 2); assert.equal(calculate(2, 4, 'Power'), 16);
  assert.equal(calculate(8, 3, 'Minimum'), 3); assert.equal(calculate(8, 3, 'Maximum'), 8);
  assert.equal(round(1.23456, 'Decimal Places', 2), 1.23); assert.equal(round(1234.56, 'Significant Digits', 3), 1230);
  assert.equal(round(-1.8, 'Floor', 2), -2); assert.equal(round(-1.8, 'Ceiling', 2), -1); assert.equal(round(-1.8, 'Truncate', 2), -1);
  assert.throws(() => calculate(1, 0, 'Divide'), /divide by zero/); assert.throws(() => calculate('abc', 2, 'Add'), /Number A/);
});

test('Percentage Calculator covers ratios, percentage amounts, changes, and adjustments', () => {
  assert.equal(percentage(25, 200, 'Value as Percentage of Reference'), 12.5);
  assert.equal(percentage(15, 200, 'Percentage of Reference'), 30);
  assert.ok(Math.abs(percentage(10, 200, 'Increase Reference by Percentage') - 220) < 1e-10);
  assert.equal(percentage(10, 200, 'Decrease Reference by Percentage'), 180);
  assert.equal(percentage(120, 100, 'Percentage Change'), 20);
  assert.equal(percentage(72, 65, 'Percentage Point Difference'), 7);
  assert.throws(() => percentage(1, 0, 'Percentage Change'), /cannot be zero/);
});

test('Aggregate Numbers reads lists, nested JSON, and row field paths', () => {
  const result = aggregateNumbers([1, 2, 3, 4], { field_path: '', invalid_values: 'Ignore', variance_type: 'Population', rounding: 'None' });
  assert.deepEqual(result, { count: 4, sum: 10, average: 2.5, minimum: 1, maximum: 4, median: 2.5, range: 3, variance: 1.25, standard_deviation: Math.sqrt(1.25) });
  const rows = aggregateNumbers('[{"metrics":{"load":10}},{"metrics":{"load":20}},{"metrics":{"load":30}}]', { field_path: 'metrics.load', invalid_values: 'Error', variance_type: 'Sample', rounding: 'Decimal Places', decimal_places: 2 });
  assert.equal(rows.average, 20); assert.equal(rows.median, 20); assert.equal(rows.variance, 100); assert.equal(rows.standard_deviation, 10);
  assert.equal(aggregateNumbers({ Online: 8, Warning: 2 }, { invalid_values: 'Ignore', variance_type: 'Population', rounding: 'None' }).sum, 10);
  assert.throws(() => aggregateNumbers([{ value: 'bad' }], { field_path: 'value', invalid_values: 'Error' }), /must be a finite number/);
});

test('Transform JSON Numbers adds and replaces graph fields using constants, fields, and connected values', () => {
  const base = { operation: 'Value as Percentage of Operand', operand_source: 'Field', operand_field: 'Total', output_mode: 'Add Result Field', result_field: 'Percent', invalid_values: 'Error', rounding: 'Decimal Places', decimal_places: 1 };
  const rows = transformJSON([{ Name: 'A', Used: 25, Total: 200 }, { Name: 'B', Used: 30, Total: 120 }], undefined, { ...base, source_field: 'Used' });
  assert.deepEqual(rows, [{ Name: 'A', Used: 25, Total: 200, Percent: 12.5 }, { Name: 'B', Used: 30, Total: 120, Percent: 25 }]);
  const replaced = transformJSON([{ Value: 4 }, { Value: 6 }], 3, { ...base, source_field: 'Value', operation: 'Multiply', operand_source: 'Connected Value', output_mode: 'Replace Source Field', rounding: 'None' });
  assert.deepEqual(replaced, [{ Value: 12 }, { Value: 18 }]);
  const keyed = transformJSON({ Alpha: 2, Beta: 5 }, undefined, { ...base, source_field: '', operation: 'Multiply', operand_source: 'Constant', constant: '10', output_mode: 'Values Only', rounding: 'None' });
  assert.deepEqual(keyed, { Alpha: 20, Beta: 50 });
  const skipped = transformJSON([{ Value: 2 }, { Value: 'bad' }], undefined, { ...base, source_field: 'Value', operation: 'Multiply', operand_source: 'Constant', constant: 2, invalid_values: 'Skip Row', rounding: 'None' });
  assert.deepEqual(skipped, [{ Value: 2, Percent: 4 }]);
  assert.throws(() => transformJSON([{ Value: 2 }], undefined, { ...base, source_field: '__proto__.value' }), /prototype properties/);
});

test('math blocks expose typed ports and transformed JSON connects directly to a graph', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app'); const { validate } = require('../runtime/validate');
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  for (const type of ['math_operation', 'percentage_calculator', 'aggregate_numbers', 'transform_json_numbers']) assert.equal(definitions.get(type).category, 'Math');
  const transformed = definitions.get('transform_json_numbers').outputPorts.find(port => port.id === 'result');
  assert.ok(transformed.types.includes('object')); assert.ok(transformed.types.includes('list'));
  const chartOptions = Object.fromEntries(definitions.get('json_to_cartesian_chart').fields.map(field => [field.key, field.default]));
  Object.assign(chartOptions, { chart_type: 'Bar', data_format: 'Rows', category_field: 'Month', series_fields: 'Percent' });
  const transformOptions = Object.fromEntries(definitions.get('transform_json_numbers').fields.map(field => [field.key, field.default]));
  Object.assign(transformOptions, { source_field: 'Used', operation: 'Value as Percentage of Operand', operand_source: 'Field', operand_field: 'Total', result_field: 'Percent', rounding: 'Decimal Places', decimal_places: 1 });
  const document = { version: 1, name: 'Math graph', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/math-chart' } },
    { id: 'json', type: 'text', x: 0, y: 0, options: { text: '[{"Month":"Jan","Used":25,"Total":100},{"Month":"Feb","Used":75,"Total":100}]' } },
    { id: 'math', type: 'transform_json_numbers', x: 0, y: 0, options: transformOptions },
    { id: 'chart', type: 'json_to_cartesian_chart', x: 0, y: 0, options: chartOptions },
    { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
  ], connections: [
    { id: 'a1', from: 'http', output: 'next', to: 'math', input: 'action', kind: 'action' },
    { id: 'v1', from: 'json', output: 'text', to: 'math', input: 'json', kind: 'value' },
    { id: 'a2', from: 'math', output: 'success', to: 'chart', input: 'action', kind: 'action' },
    { id: 'v2', from: 'math', output: 'result', to: 'chart', input: 'json', kind: 'value' },
    { id: 'a3', from: 'chart', output: 'success', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v3', from: 'chart', output: 'html', to: 'reply', input: 'body', kind: 'value' }
  ] }] };
  assert.doesNotThrow(() => validate(structuredClone(document), definitions));
  const app = createApp({ document, definitions }); const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/math-chart`), html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /phidias-chart/); assert.match(html, /Percent/);
});
