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
