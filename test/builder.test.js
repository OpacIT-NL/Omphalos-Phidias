'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('../server');
const { createLogger } = require('../lib/logger');
const { createApp, loadDefinitions, render } = require('../runtime/app');
const { validate } = require('../runtime/validate');
const { crc32 } = require('../lib/zip');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-test-'));
  const { server, store, auth } = await createServer({ directory, authDatabase: path.join(directory, 'auth.sqlite'), secureCookies: false, logger: createLogger({ level: 0, directory: path.join(directory, 'logs') }) });
  await auth.createUser('tester', 'a-test-password-12345');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const rawCall = (route, method = 'GET', body, headers = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = await rawCall('/api/login', 'POST', { username: 'tester', password: 'a-test-password-12345' });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken };
  const call = (route, method = 'GET', body, extra = {}) => rawCall(route, method, body, { ...headers, ...extra });
  return { directory, store, auth, call, rawCall, headers, base };
}

test('project creation, atomic saves, conflicts, reload, and downloadable ZIP', async t => {
  const { store, call, directory } = await fixture(t);
  const response = await call('/api/projects', 'POST', { name: 'My project' }); assert.equal(response.status, 201);
  const project = await response.json(), endpoint = `/api/projects/${project.id}`;
  for (const file of ['app.js', 'workspaces.json', 'blocks/http.js', 'validate.js', 'cron.js', 'package.json']) await fs.access(path.join(directory, project.id, file));
  project.workspaces[0].blocks[1].options.body = 'Updated application';
  const results = await Promise.all([call(endpoint, 'PUT', project), call(endpoint, 'PUT', project)]);
  assert.deepEqual(results.map(res => res.status).sort(), [200, 409]);
  const stored = await store.get(project.id); assert.equal(stored.revision, 2); assert.equal(stored.workspaces[0].blocks[1].options.body, 'Updated application');
  assert.equal((await (await call('/api/projects')).json()).length, 1);
  const archive = await call(endpoint + '/export'); assert.equal(archive.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await archive.arrayBuffer());
  const extracted = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const filename = zip.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength;
    const contents = zip.subarray(start, start + length); assert.equal(crc32(contents), zip.readUInt32LE(offset + 14)); extracted.set(filename, contents); offset = start + length;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  assert.equal(JSON.parse(extracted.get('workspaces.json')).revision, 2);
  assert.ok(extracted.has('blocks/respond.js'));
  const deployment = path.join(directory, 'isolated-export'); await fs.mkdir(deployment);
  for (const [filename, data] of extracted) { const destination = path.join(deployment, filename); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, data); }
  const child = spawn(process.execPath, ['app.js'], { cwd: deployment, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Export did not start')); }, 5000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/My project listening on 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.once('error', reject); child.stderr.on('data', chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
  });
  const runtimeResponse = await fetch(`http://127.0.0.1:${address}/hello`); assert.equal(runtimeResponse.status, 200); assert.equal(await runtimeResponse.text(), 'Updated application');
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
});

