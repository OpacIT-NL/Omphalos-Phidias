'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const requestBlock = require('../blocks/browser_api_request');
const request2x = require('../blocks/browser_api_request_2x');
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
    assert.equal(result.events[1].type, 'phidias:internal-refresh');
    assert.deepEqual(JSON.parse(JSON.stringify(result.events[1].detail)), { source: 'browser-api-reply', requestId: 'supplier_lookup' });
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
  assert.match(outputs.html, /phidias:internal-refresh/);
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

test('Browser API Request 2x and 3x expose parallel request inputs and matching reply outputs', async () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const request3x = definitions.get('browser_api_request_3x');
  const reply2x = definitions.get('browser_api_reply_2x');
  const reply3x = definitions.get('browser_api_reply_3x');

  assert.ok(request3x);
  assert.ok(reply2x);
  assert.ok(reply3x);
  assert.deepEqual(request3x.inputPorts.filter(port => /^url\d$/.test(port.id)).map(port => port.id), ['url1', 'url2', 'url3']);
  assert.deepEqual(reply2x.outputPorts.filter(port => /^response\d$/.test(port.id)).map(port => port.id), ['response1', 'response2']);
  assert.deepEqual(reply3x.outputPorts.filter(port => /^body\d$/.test(port.id)).map(port => port.id), ['body1', 'body2', 'body3']);

  const output = {};
  assert.equal(await request2x.execute({}, {
    method1: 'GET', body_format1: 'JSON', credentials1: 'Omit',
    method2: 'POST', body_format2: 'JSON', credentials2: 'Include', timeout_seconds: 20
  }, {
    request_id: 'parallel_lookup',
    url1: 'https://one.example/data',
    url2: 'https://two.example/data',
    body2: { enabled: true }
  }, (id, value) => { output[id] = value; }), 'next');
  assert.match(output.html, /"requests":\[/);
  assert.match(output.html, /Promise\.all\(configuration\.requests\.map\(requestOne\)\)/);
  assert.doesNotThrow(() => new Function(output.html.match(/<script>\n([\s\S]*)\n<\/script>$/)[1]));
});

test('batched browser requests start together and send one ordered callback', async () => {
  const html = requestBlock.browserBatchRequestHTML({
    id: 'parallel_lookup', timeoutMs: 30000,
    requests: [
      { url: 'https://one.example/data', method: 'GET', headers: {}, body: null, bodyFormat: 'JSON', credentials: 'omit' },
      { url: 'https://two.example/data', method: 'GET', headers: {}, body: null, bodyFormat: 'JSON', credentials: 'omit' }
    ]
  });
  const status = { dataset: {} }, events = [], calls = [];
  let started = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  let callbackPayload;
  const document = {
    currentScript: { previousElementSibling: status },
    dispatchEvent: event => events.push(event), open() {}, write() {}, close() {}
  };
  Object.defineProperty(document, 'cookie', { set() {}, get: () => '' });
  await vm.runInNewContext(html.match(/<script>\n([\s\S]*)\n<\/script>$/)[1], {
    AbortController, Blob, URL, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { location: { href: 'https://app.example/page', protocol: 'https:', assign() {} } },
    document,
    console: { error() {} },
    fetch: async (url, options) => {
      calls.push(url);
      if (url.startsWith('/_phidias/')) {
        callbackPayload = JSON.parse(options.body);
        return new Response(null, { status: 202 });
      }
      started++;
      if (started === 2) release();
      await gate;
      return url.includes('one.example')
        ? new Response('{"source":1}', { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{"source":2}', { status: 503, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(started, 2);
  assert.deepEqual(calls, ['https://one.example/data', 'https://two.example/data', '/_phidias/browser-api/parallel_lookup']);
  assert.equal(callbackPayload.batch, true);
  assert.equal(callbackPayload.ok, false);
  assert.deepEqual(callbackPayload.results.map(result => result.body.source), [1, 2]);
  assert.deepEqual(callbackPayload.results.map(result => result.status), [200, 503]);
  assert.equal(status.dataset.state, 'error');
  assert.equal(events[0].type, 'phidias:browser-api-reply');
});

test('Browser API Reply 2x exposes each batch result in one workflow run', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Batch browser reply', workspaces: [{
    id: 'batch-browser-api', name: 'Batch Browser API', active: true,
    blocks: [
      { id: 'reply', type: 'browser_api_reply_2x', x: 0, y: 0, options: { request_id: 'parallel_lookup' } },
      { id: 'log-one', type: 'console_log', x: 300, y: 0, options: { level: 'info', value: '' } },
      { id: 'log-two', type: 'console_log', x: 600, y: 0, options: { level: 'info', value: '' } }
    ],
    connections: [
      { id: 'start', from: 'reply', output: 'success', to: 'log-one', input: 'action', kind: 'action' },
      { id: 'first-value', from: 'reply', output: 'response1', to: 'log-one', input: 'value', kind: 'value' },
      { id: 'continue', from: 'log-one', output: 'action', to: 'log-two', input: 'action', kind: 'action' },
      { id: 'second-value', from: 'reply', output: 'response2', to: 'log-two', input: 'value', kind: 'value' }
    ]
  }] };
  const entries = [];
  const app = createApp({ document, definitions, logger: { debug() {}, error() {}, warning() {}, info: value => entries.push(value) } });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const endpoint = `http://127.0.0.1:${address.port}/_phidias/browser-api/parallel_lookup`;
  const results = [
    { ok: true, status: 200, headers: { source: 'one' }, body: { value: 1 }, error: '' },
    { ok: true, status: 201, headers: { source: 'two' }, body: { value: 2 }, error: '' }
  ];
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'parallel_lookup' },
    body: JSON.stringify({ batch: true, ok: true, results, error: '' })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(entries.map(value => JSON.parse(JSON.stringify(value))), results);

  const wrongShape = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-phidias-browser-api': 'parallel_lookup' },
    body: JSON.stringify(results[0])
  });
  assert.equal(wrongShape.status, 400);
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
