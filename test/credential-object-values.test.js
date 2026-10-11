'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefinition, executeLegacy } = require('../runtime/legacy');

test('Add Property To Object stores the usable secret while retaining run redaction', async () => {
  const definition = normalizeDefinition(require('../blocks/add_property_to_object'), 'add_property_to_object.js');
  const password = 'actual-password';
  const secret = { __phidiasSecret: true, toString: () => password, toJSON: () => '[REDACTED]' };
  const values = new Map();
  const context = {
    render: value => value,
    values,
    vars: Object.create(null),
    legacyValues: [],
    secretValues: new Set()
  };
  const object = {};
  await executeLegacy(definition, context, { id: 'add', options: {} }, {
    object,
    key: 'password',
    value: secret
  }, async () => {});
  assert.equal(object.password, password);
  assert.equal(values.get('add:object').password, password);
  assert.equal(JSON.stringify(object), '{"password":"actual-password"}');
  assert.deepEqual([...context.secretValues], [password]);
});

test('Request API reveals a directly connected secret only for the outbound request', async t => {
  const definition = normalizeDefinition(require('../blocks/request_api'), 'request_api.js');
  const password = 'outbound-password';
  const secret = { __phidiasSecret: true, toString: () => password, toJSON: () => '[REDACTED]' };
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, headers: new Headers(), text: async () => 'ok' };
  };
  t.after(() => { global.fetch = originalFetch; });
  const context = {
    render: value => value,
    values: new Map(),
    vars: Object.create(null),
    legacyValues: [],
    secretValues: new Set(),
    signal: new AbortController().signal
  };

  await executeLegacy(definition, context, {
    id: 'request',
    options: { method_type: 'post', data_type: 'text' }
  }, {
    url: 'https://api.example.test/login',
    body: { password: secret }
  }, async () => {});

  assert.equal(request.options.body, JSON.stringify({ password }));
  assert.deepEqual([...context.secretValues], [password]);
});

test('Check Comparison reveals protected passwords for exact and string comparisons', async () => {
  const definition = normalizeDefinition(require('../blocks/check_comparison'), 'check_comparison.js');
  const password = 'actual-password';
  const secret = { __phidiasSecret: true, toString: () => password, valueOf: () => password, toJSON: () => '[REDACTED]' };
  const run = async (comparisonType, value2) => {
    const followed = [];
    const context = { render: value => value, values: new Map(), vars: Object.create(null), legacyValues: [], secretValues: new Set() };
    await executeLegacy(definition, context, { id: 'compare', options: { comparison_type: comparisonType, value2: '' } }, { value1: secret, value2 }, async output => { followed.push(output); });
    return { followed, secrets: [...context.secretValues] };
  };

  const exact = await run('equals_exactly', password);
  assert.deepEqual(exact.followed, ['action1']);
  assert.deepEqual(exact.secrets, [password]);

  const startsWith = await run('start_with', 'actual');
  assert.deepEqual(startsWith.followed, ['action1']);
  assert.deepEqual(startsWith.secrets, [password]);

  const different = await run('not_equal_exactly', 'different-password');
  assert.deepEqual(different.followed, ['action1']);
  assert.deepEqual(different.secrets, [password]);
});
