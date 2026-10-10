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
  database,
  logDatabase: database
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

test('Send Query to Log Database uses only the logging database pool', async () => {
  const block = require('../blocks/send_query_to_log_database');
  const calls = [], outputs = {};
  const branch = await block.execute({
    database: async () => { throw new Error('application database must not be used'); },
    logDatabase: async () => ({ execute: async query => { calls.push(query); return [[{ inserted: 1 }], []]; } }),
    signal: new AbortController().signal
  }, {}, { query: 'INSERT INTO traces VALUES (1)' }, (name, value) => { outputs[name] = value; });
  assert.equal(branch, 'action');
  assert.deepEqual(calls, ['INSERT INTO traces VALUES (1)']);
  assert.deepEqual(outputs.response, [{ inserted: 1 }]);
  assert.equal(outputs.errormsg, '');

  const failed = {};
  const failedBranch = await block.execute({
    logDatabase: async () => ({ execute: async () => { throw new Error('logging database offline'); } }),
    signal: new AbortController().signal
  }, {}, { query: 'SELECT 1' }, (name, value) => { failed[name] = value; });
  assert.equal(failedBranch, 'erroraction');
  assert.equal(failed.errormsg, 'logging database offline');
});

test('Database SQL Bulk Query accepts lists and text, preserves order, and reports partial failures', async () => {
  const block = require('../blocks/database_bulk_query');
  assert.deepEqual(block.parseQueries(['SELECT 1', { query: 'SELECT 2' }]), ['SELECT 1', 'SELECT 2']);
  assert.deepEqual(block.parseQueries('["SELECT 3", "SELECT 4"]'), ['SELECT 3', 'SELECT 4']);
  assert.deepEqual(block.parseQueries('SELECT 5\nSELECT 6'), ['SELECT 5', 'SELECT 6']);
  assert.deepEqual(block.parseQueries('SELECT\n  7\n---\nSELECT\n  8'), ['SELECT\n  7', 'SELECT\n  8']);

  const calls = [], outputs = {}, released = [];
  const connection = {
    async execute(query) { calls.push(query); return [[{ query }], []]; },
    release() { released.push(true); }
  };
  const branch = await block.execute({ database: async () => ({ getConnection: async () => connection }), signal: new AbortController().signal }, {}, { queries: ['SELECT 1', 'SELECT 2'] }, (name, value) => { outputs[name] = value; });
  assert.equal(branch, 'success');
  assert.deepEqual(calls, ['SELECT 1', 'SELECT 2']);
  assert.deepEqual(outputs.responses, [[{ query: 'SELECT 1' }], [{ query: 'SELECT 2' }]]);
  assert.equal(outputs.completed_count, 2); assert.equal(outputs.total_count, 2);
  assert.equal(outputs.failed_query_number, 0); assert.equal(outputs.error_message, '');
  assert.equal(released.length, 1);

  const failedOutputs = {}, failedCalls = [];
  const failedBranch = await block.execute({
    database: async () => ({
      async execute(query) { failedCalls.push(query); if (query === 'BROKEN') throw new Error('syntax error'); return [[{ ok: true }], []]; }
    }),
    signal: new AbortController().signal
  }, {}, { queries: ['SELECT 1', 'BROKEN', 'SELECT 3'] }, (name, value) => { failedOutputs[name] = value; });
  assert.equal(failedBranch, 'error');
  assert.deepEqual(failedCalls, ['SELECT 1', 'BROKEN']);
  assert.deepEqual(failedOutputs.responses, [[{ ok: true }]]);
  assert.equal(failedOutputs.completed_count, 1); assert.equal(failedOutputs.total_count, 3);
  assert.equal(failedOutputs.failed_query_number, 2); assert.equal(failedOutputs.failed_query, 'BROKEN');
  assert.equal(failedOutputs.error_message, 'Query 2 failed: syntax error');
});

test('legacy Database SQL File Option remains loadable but hidden and has no credential fields', () => {
  const definition = normalizeDefinition(require('../blocks/database_sql_file_option'), 'database_sql_file_option.js');
  assert.equal(definition.hidden, true);
  assert.equal(definition.trigger, 'startup');
  assert.deepEqual(definition.fields, []);
});

test('credential lookup and info blocks preserve typed values while wrapping secret outputs', async () => {
  const credential = Object.assign({ type: 'ssh', name: 'Linux Primary', host: 'server', port: 22, username: 'svc', password: 'secret', privateKey: '', permissions: 'ops', extra: {} }, { __phidiasCredential: true });
  const lookup = require('../blocks/get_linux_server_credentials_by_name'), lookupOutputs = {};
  assert.equal(await lookup.execute({ getCredential(name, type) { assert.equal(name, 'Linux Primary'); assert.equal(type, 'ssh'); return credential; } }, {}, { name: 'Linux Primary' }, (id, value) => { lookupOutputs[id] = value; }), 'action');
  assert.equal(lookupOutputs.credential, credential);
  const info = require('../blocks/get_credential_info'), outputs = {};
  assert.equal(await info.execute({ secret(value) { return { __phidiasSecret: true, toString: () => value }; } }, {}, { credential }, (id, value) => { outputs[id] = value; }), 'action');
  assert.equal(outputs.host, 'server'); assert.equal(outputs.username, 'svc'); assert.equal(String(outputs.password), 'secret'); assert.equal(outputs.password.__phidiasSecret, true);
  const ssh = require('../blocks/send_ssh_command');
  assert.deepEqual(ssh.inputs.map(port => port.id), ['action', 'credential', 'textcommand']);
  assert.equal(ssh.inputPorts.find(port => port.id === 'password').hidden, true);
});
