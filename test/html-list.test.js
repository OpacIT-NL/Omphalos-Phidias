'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { convertJSONToHTMLList } = require('../blocks/convert_json_to_html_list');
const { loadDefinitions } = require('../runtime/app');
const { validate } = require('../runtime/validate');

test('Convert JSON to HTML List renders glossary-style paragraph cards', () => {
  const html = convertJSONToHTMLList([{
    title: 'Endogenic',
    coiner: 'Community',
    definition: 'First line\nSecond line',
    tags: ['Origin', 'Community'],
    source: 'https://example.com/reference'
  }]);

  assert.match(html, /^<section class="phidias-html-list" data-count="1">/);
  assert.match(html, /class="phidias-html-list__item" data-index="0" data-title="Endogenic"/);
  assert.match(html, /class="phidias-html-list__title[^>]*><strong>Endogenic<\/strong><\/p>/);
  assert.match(html, /class="phidias-html-list__field phidias-html-list__meta[^>]*>.*Coined by:.*Community/s);
  assert.match(html, /class="phidias-html-list__body[^>]*>First line<br>Second line<\/p>/);
  assert.match(html, /class="phidias-html-list__tag">Origin<\/span>/);
  assert.match(html, /class="phidias-html-list__tag">Community<\/span>/);
  assert.match(html, /href="https:\/\/example\.com\/reference" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /data-tags="Origin Community"/);
  assert.match(html, /data-search="Endogenic Community First line&#10;Second line Origin Community https:\/\/example\.com\/reference"/);
});

test('Convert JSON to HTML List escapes supplied content and refuses executable links', () => {
  const html = convertJSONToHTMLList({
    name: '<img src=x onerror=alert(1)>',
    description: '<script>alert(1)</script>',
    source: 'javascript:alert(1)',
    custom_field: 'A & B'
  });

  assert.doesNotMatch(html, /<script|<img/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-field="custom_field"/);
  assert.match(html, /Custom field:/);
  assert.match(html, /A &amp; B/);
});

test('Convert JSON to HTML List accepts JSON text, primitives inside lists, and empty lists', () => {
  assert.match(convertJSONToHTMLList('["Alpha",2,true]'), /data-count="3"/);
  assert.match(convertJSONToHTMLList('["Alpha",2,true]'), /data-field="Value"/);
  assert.equal(convertJSONToHTMLList([]), '<section class="phidias-html-list" data-count="0"></section>');
  assert.throws(() => convertJSONToHTMLList('not json'), /requires valid JSON text/);
  assert.throws(() => convertJSONToHTMLList(12), /requires JSON text, an object, or a list/);
  const circular = {}; circular.self = circular;
  assert.throws(() => convertJSONToHTMLList(circular), /circular objects/);
});

test('Convert JSON to HTML List exposes current runtime ports', () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const definition = definitions.get('convert_json_to_html_list');
  assert.ok(definition);
  assert.deepEqual(definition.inputPorts.map(port => port.id), ['action', 'json']);
  assert.deepEqual(definition.outputPorts.map(port => port.id), ['next', 'html']);
  assert.ok(definition.inputPorts.find(port => port.id === 'json').types.includes('list'));
  assert.doesNotThrow(() => validate({ version: 1, name: 'HTML list conversion', workspaces: [{
    id: 'main', name: 'Main', active: false,
    blocks: [
      { id: 'list', type: 'create_list', x: 0, y: 0, options: {} },
      { id: 'convert', type: 'convert_json_to_html_list', x: 0, y: 0, options: {} }
    ],
    connections: [{ id: 'list-json', from: 'list', output: 'list', to: 'convert', input: 'json', kind: 'value' }]
  }] }, definitions));
});
