'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const requestBlock = require('../blocks/browser_api_request');
const { createApp, loadDefinitions } = require('../runtime/app');
const { validate } = require('../runtime/validate');

async function runBrowserRequest(callback, supplier = () => new Response('{"systems":4}'), passthrough) {
  const calls = [], events = [], writes = [], navigations = [], errors = [], cookies = [];
  const status = { dataset: {} };
  const html = requestBlock.browserRequestHTML({
    id: 'supplier_lookup', url: 'https://supplier.example/search', method: 'GET',
    headers: {}, body: null, bodyFormat: 'JSON', credentials: 'omit', timeoutMs: 30000,
    ...(passthrough === undefined ? {} : { passthrough })
  });
  const document = {
    currentScript: { previousElementSibling: status },
    dispatchEvent: event => events.push(event),
    open: () => writes.push('open'), write: html => writes.push(html), close: () => writes.push('close')
  };
  Object.defineProperty(document, 'cookie', { set: value => cookies.push(value), get: () => '' });
  await vm.runInNewContext(html.match(/<script>\n([\s\S]*)\n<\/script>$/)[1], {
    AbortController, Blob, URL, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { location: { href: 'https://app.example/form', protocol: 'https:', assign: url => navigations.push(url) } },
    document,
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url.startsWith('/_phidias/') ? callback(url, options) : supplier();
    }
  });
  return { calls, events, writes, navigations, errors, cookies, state: status.dataset.state };
}

test('browser stores passthrough values in a scoped cookie and clears it after callback', async () => {
  for (const value of ['context', ['one', { two: 2 }], { nested: ['three'] }]) {
    const result = await runBrowserRequest(() => new Response(null, { status: 202 }), undefined, value);
    assert.equal(result.cookies.length, 2);
    assert.match(result.cookies[0], /^phidias_browser_api_supplier_lookup=/);
    assert.match(result.cookies[0], /Path=\/_phidias\/browser-api\/supplier_lookup/);
    assert.match(result.cookies[0], /SameSite=Strict; Secure/);
    assert.ok(result.cookies[0].includes(encodeURIComponent(JSON.stringify(value))));
    assert.match(result.cookies[1], /Max-Age=0$/);
  }
});

test('browser displays callback HTML, including error pages, and leaves acknowledgements and JSON in place', async () => {
  for (const status of [200, 422]) {
    const html = '<!doctype html><h1>Result</h1><script>window.result = true;</script>';
    const result = await runBrowserRequest(() => new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    assert.deepEqual(result.writes, ['open', html, 'close']);
    assert.deepEqual(result.errors, []);
    assert.equal(result.events[0].detail.body.systems, 4);
    assert.equal(result.calls.length, 2);
  }
  for (const reply of [new Response(null, { status: 202 }), new Response('{"saved":true}', { headers: { 'content-type': 'application/json' } })]) {
    const result = await runBrowserRequest(() => reply);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.navigations, []);
    assert.equal(result.state, 'complete');
    assert.equal(result.events.length, 1);
  }
});

test('browser navigates callback redirects and rejects executable redirect URLs', async () => {
  for (const [location, expected] of [['/done', 'https://app.example/done'], ['https://other.example/done', 'https://other.example/done']]) {
    const result = await runBrowserRequest(() => new Response(null, { headers: { 'x-phidias-redirect': location } }));
    assert.deepEqual(result.navigations, [expected]);
    assert.deepEqual(result.writes, []);
    assert.equal(result.calls[1].options.redirect, 'error');
  }
  const result = await runBrowserRequest(() => new Response(null, { headers: { 'x-phidias-redirect': 'javascript:alert(1)' } }));
  assert.deepEqual(result.navigations, []);
  assert.equal(result.state, 'callback-error');
  assert.equal(result.calls.length, 2);
});

test('browser reports supplier errors once and does not retry failed callbacks', async () => {
  const result = await runBrowserRequest(() => new Response(null, { status: 202 }), () => { throw new Error('Supplier unreachable'); });
  const payload = JSON.parse(result.calls[1].options.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 0);
  assert.equal(payload.error, 'Supplier unreachable');
  assert.equal(result.state, 'error');
  for (const callback of [() => new Response('Workflow failed', { status: 500 }), () => { throw new Error('Callback unreachable'); }]) {
    const failed = await runBrowserRequest(callback);
    assert.equal(failed.calls.length, 2);
    assert.equal(failed.state, 'callback-error');
    assert.equal(failed.errors.length, 1);
    assert.deepEqual(failed.writes, []);
  }
});

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
  await assert.rejects(() => requestBlock.execute({}, {
    method: 'GET', body_format: 'JSON', credentials: 'Omit', timeout_seconds: 30
  }, { request_id: 'invalid_passthrough', url: 'https://supplier.example', passthrough: 42 }, () => {}), /must be text, a list, or an object/);
  await assert.rejects(() => requestBlock.execute({}, {
    method: 'GET', body_format: 'JSON', credentials: 'Omit', timeout_seconds: 30
  }, { request_id: 'secret_passthrough', url: 'https://supplier.example', passthrough: { secret } }, () => {}), /Protected credentials cannot be sent/);
  await assert.rejects(() => requestBlock.execute({}, {
    method: 'GET', body_format: 'JSON', credentials: 'Omit', timeout_seconds: 30
  }, { request_id: 'large_passthrough', url: 'https://supplier.example', passthrough: 'x'.repeat(3001) }, () => {}), /3,000-byte cookie limit/);
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

