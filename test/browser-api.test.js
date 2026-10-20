'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const requestBlock = require('../blocks/browser_api_request');
const { createApp, loadDefinitions } = require('../runtime/app');
const { validate } = require('../runtime/validate');

test('Browser API Request outputs safe browser code and refuses protected credentials', async () => {
  const outputs = {};
  const branch = await requestBlock.execute({}, {
    method: 'POST', body_format: 'JSON', credentials: 'Omit', timeout_seconds: 15
  }, {
    request_id: 'supplier_lookup',
    url: 'https://supplier.example/v1/search?q=systems',
    headers: { 'x-public-client': 'plural-page' },
    body: { query: '</script><script>alert(1)</script>' }
  }, (name, value) => { outputs[name] = value; });

  assert.equal(branch, 'next');
  assert.match(outputs.html, /\/_phidias\/browser-api\/supplier_lookup/);
  assert.match(outputs.html, /https:\/\/supplier\.example\/v1\/search/);
  assert.doesNotMatch(outputs.html, /<\/script><script>alert/);
  assert.match(outputs.html, /\\u003c\/script>/);
  assert.match(outputs.html, /phidias:browser-api-reply/);
  const inlineScript = outputs.html.match(/<script>\n([\s\S]*)\n<\/script>$/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));

  const secret = { __phidiasSecret: true, toString: () => 'supplier-secret', toJSON: () => '[REDACTED]' };
  await assert.rejects(() => requestBlock.execute({}, {
    method: 'GET', body_format: 'JSON', credentials: 'Omit', timeout_seconds: 30
  }, { request_id: 'secret_test', url: 'https://supplier.example', headers: { authorization: secret } }, () => {}), /Protected credentials cannot be sent/);
});

test('Browser API Reply IDs must be valid and unique across active workspaces', () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const reply = (id, requestID) => ({ id, type: 'browser_api_reply', x: 0, y: 0, options: { request_id: requestID } });
  assert.throws(() => validate({ version: 1, name: 'Duplicate browser replies', workspaces: [
    { id: 'one', name: 'One', active: true, blocks: [reply('first', 'same_request')], connections: [] },
    { id: 'two', name: 'Two', active: true, blocks: [reply('second', 'same_request')], connections: [] }
  ] }, definitions), /Duplicate Browser API Reply ID/);
  assert.throws(() => validate({ version: 1, name: 'Invalid browser reply', workspaces: [
    { id: 'one', name: 'One', active: true, blocks: [reply('first', 'not valid')], connections: [] }
  ] }, definitions), /Browser API Reply ID must start/);
});

test('Browser API Reply receives browser results and follows success and error workflows', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Browser requests', workspaces: [{
    id: 'browser-api', name: 'Browser API', active: true,
    blocks: [
      { id: 'reply', type: 'browser_api_reply', x: 0, y: 0, options: { request_id: 'supplier_lookup' } },
      { id: 'success-log', type: 'console_log', x: 300, y: 0, options: { level: 'info', value: '' } },
      { id: 'error-log', type: 'console_log', x: 300, y: 180, options: { level: 'warning', value: '' } }
    ],
    connections: [
      { id: 'success-action', from: 'reply', output: 'success', to: 'success-log', input: 'action', kind: 'action' },
      { id: 'success-value', from: 'reply', output: 'response', to: 'success-log', input: 'value', kind: 'value' },
      { id: 'error-action', from: 'reply', output: 'error', to: 'error-log', input: 'action', kind: 'action' },
      { id: 'error-value', from: 'reply', output: 'error_message', to: 'error-log', input: 'value', kind: 'value' }
    ]
  }] };
  const entries = { info: [], warning: [] };
  const logger = {
    debug() {}, error() {},
    info(value) { entries.info.push(value); },
    warning(value) { entries.warning.push(value); }
  };
  const app = createApp({ document, definitions, logger });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const callback = payload => fetch(base + '/_phidias/browser-api/supplier_lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'supplier_lookup', origin: base },
    body: JSON.stringify(payload)
  });

  const successful = { ok: true, status: 200, headers: { 'content-type': 'application/json' }, body: { systems: 4 }, error: '' };
  assert.equal((await callback(successful)).status, 202);
  assert.deepEqual(JSON.parse(JSON.stringify(entries.info[0])), successful);
  assert.deepEqual(entries.warning, []);

  const failed = { ok: false, status: 429, headers: { 'retry-after': '60' }, body: { error: 'rate limited' }, error: 'Supplier returned HTTP 429' };
  assert.equal((await callback(failed)).status, 202);
  assert.deepEqual(entries.warning, ['Supplier returned HTTP 429']);

  assert.equal((await fetch(base + '/_phidias/browser-api/missing', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'missing', origin: base }, body: JSON.stringify(successful)
  })).status, 404);
  assert.equal((await fetch(base + '/_phidias/browser-api/supplier_lookup', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(successful)
  })).status, 403);
  assert.equal((await fetch(base + '/_phidias/browser-api/supplier_lookup', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'supplier_lookup', origin: 'https://attacker.example' }, body: JSON.stringify(successful)
  })).status, 403);
});