test('password login, protected routes, CSRF, logout, malformed requests and traversal', async t => {
  const { call, rawCall, headers, base } = await fixture(t);
  assert.equal((await rawCall('/api/projects')).status, 401);
  assert.equal((await rawCall('/api/projects', 'GET', undefined, { authorization: 'Bearer old-builder-token' })).status, 401);
  const wrong = await rawCall('/api/login', 'POST', { username: 'tester', password: 'wrong' });
  const missing = await rawCall('/api/login', 'POST', { username: 'unknown', password: 'wrong' });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401); assert.deepEqual(await wrong.json(), await missing.json());
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/login');
  assert.match(await (await fetch(base + '/login')).text(), /autocomplete="current-password"/);
  assert.equal((await call('/api/projects')).status, 200);
  assert.equal((await rawCall('/api/projects', 'POST', { name: 'Denied' }, { cookie: headers.cookie })).status, 403);
  assert.equal((await call('/api/projects', 'POST', { name: 'Denied' }, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await call('/api/projects', 'POST', { name: 'Denied' }, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await call('/api/login', 'POST', { username: 'tester', password: 'a-test-password-12345' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('/api/projects/%2e%2e%2fsecret')).status, 400);
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await call('/api/projects', 'POST', null)).status, 400);
  assert.equal((await call('/api/projects', 'POST', { name: 'x'.repeat(1048577) })).status, 413);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/data/auth.sqlite')).status, 404);
  const project = await (await call('/api/projects', 'POST', { name: 'Private' })).json();
  assert.equal((await rawCall(`/api/projects/${project.id}/export`)).status, 401);
  const logout = await call('/api/logout', 'POST', {}); assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/api/projects')).status, 401);
});

test('validation rejects dangling wires, duplicate routes, loops, and invalid options', async t => {
  const { store } = await fixture(t), project = await store.create('Validation');
  const definitions = store.definitions(project.id);
  const reject = (modify, pattern) => { const copy = structuredClone(project); modify(copy.workspaces[0], copy); assert.throws(() => validate(copy, definitions), pattern); };
  reject(ws => { ws.connections[0].to = 'missing'; }, /Invalid connection/);
  reject(ws => { ws.blocks.push({ ...structuredClone(ws.blocks[0]), id: 'duplicate' }); }, /Duplicate HTTP/);
  reject(ws => { ws.blocks[1].options.status = 999; }, /Status code/);
  reject(ws => { ws.blocks[1].type = '../server'; }, /Unknown block/);
  reject(ws => {
    ws.blocks[1] = { id: 'response', type: 'log', x: 0, y: 0, options: { message: 'cycle' } };
    ws.connections.push({ id: 'cycle', from: 'response', output: 'next', to: 'response' });
  }, /Loops/);
  reject(ws => { ws.connections.push({ ...ws.connections[0], id: 'second' }); }, /one connection/);
  const paused = structuredClone(project.workspaces[0]); paused.id = 'paused'; paused.active = false; project.workspaces.push(paused); assert.doesNotThrow(() => validate(project, definitions));
});

test('runtime HTTP payloads, variables, conditions, outbound requests and failures', async t => {
  const { store } = await fixture(t), project = await store.create('Runtime');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/echo' } },
    { id: 'set', type: 'set', x: 0, y: 0, options: { name: 'payload', value: '{{request.body}}' } },
    { id: 'if', type: 'condition', x: 0, y: 0, options: { left: '{{vars.payload.name}}', operator: 'equals', right: 'Sentinel' } },
    { id: 'yes', type: 'respond', x: 0, y: 0, options: { status: 201, body: '{{vars.payload}}' } },
    { id: 'no', type: 'respond', x: 0, y: 0, options: { status: 400, body: 'Incorrect name' } }
  ];
  workspace.connections = [
    { id: 'a', from: 'http', output: 'next', to: 'set' }, { id: 'b', from: 'set', output: 'next', to: 'if' },
    { id: 'c', from: 'if', output: 'true', to: 'yes' }, { id: 'd', from: 'if', output: 'false', to: 'no' }
  ];
  const errors = [], app = createApp({ document: project, definitions: store.definitions(project.id), onError: err => errors.push(err) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sentinel' }) });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { name: 'Sentinel' });
  assert.equal((await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await fetch(base + '/unknown')).status, 404);
  assert.equal((await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  const requestBlock = require('../blocks/request');
  const ctx = { vars: {}, render: value => value, signal: new AbortController().signal };
  assert.equal(await requestBlock.execute(ctx, { method: 'POST', url: base + '/echo', body: '{"name":"Sentinel"}', variable: 'result' }), 'next');
  assert.deepEqual(ctx.vars.result, { status: 201, body: { name: 'Sentinel' } });
  assert.equal(errors.length, 1);
});

test('HTTP endpoint body output connects to HTTP response body input', async t => {
  const { store } = await fixture(t), project = await store.create('HTTP body ports');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/body' } },
    { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback' } }
  ];
  workspace.connections = [
    { id: 'action', from: 'http', output: 'next', to: 'response', input: 'action', kind: 'action' },
    { id: 'body', from: 'http', output: 'body', to: 'response', input: 'body', kind: 'value' }
  ];
  const definitions = store.definitions(project.id);
  assert.ok(definitions.get('http').outputPorts.find(port => port.id === 'body').types.includes('text'));
  const merge = definitions.get('merge_texts');
  const textInputDocument = {
    version: 1, name: 'HTTP text compatibility', workspaces: [{ id: 'main', name: 'Main', active: true,
      blocks: [
        { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/text' } },
        { id: 'merge', type: 'merge_texts', x: 0, y: 0, options: Object.fromEntries(merge.fields.map(field => [field.key, field.default])) }
      ],
      connections: [{ id: 'body', from: 'http', output: 'body', to: 'merge', input: 'text1', kind: 'value' }]
    }]
  };
  assert.doesNotThrow(() => validate(textInputDocument, definitions));
  const app = createApp({ document: project, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}/body`;
  const text = await fetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'plain text' });
  assert.equal(text.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await text.text(), 'plain text');
  const json = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
  assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await json.json(), { ok: true });
});

test('startup and interval triggers, disabled workspaces, clean shutdown', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks')); let runs = 0;
  definitions.set('count', { type: 'count', fields: [], outputs: [], execute: async () => { runs++; } });
  const workspace = { id: 'main', name: 'Main', active: true, blocks: [
    { id: 'start', type: 'startup', x: 0, y: 0, options: {} },
    { id: 'interval', type: 'interval', x: 0, y: 0, options: { seconds: 1 } },
    { id: 'counter', type: 'count', x: 0, y: 0, options: {} }
  ], connections: [{ id: 'a', from: 'start', output: 'next', to: 'counter' }, { id: 'b', from: 'interval', output: 'next', to: 'counter' }] };
  const document = { version: 1, name: 'Timers', workspaces: [workspace, { ...structuredClone(workspace), id: 'off', active: false }] };
  const app = createApp({ document, definitions }); t.after(() => app.stop()); await app.start(0, '127.0.0.1'); assert.equal(runs, 1);
  await new Promise(resolve => setTimeout(resolve, 1150)); assert.equal(runs, 2); await app.stop();
  await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(runs, 2);
});

test('cron triggers follow five-field local schedules and reject invalid expressions', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks')); let runs = 0;
  definitions.set('count', { type: 'count', fields: [], outputs: [], execute: async () => { runs++; } });
  let now = new Date(2026, 0, 15, 12, 34, 0);
  const workspace = { id: 'main', name: 'Main', active: true, blocks: [
    { id: 'cron', type: 'cron', x: 0, y: 0, options: { expression: '* * * * *' } },
    { id: 'counter', type: 'count', x: 0, y: 0, options: {} }
  ], connections: [{ id: 'a', from: 'cron', output: 'next', to: 'counter' }] };
  const document = { version: 1, name: 'Cron', workspaces: [workspace] };
  const app = createApp({ document, definitions, clock: () => now }); t.after(() => app.stop()); await app.start(0, '127.0.0.1');
  await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(runs, 1);
  now = new Date(now.getTime() + 60000); await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(runs, 2);
  const invalid = structuredClone(document); invalid.workspaces[0].blocks[0].options.expression = 'not cron';
  assert.throws(() => validate(invalid, definitions), /Cron expression/);
  await app.stop();
});

test('templates preserve objects and do not traverse prototypes or evaluate code', () => {
  const context = { vars: { value: { a: 1 }, text: 'hello' } };
  assert.deepEqual(render('{{vars.value}}', context), { a: 1 });
  assert.equal(render('Value: {{vars.value}}', context), 'Value: {"a":1}');
  assert.equal(render('{{vars.constructor}}', context), '');
  assert.equal(render('{{process.exit()}}', context), '');
});
