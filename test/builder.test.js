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
const { createApp, loadDefinitions, render, loadAppConfig } = require('../runtime/app');
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
function zipEntries(zip) {
  const extracted = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const filename = zip.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength;
    const contents = zip.subarray(start, start + length);
    assert.equal(crc32(contents), zip.readUInt32LE(offset + 14));
    extracted.set(filename, contents); offset = start + length;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  return extracted;
}

test('project creation, atomic saves, conflicts, reload, and downloadable ZIP', async t => {
  const { store, call, directory } = await fixture(t);
  const response = await call('/api/projects', 'POST', { name: 'My project' }); assert.equal(response.status, 201);
  const project = await response.json(), endpoint = `/api/projects/${project.id}`;
  const library = await (await call(endpoint + '/blocks')).json();
  const replyFormat = library.find(block => block.type === 'respond').fields.find(field => field.key === 'format');
  assert.equal(replyFormat.default, 'JSON'); assert.ok(replyFormat.choices.includes('HTML'));
  for (const file of ['app.js', 'workspaces.json', 'blocks/api_endpoint.js', 'blocks/get_sub_endpoint_by_name.js', 'blocks/linux_command.js', 'validate.js', 'cron.js', 'auth.js', 'logger.js', 'package.json']) await fs.access(path.join(directory, project.id, file));
  assert.equal(project.appConfig, null);
  assert.equal(zipEntries(await store.export(project.id)).has('config.json'), false);
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const configuredPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  project.appConfig = { port: configuredPort, host: '127.0.0.1', 'log-level': 4 };
  project.workspaces[0].blocks[1].options.body = 'Updated application';
  const results = await Promise.all([call(endpoint, 'PUT', project), call(endpoint, 'PUT', project)]);
  assert.deepEqual(results.map(res => res.status).sort(), [200, 409]);
  const stored = await store.get(project.id); assert.equal(stored.revision, 2); assert.equal(stored.workspaces[0].blocks[1].options.body, 'Updated application');
  assert.equal((await (await call('/api/projects')).json()).length, 1);
  await fs.copyFile(path.join(directory, project.id, 'blocks/api_endpoint.js'), path.join(directory, project.id, 'blocks/http.js'));
  const archive = await call(endpoint + '/export'); assert.equal(archive.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await archive.arrayBuffer());
  const extracted = zipEntries(zip);
  assert.equal(JSON.parse(extracted.get('workspaces.json')).revision, 2);
  assert.ok(extracted.has('auth.js'));
  assert.ok(extracted.has('logger.js'));
  assert.equal(JSON.parse(extracted.get('package.json')).dependencies.argon2, '^0.45.1');
  for (const name of ['api_endpoint.js', 'api_call.js', 'api_reply.js']) assert.ok(extracted.has(`blocks/${name}`));
  for (const name of ['http.js', 'request.js', 'respond.js']) assert.equal(extracted.has(`blocks/${name}`), false);
  const deployedConfig = JSON.stringify({ port: configuredPort, host: '127.0.0.1', 'log-level': 4 }, null, 2) + '\n';
  assert.equal(extracted.get('config.json').toString(), deployedConfig);
  const deployment = path.join(directory, 'isolated-export'); await fs.mkdir(deployment);
  for (const [filename, data] of extracted) { const destination = path.join(deployment, filename); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, data); }
  const childEnvironment = { ...process.env }; delete childEnvironment.PORT; delete childEnvironment.HOST;
  const child = spawn(process.execPath, ['app.js'], { cwd: deployment, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Export did not start')); }, 5000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/My project listening on 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.once('error', reject); child.stderr.on('data', chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
  });
  assert.equal(Number(address), configuredPort);
  assert.equal(await fs.readFile(path.join(deployment, 'config.json'), 'utf8'), deployedConfig);
  const runtimeResponse = await fetch(`http://127.0.0.1:${address}/hello`); assert.equal(runtimeResponse.status, 200); assert.equal(await runtimeResponse.text(), 'Updated application');
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  const runtimeLogs = await fs.readdir(path.join(deployment, 'log'));
  assert.equal(runtimeLogs.length, 1); assert.match(runtimeLogs[0], /^\d{4}-\d{2}-\d{2}-1\.txt$/);
  const runtimeLog = await fs.readFile(path.join(deployment, 'log', runtimeLogs[0]), 'utf8');
  assert.match(runtimeLog, /\[INFO\] My project listening on 127\.0\.0\.1:/);
  assert.match(runtimeLog, /\[INFO\] My project stopped/);
  assert.match(runtimeLog, /\[DEBUG\] Request completed: GET \/hello \(200,/);
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
  const editorPage = await fetch(base + '/', { headers: { cookie: headers.cookie } });
  assert.match(await editorPage.text(), /id="app-settings"/);
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
  const invalidPort = structuredClone(project); invalidPort.appConfig = { port: 70000, host: '127.0.0.1' }; await assert.rejects(store.save(project.id, invalidPort), /Application port/);
  const invalidHost = structuredClone(project); invalidHost.appConfig = { port: 3001, host: 'localhost', 'log-level': 3 }; await assert.rejects(store.save(project.id, invalidHost), /Application host/);
  const invalidLogLevel = structuredClone(project); invalidLogLevel.appConfig = { port: 3001, host: '127.0.0.1', 'log-level': 5 }; await assert.rejects(store.save(project.id, invalidLogLevel), /Application log level/);
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
  const requestBlock = require('../blocks/api_call');
  const ctx = { vars: {}, render: value => value, signal: new AbortController().signal };
  assert.equal(await requestBlock.execute(ctx, { method: 'POST', url: base + '/echo', body: '{"name":"Sentinel"}', headers: '{}', variable: 'result' }), 'next');
  assert.equal(ctx.vars.result.status, 201);
  assert.deepEqual(ctx.vars.result.body, { name: 'Sentinel' });
  assert.match(ctx.vars.result.headers['content-type'], /^application\/json/);
  let receivedAPIKey = '', receivedContentType = '', receivedBody = '';
  const upstream = require('node:http').createServer(async (request, response) => {
    receivedAPIKey = request.headers['x-api-key'];
    receivedContentType = request.headers['content-type'] || '';
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    receivedBody = Buffer.concat(chunks).toString();
    response.setHeader('x-upstream-header', 'available');
    response.end('upstream response');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
  const outputValues = {};
  const upstreamURL = 'http://127.0.0.1:' + upstream.address().port;
  assert.equal(await requestBlock.execute(ctx, { method: 'GET', url: upstreamURL, body: '', headers: '{"x-api-key":"configured"}', variable: 'upstream' }, {}, (id, value) => { outputValues[id] = value; }), 'next');
  assert.equal(receivedAPIKey, 'configured');
  assert.equal(ctx.vars.upstream.headers['x-upstream-header'], 'available');
  assert.equal(outputValues.headers['x-upstream-header'], 'available');
  assert.equal(await requestBlock.execute(ctx, { method: 'POST', format: 'HTML', url: upstreamURL, body: '<main>Hello</main>', headers: '{}', variable: 'html' }), 'next');
  assert.equal(receivedContentType, 'text/html; charset=utf-8');
  assert.equal(receivedBody, '<main>Hello</main>');
  assert.equal(errors.length, 1);
});

test('HTTP endpoints match sub-paths and expose the unmatched sub-endpoint', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Sub-endpoints', workspaces: [{
    id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'systems', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/systems' } },
      { id: 'subpath', type: 'get_sub_endpoint_by_name', x: 0, y: 0, options: {} },
      { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{}' } },
      { id: 'exact', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/systems/exact' } },
      { id: 'exact-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'exact endpoint', headers: '{}' } }
    ],
    connections: [
      { id: 'a', from: 'systems', output: 'next', to: 'subpath', input: 'action', kind: 'action' },
      { id: 'b', from: 'subpath', output: 'next', to: 'response', input: 'action', kind: 'action' },
      { id: 'c', from: 'subpath', output: 'sub_endpoint', to: 'response', input: 'body', kind: 'value' },
      { id: 'd', from: 'exact', output: 'next', to: 'exact-response', input: 'action', kind: 'action' }
    ]
  }] };
  const app = createApp({ document, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  for (const [requestPath, expected] of [['/systems', '/'], ['/systems/vhins', '/vhins'], ['/systems/vhins/status?full=true', '/vhins/status']]) {
    const response = await fetch(base + requestPath);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
  }
  const exact = await fetch(base + '/systems/exact');
  assert.equal(exact.status, 200);
  assert.equal(await exact.text(), 'exact endpoint');
  assert.equal((await fetch(base + '/systematic')).status, 404);
});

test('HTTP endpoint body output connects to HTTP response body input', async t => {
  const { store } = await fixture(t), project = await store.create('HTTP body ports');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/body' } },
    { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{"x-response-header":"present"}' } },
    { id: 'headers-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/headers' } },
    { id: 'headers-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{}' } },
    { id: 'html-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/html' } },
    { id: 'html-response', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '<main>Hello from HTML</main>', headers: '{}' } }
  ];
  workspace.connections = [
    { id: 'action', from: 'http', output: 'next', to: 'response', input: 'action', kind: 'action' },
    { id: 'body', from: 'http', output: 'body', to: 'response', input: 'body', kind: 'value' },
    { id: 'headers-action', from: 'headers-http', output: 'next', to: 'headers-response', input: 'action', kind: 'action' },
    { id: 'headers-value', from: 'headers-http', output: 'headers', to: 'headers-response', input: 'body', kind: 'value' },
    { id: 'html-action', from: 'html-http', output: 'next', to: 'html-response', input: 'action', kind: 'action' }
  ];
  const definitions = store.definitions(project.id);
  assert.ok(definitions.get('http').outputPorts.find(port => port.id === 'body').types.includes('text'));
  const replyFormat = definitions.get('respond').fields.find(field => field.key === 'format');
  const callFormat = definitions.get('request').fields.find(field => field.key === 'format');
  assert.equal(replyFormat.default, 'JSON'); assert.ok(replyFormat.choices.includes('HTML'));
  assert.equal(callFormat.default, 'JSON'); assert.ok(callFormat.choices.includes('HTML'));
  const responseBodyTypes = definitions.get('respond').inputPorts.find(port => port.id === 'body').types;
  assert.ok(responseBodyTypes.includes('list'));
  assert.ok(responseBodyTypes.includes('object'));
  const mergeLists = definitions.get('merge_lists');
  assert.doesNotThrow(() => validate({
    version: 1, name: 'HTTP list compatibility', workspaces: [{ id: 'main', name: 'Main', active: false,
      blocks: [
        { id: 'lists', type: 'merge_lists', x: 0, y: 0, options: Object.fromEntries(mergeLists.fields.map(field => [field.key, field.default])) },
        { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{"x-response-header":"present"}' } }
      ],
      connections: [{ id: 'body', from: 'lists', output: 'list', to: 'response', input: 'body', kind: 'value' }]
    }]
  }, definitions));
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
  assert.equal(text.headers.get('x-response-header'), 'present');
  assert.equal(await text.text(), 'plain text');
  const json = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
  assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');

  assert.deepEqual(await json.json(), { ok: true });
  const reflectedHeaders = await fetch(base.replace('/body', '/headers'), { headers: { 'x-client-header': 'received' } });
  assert.equal(reflectedHeaders.status, 200);
  assert.equal((await reflectedHeaders.json())['x-client-header'], 'received');
  const html = await fetch(base.replace('/body', '/html'));
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await html.text(), '<main>Hello from HTML</main>');
});

