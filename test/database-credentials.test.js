'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefinition, executeLegacy } = require('../runtime/legacy');

const context = database => ({
  render: value => value,
  legacyValues: [],
  values: new Map(),
  vars: Object.create(null),
  shared: Object.create(null),
  database
});

test('Database SQL Query uses the application database pool and follows success and error branches', async () => {
  const definition = normalizeDefinition(require('../blocks/database_query'), 'database_query.js');
  const block = { id: 'query', options: { query: 'SELECT 42 AS answer' } };
  const calls = [], branches = [];
  const successful = context(async () => ({ execute: async query => { calls.push(query); return [[{ answer: 42 }], []]; } }));
  await executeLegacy(definition, successful, block, {}, async branch => { branches.push(branch); });
  assert.deepEqual(calls, ['SELECT 42 AS answer']);
  assert.deepEqual(successful.values.get('query:response'), [{ answer: 42 }]);
  assert.deepEqual(branches, ['action']);

  const failedBranches = [], failed = context(async () => ({ execute: async () => { throw new Error('database offline'); } }));
  await executeLegacy(definition, failed, block, {}, async branch => { failedBranches.push(branch); });
  assert.equal(failed.values.get('query:errormsg'), 'database offline');
  assert.deepEqual(failedBranches, ['erroraction']);
});

test('legacy Database SQL File Option remains loadable but hidden and has no credential fields', () => {
  const definition = normalizeDefinition(require('../blocks/database_sql_file_option'), 'database_sql_file_option.js');
  assert.equal(definition.hidden, true);
  assert.equal(definition.trigger, 'startup');
  assert.deepEqual(definition.fields, []);
});
