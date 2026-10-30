'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const wire = require('../public/wire-colors');

test('workflow wire palette matches supported data types', () => {
  assert.deepEqual(wire.colors, {
    object: '#3b82f6', html: '#22d3ee', list: '#eab308', number: '#f97316', text: '#a855f7',
    action: '#23a559', 'encrypted-data': '#ef4444', undefined: '#8b949e'
  });
  assert.equal(wire.typeForPort({ kind: 'value', id: 'html1', name: 'HTML 1', types: ['text'] }), 'html');
  assert.equal(wire.typeForPort({ kind: 'value', id: 'encrypted_data', name: 'Encrypted Data', types: ['text'] }), 'encrypted-data');
  assert.equal(wire.typeForPort({ kind: 'value', id: 'items', name: 'Items', types: ['list'] }), 'list');
  assert.equal(wire.typeForPort({ kind: 'action', id: 'next', types: [] }), 'action');
});

test('workflow wires use the concrete endpoint when the other endpoint is undefined', () => {
  for (const type of ['object', 'html', 'list', 'number', 'text', 'encrypted-data']) {
    assert.equal(wire.typeForConnection('value', type, 'undefined'), type);
    assert.equal(wire.typeForConnection('value', 'undefined', type), type);
  }
  assert.equal(wire.typeForConnection('value', 'undefined', 'undefined'), 'undefined');
  assert.equal(wire.typeForConnection('value', 'number', 'text'), 'number');
  assert.equal(wire.typeForConnection('action', 'undefined', 'undefined'), 'action');
});