test('Browser API Reply retrieves text, list, and object passthrough cookies', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Browser passthrough', workspaces: [{
    id: 'browser-api', name: 'Browser API', active: true,
    blocks: [
      { id: 'reply', type: 'browser_api_reply', x: 0, y: 0, options: { request_id: 'supplier_lookup' } },
      { id: 'log', type: 'console_log', x: 300, y: 0, options: { level: 'info', value: '' } }
    ],
    connections: [
      { id: 'action', from: 'reply', output: 'success', to: 'log', input: 'action', kind: 'action' },
      { id: 'value', from: 'reply', output: 'passthrough', to: 'log', input: 'value', kind: 'value' }
    ]
  }] };
  const values = [];
  const app = createApp({ document, definitions, logger: { debug() {}, error() {}, warning() {}, info: value => values.push(value) } });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const endpoint = `http://127.0.0.1:${address.port}/_phidias/browser-api/supplier_lookup`;
  const result = { ok: true, status: 200, headers: {}, body: null, error: '' };
  for (const value of ['context', ['one', { two: 2 }], { nested: ['three'] }]) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phidias-browser-api': 'supplier_lookup',
        cookie: `phidias_browser_api_supplier_lookup=${encodeURIComponent(JSON.stringify(value))}`
      },
      body: JSON.stringify(result)
    });
    assert.equal(response.status, 202);
  }
  assert.deepEqual(values.map(value => JSON.parse(JSON.stringify(value))), ['context', ['one', { two: 2 }], { nested: ['three'] }]);
  const malformed = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'supplier_lookup', cookie: 'phidias_browser_api_supplier_lookup=%7Bbad' },
    body: JSON.stringify(result)
  });
  assert.equal(malformed.status, 400);
});

test('Browser API Reply supports HTML, JSON, and redirects through HTTP response on either branch', async t => {
  for (const scenario of [
    { name: 'HTML success', ok: true, format: 'HTML', status: 200, body: '<h1>Saved</h1>' },
    { name: 'HTML failure', ok: false, format: 'HTML', status: 422, body: '<h1>Please try again</h1>' },
    { name: 'JSON success', ok: true, format: 'JSON', status: 201, body: '{"saved":true}' },
    { name: 'Redirect success', ok: true, format: 'Text', status: 303, body: '', headers: '{"Location":"/done"}' }
  ]) await t.test(scenario.name, async t => {
    const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
    const document = { version: 1, name: 'Browser callback response', workspaces: [{
      id: 'browser-api', name: 'Browser API', active: true,
      blocks: [
        { id: 'reply', type: 'browser_api_reply', x: 0, y: 0, options: { request_id: 'supplier_lookup' } },
        { id: 'response', type: 'respond', x: 300, y: 0, options: {
          format: scenario.format, status: scenario.status, body: scenario.body, headers: scenario.headers || '{}'
        } }
      ],
      connections: [{ id: 'action', from: 'reply', output: scenario.ok ? 'success' : 'error', to: 'response', input: 'action', kind: 'action' }]
    }] };
    const errors = [];
    const app = createApp({ document, definitions, onError: error => errors.push(error) });
    const address = await app.start(0, '127.0.0.1');
    t.after(() => app.stop());
    const response = await fetch(`http://127.0.0.1:${address.port}/_phidias/browser-api/supplier_lookup`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'supplier_lookup' },
      body: JSON.stringify({ ok: scenario.ok, status: scenario.ok ? 200 : 400, headers: {}, body: {}, error: scenario.ok ? '' : 'Failed' })
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (scenario.status === 303) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-phidias-redirect'), '/done');
      assert.equal(response.headers.get('location'), null);
    } else {
      assert.equal(response.status, scenario.status);
      assert.match(response.headers.get('content-type'), scenario.format === 'HTML' ? /text\/html/ : /application\/json/);
    }
    assert.equal(await response.text(), scenario.body);
    assert.deepEqual(errors, []);
  });
});
