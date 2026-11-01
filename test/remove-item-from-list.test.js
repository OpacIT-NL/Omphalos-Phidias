'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const block = require('../blocks/remove_item_from_list');

function execute(list, positionType, customPosition) {
  let output;
  let nextOutput;

  block.code.call({
    GetInputValue(id) {
      if (id === 'list') return list;
      if (id === 'custom_position') return customPosition;
      return undefined;
    },
    GetOptionValue() {
      return positionType;
    },
    StoreOutputValue(value, id) {
      if (id === 'list') output = value;
    },
    RunNextBlock(id) {
      nextOutput = id;
    }
  }, {});

  return { output, nextOutput };
}

test('offers first, last, and custom position choices', () => {
  assert.deepEqual(Object.keys(block.options[0].options), ['first', 'last', 'custom']);
  assert.match(block.inputs.find(input => input.id === 'custom_position').description, /position 0/);
});

test('removes the first or last item', () => {
  assert.deepEqual(execute(['a', 'b', 'c'], 'first').output, ['b', 'c']);
  assert.deepEqual(execute(['a', 'b', 'c'], 'last').output, ['a', 'b']);
});

test('uses zero-based custom positions', () => {
  assert.deepEqual(execute(['a', 'b', 'c'], 'custom', 0).output, ['b', 'c']);
  assert.deepEqual(execute(['a', 'b', 'c'], 'custom', 1).output, ['a', 'c']);
  assert.deepEqual(execute(['a', 'b', 'c'], 'custom', 2).output, ['a', 'b']);
});

test('leaves the list unchanged for an invalid custom position', () => {
  for (const position of [-1, 3, 1.5, undefined, 'invalid']) {
    assert.deepEqual(execute(['a', 'b', 'c'], 'custom', position).output, ['a', 'b', 'c']);
  }
});

test('handles an empty list and continues through the action output', () => {
  const result = execute([], 'first');
  assert.deepEqual(result.output, []);
  assert.equal(result.nextOutput, 'action');
});
