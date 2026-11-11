'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefinition, executeLegacy } = require('../runtime/legacy');

const definition = normalizeDefinition(
  require('../blocks/remove_item_from_list_by_property_value'),
  'remove_item_from_list_by_property_value.js'
);

async function run(inputs, options = {}) {
  const context = {
    values: new Map(),
    vars: Object.create(null),
    blockIDs: new Set(),
    secretValues: new Set(),
    render: value => value
  };
  const followed = [];
  const outputs = await executeLegacy(
    definition,
    context,
    { id: 'remove', options },
    inputs,
    async output => { followed.push(output); }
  );
  return { followed, outputs };
}

test('remove-by-property block exposes connector and editable inputs', () => {
  assert.equal(definition.type, 'remove_item_from_list_by_property_value');
  assert.deepEqual(definition.inputPorts.map(port => port.id), ['action', 'list', 'property_key', 'values']);
  assert.deepEqual(definition.fields.map(field => field.key), ['property_key', 'values']);
  assert.deepEqual(definition.outputs, ['action']);
  assert.deepEqual(definition.outputPorts.map(port => port.id), ['action', 'list']);
});

test('removes every object matching any comma-separated property value', async () => {
  const source = [
    { id: 'vhins', name: 'First' },
    { id: 'keep', name: 'Keep' },
    { id: 'phans', name: 'Second' },
    { name: 'No ID' },
    { id: 'bhuns', name: 'Third' },
    { id: 'vhins', name: 'Duplicate' },
    null,
    'plain value'
  ];

  const { followed, outputs } = await run({
    list: source,
    property_key: 'id',
    values: ' vhins, phans, bhuns '
  });

  assert.deepEqual(outputs.list, [
    { id: 'keep', name: 'Keep' },
    { name: 'No ID' },
    null,
    'plain value'
  ]);
  assert.deepEqual(followed, ['action']);
  assert.equal(source.length, 8);
});

test('accepts a connected value list and compares number properties by their text value', async () => {
  const { outputs } = await run({
    list: [{ id: 1 }, { id: 2 }, { id: 3 }],
    property_key: 'id',
    values: ['1', 3]
  });

  assert.deepEqual(outputs.list, [{ id: 2 }]);
});

test('supports property key and values entered in the block fields', async () => {
  const { outputs } = await run(
    { list: [{ id: 'remove' }, { id: 'keep' }] },
    { property_key: 'id', values: 'remove' }
  );

  assert.deepEqual(outputs.list, [{ id: 'keep' }]);
});

