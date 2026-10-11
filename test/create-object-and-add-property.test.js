'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('wire-only object builders expose the requested number of key/value pairs', () => {
  for (let count = 1; count <= 9; count++) {
    const block = require(`../blocks/create_object_and_add_property_${count}x`);
    assert.equal(block.type, `create_object_and_add_property_${count}x`);
    assert.equal(block.fields.length, 0);
    assert.equal(block.inputPorts.length, 1 + count * 2);
    assert.deepEqual(block.outputs, ['action']);
    assert.deepEqual(block.outputPorts.at(-1).types, ['object']);
    for (let index = 1; index <= count; index++) {
      assert.ok(block.inputPorts.some(port => port.id === `key${index}`));
      assert.ok(block.inputPorts.some(port => port.id === `value${index}`));
    }
  }
});

test('object builders preserve connected value types and skip blank keys', async () => {
  const block = require('../blocks/create_object_and_add_property_5x');
  const outputs = {};
  const action = await block.execute({}, {}, {
    key1: 'enabled', value1: false,
    key2: 'count', value2: 0,
    key3: 'details', value3: { state: 'ready' },
    key4: 'items', value4: [1, 2],
    key5: '  ', value5: 'ignored'
  }, (name, value) => { outputs[name] = value; });
  assert.equal(action, 'action');
  assert.deepEqual(outputs.object, {
    enabled: false,
    count: 0,
    details: { state: 'ready' },
    items: [1, 2]
  });
});

test('later duplicate keys overwrite earlier values without prototype mutation', async () => {
  const block = require('../blocks/create_object_and_add_property_3x');
  const outputs = {};
  await block.execute({}, {}, {
    key1: 'name', value1: 'first',
    key2: 'name', value2: 'last',
    key3: '__proto__', value3: { unsafe: true }
  }, (name, value) => { outputs[name] = value; });
  assert.equal(outputs.object.name, 'last');
  assert.deepEqual(outputs.object.__proto__, { unsafe: true });
  assert.equal({}.unsafe, undefined);
});

test('all object-builder sizes turn protected secret inputs into usable values through the runtime revealer', async () => {
  const protectedPassword = { __phidiasSecret: true, toString: () => 'actual-password', toJSON: () => '[REDACTED]' };
  for (let count = 1; count <= 9; count++) {
    const block = require(`../blocks/create_object_and_add_property_${count}x`);
    const outputs = {}, revealed = [], inputs = {};
    for (let index = 1; index <= count; index++) {
      inputs[`key${index}`] = `password${index}`;
      inputs[`value${index}`] = protectedPassword;
    }
    await block.execute({ revealSecret(value) { revealed.push(value); return String(value); } }, {}, inputs, (name, value) => { outputs[name] = value; });
    assert.equal(revealed.length, count);
    assert.ok(revealed.every(value => value === protectedPassword));
    assert.deepEqual(outputs.object, Object.fromEntries(Array.from({ length: count }, (_, index) => [`password${index + 1}`, 'actual-password'])));
    assert.doesNotMatch(JSON.stringify(outputs.object), /REDACTED/);
  }
});
