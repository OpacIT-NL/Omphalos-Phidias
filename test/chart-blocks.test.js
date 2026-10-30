'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { cartesianChart, circularChart, normalize } = require('../blocks/chart_helpers.cjs');

const cartesianOptions = {
  chart_type: 'Line', data_format: 'Auto', category_field: '', series_fields: '', series_name: 'Value', aggregate: 'None', sort: 'None',
  max_points: 100, missing_values: 'Gap', minimum: '', maximum: '', number_format: 'Auto', title: '', x_axis_title: '', y_axis_title: '',
  width: 760, height: 360, palette: '#69b7e6,#55c596,#e8ad60', theme: 'Dark', show_legend: 'Yes', show_grid: 'Yes', show_values: 'No', line_style: 'Smooth'
};

test('chart data normalization accepts rows, labels/datasets, key-value objects, and JSON text', () => {
  const rows = normalize([{ Month: 'Jan', Sales: 4 }, { Month: 'Jan', Sales: 6 }, { Month: 'Feb', Sales: 3 }], { data_format: 'Rows', category_field: 'Month', series_fields: 'Sales', aggregate: 'Sum', sort: 'None', max_points: 100 });
  assert.deepEqual(rows.labels, ['Jan', 'Feb']);
  assert.deepEqual(rows.datasets[0].values, [10, 3]);
  const datasets = normalize({ labels: ['A', 'B'], datasets: [{ label: 'Load', data: [12, 18], color: '#ff0000' }] }, { data_format: 'Auto', sort: 'None', max_points: 100 });
  assert.deepEqual(datasets.datasets[0].values, [12, 18]); assert.equal(datasets.datasets[0].color, '#ff0000');
  const points = normalize({ labels: ['A', 'B'], datasets: [{ label: 'XY', data: [{ x: 10, y: 2 }, { x: 30, y: 8 }] }] }, { data_format: 'Auto', sort: 'None', max_points: 100 });
  assert.deepEqual(points.datasets[0].values, [2, 8]); assert.equal(points.datasets[0].points[1].x, 30);
  const rowPoints = normalize([{ Time: 10, Load: 2 }, { Time: 30, Load: 8 }], { chart_type: 'Scatter', data_format: 'Rows', category_field: 'Time', series_fields: 'Load', aggregate: 'None', sort: 'None', max_points: 100 });
  assert.deepEqual(rowPoints.datasets[0].points.map(point => point.x), [10, 30]);
  const keyed = normalize('{"Online":8,"Offline":2}', { data_format: 'Auto', sort: 'Value Descending', max_points: 100 });
  assert.deepEqual(keyed.labels, ['Online', 'Offline']); assert.deepEqual(keyed.datasets[0].values, [8, 2]);
});

test('Cartesian chart renders every graph type with escaped, responsive SVG output', () => {
  const data = [{ period: '<Jan>', sales: 12, cost: 7 }, { period: 'Feb', sales: 18, cost: 9 }, { period: 'Mar', sales: null, cost: 11 }];
  for (const chart_type of ['Line', 'Area', 'Bar', 'Stacked Bar', 'Horizontal Bar', 'Scatter']) {
    const html = cartesianChart(data, { ...cartesianOptions, chart_type, data_format: 'Rows', category_field: 'period', series_fields: 'sales,cost', title: '<Operations>' });
    assert.match(html, /^<style>/); assert.match(html, /<figure class="phidias-chart"/); assert.match(html, /<svg viewBox=/); assert.match(html, /&lt;Operations&gt;/);
    assert.doesNotMatch(html, /<Operations>|<Jan>/);
  }
});

