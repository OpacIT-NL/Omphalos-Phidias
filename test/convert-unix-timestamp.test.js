'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/convert_unix_timestamp');

test('Convert Unix Timestamp formats seconds and milliseconds as UTC', () => {
  assert.equal(block.formatUnixTimestamp(1791503292, 'Seconds', 'UTC'), '2026-10-08 23:48:12');
  assert.equal(block.formatUnixTimestamp('1791503292759', 'Milliseconds', 'UTC'), '2026-10-08 23:48:12');
  assert.equal(block.formatUnixTimestamp(1791503292759, 'Auto detect', 'UTC'), '2026-10-08 23:48:12');
  assert.equal(block.formatUnixTimestamp(0, 'Seconds', 'UTC'), '1970-01-01 00:00:00');
});

test('Convert Unix Timestamp exposes typed ports and reports invalid input', async () => {
  assert.ok(block.inputPorts.find(port => port.id === 'timestamp').types.includes('number'));
  assert.equal(block.outputPorts.find(port => port.id === 'readable_time').types[0], 'text');
  const outputs = {};
  const action = await block.execute({}, { unit: 'Seconds', time_zone: 'UTC' }, { timestamp: 'not-a-timestamp' }, (id, value) => { outputs[id] = value; });
  assert.equal(action, 'error');
  assert.equal(outputs.readable_time, '');
  assert.match(outputs.error_message, /finite number/);
});