test('JSON-to-HTML table block converts objects and connects to file content', async () => {
  const block = require('../blocks/convert_json_to_html_table');
  const html = block.convertJSONToHTMLTable(JSON.stringify([
    { Name: 'Alice', Access: '<admin>', Details: { active: true } },
    { Name: 'Bob', Age: 42 }
  ]));
  assert.match(html, /^<table>/);
  assert.match(html, /<th>Name<\/th><th>Access<\/th><th>Details<\/th><th>Age<\/th>/);
  assert.match(html, /<td>&lt;admin&gt;<\/td>/);
  assert.equal((html.match(/<table>/g) || []).length, 2);
  assert.match(html, /<th>active<\/th>/);
  assert.match(html, /<td>true<\/td>/);
  assert.match(html, /<td>Bob<\/td><td><\/td><td><\/td><td>42<\/td>/);
  assert.equal(block.convertJSONToHTMLTable([]), '<table>\n  <tbody></tbody>\n</table>');
  const layered = block.convertJSONToHTMLTable({
    System: 'vhins',
    Services: [{ Name: 'API', Ports: [3001, 3002] }, { Name: '<Admin>' }]
  });
  assert.equal((layered.match(/<table>/g) || []).length, 3);
  assert.match(layered, /<th>Services<\/th>/);
  assert.match(layered, /<th>Name<\/th><th>Ports<\/th>/);
  assert.match(layered, /<th>Value<\/th>/);
  assert.match(layered, /<td>&lt;Admin&gt;<\/td>/);
  assert.throws(() => block.convertJSONToHTMLTable('{broken'), /valid JSON text/);
  const circular = {}; circular.self = circular;
  assert.throws(() => block.convertJSONToHTMLTable(circular), /circular objects/);
  const outputs = {};
  assert.equal(await block.execute({}, {}, { json: { Key: 'Value' } }, (id, value) => { outputs[id] = value; }), 'next');
  assert.match(outputs.html, /<th>Key<\/th>/);
  assert.match(outputs.html, /<td>Value<\/td>/);

  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const write = definitions.get('write_file');
  assert.doesNotThrow(() => validate({ version: 1, name: 'HTML file', workspaces: [{
    id: 'main', name: 'Main', active: false,
    blocks: [
      { id: 'table', type: 'convert_json_to_html_table', x: 0, y: 0, options: {} },
      { id: 'file', type: 'write_file', x: 0, y: 0, options: Object.fromEntries(write.fields.map(field => [field.key, field.default])) }
    ],
    connections: [{ id: 'html-file', from: 'table', output: 'html', to: 'file', input: 'content', kind: 'value' }]
  }] }, definitions));
});

