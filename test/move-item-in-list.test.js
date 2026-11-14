'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/move_item_in_list');

async function execute(list, position, direction = 'up', amount = 1) {
  const outputs = {};
  const action = await block.execute(
    {},
    { direction, amount },
    { list, position },
    (name, value) => { outputs[name] = value; }
  );
  return { action, list: outputs.list };
}

test('move-item block exposes zero-based position input and direction options', () => {
  assert.equal(block.type, 'move_item_in_list');
  assert.deepEqual(block.inputPorts.map(port => port.id), ['action', 'list', 'position']);
  assert.deepEqual(block.fields.map(field => field.key), ['direction', 'amount']);
  assert.deepEqual(block.fields[0].choices, ['up', 'down']);
  assert.equal(block.fields[1].default, 1);
  assert.deepEqual(block.outputPorts.map(port => port.id), ['action', 'list']);
});

test('moves position 0 down one position', async () => {
  const source = ['vhins', 'enkod', 'rvtjg'];
  const result = await execute(source, 0, 'down', 1);

  assert.equal(result.action, 'action');
  assert.deepEqual(result.list, ['enkod', 'vhins', 'rvtjg']);
  assert.deepEqual(source, ['vhins', 'enkod', 'rvtjg']);
});

test('moving up from position 0 wraps to the last position', async () => {
  const result = await execute(['vhins', 'enkod', 'rvtjg'], 0, 'up', 1);
  assert.deepEqual(result.list, ['enkod', 'rvtjg', 'vhins']);
});

test('moving down from the last position wraps to position 0', async () => {
  const result = await execute(['vhins', 'enkod', 'rvtjg'], 2, 'down', 1);
  assert.deepEqual(result.list, ['rvtjg', 'vhins', 'enkod']);
});

test('large movement amounts wrap around the list', async () => {
  assert.deepEqual(
    (await execute(['a', 'b', 'c'], 1, 'down', 5)).list,
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    (await execute(['a', 'b', 'c'], 1, 'up', 4)).list,
    ['b', 'a', 'c']
  );
});

test('empty lists remain empty and invalid nonempty positions are rejected', async () => {
  assert.deepEqual((await execute([], 0, 'down', 1)).list, []);
  await assert.rejects(() => execute(['a'], 1, 'down', 1), /Position must be a whole number from 0 to 0/);
});