test('Cartesian chart handles missing values, sorting, limits, bounds, and invalid mappings', () => {
  const limited = normalize([{ x: 'C', y: 3 }, { x: 'A', y: 1 }, { x: 'B', y: 2 }], { data_format: 'Rows', category_field: 'x', series_fields: 'y', sort: 'Value Descending', max_points: 2 });
  assert.deepEqual(limited.labels, ['C', 'B']);
  assert.match(cartesianChart([{ x: 'A', y: null }, { x: 'B', y: 2 }], { ...cartesianOptions, data_format: 'Rows', category_field: 'x', series_fields: 'y', missing_values: 'Zero', minimum: '-1', maximum: '3' }), /<svg/);
  const boundedScatter = cartesianChart([{ x: 25, y: 30 }, { x: 75, y: 70 }], { ...cartesianOptions, chart_type: 'Scatter', data_format: 'Rows', category_field: 'x', series_fields: 'y', x_min: 0, x_max: 100, y_min: 0, y_max: 100 });
  assert.match(boundedScatter, />0<\/text>/); assert.match(boundedScatter, />100<\/text>/); assert.match(boundedScatter, /overflow="hidden"/);
  assert.throws(() => normalize([{ Name: 'A', Value: 1 }], { data_format: 'Rows', category_field: 'Missing', series_fields: 'Value', max_points: 100 }), /Category field not found/);
  assert.throws(() => cartesianChart([{ x: 'A', y: 2 }], { ...cartesianOptions, data_format: 'Rows', category_field: 'x', series_fields: 'y', minimum: '10', maximum: '1' }), /minimum must be lower/);
  assert.throws(() => cartesianChart([{ x: 1, y: 2 }], { ...cartesianOptions, chart_type: 'Scatter', data_format: 'Rows', category_field: 'x', series_fields: 'y', x_min: 10, x_max: 1 }), /X minimum must be lower/);
});

test('Circular chart renders pie and donut data, grouping small slices', () => {
  const options = { data_format: 'Key-value Object', sort: 'Value Descending', max_slices: 20, group_below_percent: 10, other_label: 'Other systems', number_format: 'Integer', title: 'Health', center_label: 'Systems', width: 520, height: 380, palette: '#55c596,#e8ad60,#dd6b72', theme: 'Light', show_legend: 'Yes', show_labels: 'Yes', show_values: 'Yes', inner_radius: 58 };
  const donut = circularChart({ Online: 90, Warning: 5, Offline: 3, Unknown: 2 }, { ...options, chart_type: 'Donut' });
  assert.match(donut, /Other systems/); assert.match(donut, />Systems</); assert.match(donut, /<path/);
  const pie = circularChart({ Online: 8, Offline: 2 }, { ...options, chart_type: 'Pie', group_below_percent: 0 });
  assert.match(pie, /aria-label="Health"/); assert.doesNotMatch(pie, />Systems</);
  assert.match(circularChart({ Only: 1 }, { ...options, chart_type: 'Donut', group_below_percent: 0 }), /<path/);
  assert.throws(() => circularChart({ Broken: -1 }, { ...options, chart_type: 'Donut' }), /non-negative number/);
});

test('chart blocks accept JSON list ports and feed HTML replies in a workflow', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const { validate } = require('../runtime/validate');
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  for (const type of ['json_to_cartesian_chart', 'json_to_circular_chart']) {
    const definition = definitions.get(type);
    assert.ok(definition.inputPorts.find(port => port.id === 'json').types.includes('list'));
    assert.ok(definition.fields.length >= 20);
  }
  const cartesian = definitions.get('json_to_cartesian_chart');
  for (const id of ['x_min', 'x_max', 'y_min', 'y_max']) assert.deepEqual(cartesian.inputPorts.find(port => port.id === id).types, ['number']);
  const document = { version: 1, name: 'Chart workflow', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/chart' } },
    { id: 'json', type: 'text', x: 0, y: 0, options: { text: '[{"Month":"Jan","Sales":12},{"Month":"Feb","Sales":18}]' } },
    { id: 'chart', type: 'json_to_cartesian_chart', x: 0, y: 0, options: { ...cartesianOptions, data_format: 'Rows', category_field: 'Month', series_fields: 'Sales' } },
    { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
  ], connections: [
    { id: 'a1', from: 'http', output: 'next', to: 'chart', input: 'action', kind: 'action' },
    { id: 'v1', from: 'json', output: 'text', to: 'chart', input: 'json', kind: 'value' },
    { id: 'a2', from: 'chart', output: 'success', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v2', from: 'chart', output: 'html', to: 'reply', input: 'body', kind: 'value' }
  ] }] };
  assert.doesNotThrow(() => validate(structuredClone(document), definitions));
  const app = createApp({ document, definitions }); const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/chart`), html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /phidias-chart/); assert.match(html, /Sales/);
});