test('Linux commands run as the automation user and expose success and error output', async t => {
  const { store } = await fixture(t), project = await store.create('Linux commands');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'success-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/success' } },
    { id: 'success-command', type: 'linux_command', x: 0, y: 0, options: { command: 'id -u', directory: '', timeout: 5 } },
    { id: 'success-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'missing output' } },
    { id: 'error-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/error' } },
    { id: 'error-command', type: 'linux_command', x: 0, y: 0, options: { command: 'printf failure >&2; exit 7', directory: '', timeout: 5 } },
    { id: 'error-response', type: 'respond', x: 0, y: 0, options: { status: 500, body: 'missing error' } }
  ];
  workspace.connections = [
    { id: 's1', from: 'success-http', output: 'next', to: 'success-command', input: 'action', kind: 'action' },
    { id: 's2', from: 'success-command', output: 'success', to: 'success-response', input: 'action', kind: 'action' },
    { id: 's3', from: 'success-command', output: 'stdout', to: 'success-response', input: 'body', kind: 'value' },
    { id: 'e1', from: 'error-http', output: 'next', to: 'error-command', input: 'action', kind: 'action' },
    { id: 'e2', from: 'error-command', output: 'error', to: 'error-response', input: 'action', kind: 'action' },
    { id: 'e3', from: 'error-command', output: 'stderr', to: 'error-response', input: 'body', kind: 'value' }
  ];
  const definitions = store.definitions(project.id);
  const app = createApp({ document: project, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const success = await fetch(base + '/success');
  assert.equal(success.status, 200);
  assert.equal((await success.text()).trim(), String(process.getuid()));
  const failure = await fetch(base + '/error');
  assert.equal(failure.status, 500);
  assert.equal(await failure.text(), 'failure');
  const direct = await require('../blocks/linux_command').runCommand('exit 7', '', 5, new AbortController().signal);
  assert.equal(direct.exitCode, 7);
  assert.equal(direct.failed, true);
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

test('generated app config is created once, validated, and preserved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-app-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(loadAppConfig(directory), { port: 3001, host: '0.0.0.0', 'log-level': 3 });
  const filename = path.join(directory, 'config.json');
  const configured = JSON.stringify({ port: 4321, host: '127.0.0.1' }, null, 2) + '\n';
  await fs.writeFile(filename, configured);
  assert.deepEqual(loadAppConfig(directory), { port: 4321, host: '127.0.0.1', 'log-level': 3 });
  assert.equal(await fs.readFile(filename, 'utf8'), configured);
  await fs.writeFile(filename, '{broken');
  assert.throws(() => loadAppConfig(directory), /Invalid config.json/);
});

test('templates preserve objects and do not traverse prototypes or evaluate code', () => {
  const context = { vars: { value: { a: 1 }, text: 'hello' } };
  assert.deepEqual(render('{{vars.value}}', context), { a: 1 });
  assert.equal(render('Value: {{vars.value}}', context), 'Value: {"a":1}');
  assert.equal(render('{{vars.constructor}}', context), '');
  assert.equal(render('{{process.exit()}}', context), '');
});
