'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefinition, executeLegacy } = require('../runtime/legacy');

async function runLegacyGetter(modulePath, options, object) {
  const getter = normalizeDefinition(require(modulePath), `${modulePath.split('/').at(-1)}.js`);
  const context = {
    values: new Map(),
    vars: Object.create(null),
    blockIDs: new Set(),
    secretValues: new Set(),
    render: value => value
  };
  const followed = [];
  const values = await executeLegacy(getter, context, { id: 'getter', options }, { object }, async output => { followed.push(output); });
  return { getter, context, followed, values };
}

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

test('every multi-property getter publishes null in Object mode', async () => {
  for (const count of [3, 6, 9]) {
    const options = { option: '1' }, object = {};
    for (let index = 1; index <= count; index++) {
      options[`key${index}`] = `nullable${index}`;
      object[`nullable${index}`] = null;
    }
    const { getter, context, followed, values } = await runLegacyGetter(`../blocks/get_property_from_object_x${count}`, options, object);

    for (let index = 1; index <= count; index++) {
      assert.equal(Object.hasOwn(values, `value${index}`), true);
      assert.equal(values[`value${index}`], null);
      assert.equal(context.values.has(`getter:value${index}`), true);
      assert.ok(getter.outputPorts.find(port => port.id === `value${index}`).types.includes('null'));
    }
    assert.deepEqual(followed, ['action']);
  }
});

test('every multi-property getter converts null to text in Raw Value mode', async () => {
  for (const count of [3, 6, 9]) {
    const options = { option: '2' }, object = {};
    for (let index = 1; index <= count; index++) {
      options[`key${index}`] = `nullable${index}`;
      object[`nullable${index}`] = null;
    }
    const { values } = await runLegacyGetter(`../blocks/get_property_from_object_x${count}`, options, object);
    for (let index = 1; index <= count; index++) assert.equal(values[`value${index}`], 'null');
  }
});

test('every multi-property getter publishes null for missing or undefined properties', async () => {
  for (const count of [3, 6, 9]) {
    for (const option of ['1', '2']) {
      const options = { option }, object = { explicitlyUndefined: undefined };
      for (let index = 1; index <= count; index++) options[`key${index}`] = index === 1 ? 'explicitlyUndefined' : `missing${index}`;
      const { context, values } = await runLegacyGetter(`../blocks/get_property_from_object_x${count}`, options, object);

      for (let index = 1; index <= count; index++) {
        const expected = option === '2' ? 'null' : null;
        assert.equal(Object.hasOwn(values, `value${index}`), true);
        assert.equal(values[`value${index}`], expected);
        assert.equal(context.values.has(`getter:value${index}`), true);
      }
    }
  }
});

test('single-property getter publishes null', async () => {
  const { getter, context, values } = await runLegacyGetter('../blocks/get_property_from_object_option', { key: 'nullable' }, { nullable: null });
  assert.equal(Object.hasOwn(values, 'value'), true);
  assert.equal(values.value, null);
  assert.equal(context.values.has('getter:value'), true);
  assert.ok(getter.outputPorts.find(port => port.id === 'value').types.includes('null'));
});

test('single-property getter normalizes missing and undefined properties to null', async () => {
  for (const object of [{}, { missing: undefined }]) {
    const { context, values } = await runLegacyGetter('../blocks/get_property_from_object_option', { key: 'missing' }, object);
    assert.equal(Object.hasOwn(values, 'value'), true);
    assert.equal(values.value, null);
    assert.equal(context.values.has('getter:value'), true);
  }
});

test('Get Property From Object x3 passes null into Create Object and Add Property x3', async () => {
  const { context, followed, values } = await runLegacyGetter('../blocks/get_property_from_object_x3', {
    option: '1', key1: 'nullable', key2: 'name', key3: 'count'
  }, { nullable: null, name: 'D6 System', count: 0 });

  assert.equal(Object.hasOwn(values, 'value1'), true);
  assert.equal(values.value1, null);
  assert.equal(context.values.has('getter:value1'), true);
  assert.deepEqual(followed, ['action']);

  const creator = require('../blocks/create_object_and_add_property_3x');
  const outputs = {};
  await creator.execute({}, {}, {
    key1: 'nullable', value1: values.value1,
    key2: 'name', value2: values.value2,
    key3: 'count', value3: values.value3
  }, (name, value) => { outputs[name] = value; });

  assert.deepEqual(outputs.object, { nullable: null, name: 'D6 System', count: 0 });
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
