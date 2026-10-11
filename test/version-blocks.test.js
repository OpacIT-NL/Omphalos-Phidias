'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp, loadDefinitions } = require('../runtime/app');
const currentVersion = require('../blocks/get_current_version');
const latestVersion = require('../blocks/get_latest_version');

test('Get Current Version returns packaged application, stage, and revision data', async () => {
  const outputs = {};
  const result = await currentVersion.execute({ appName: 'Delphi', appRevision: 16, deployment: { channel: 'RC' } }, {}, {}, (id, value) => { outputs[id] = value; });
  assert.equal(result, 'next');
  assert.deepEqual(outputs, { version: 'Delphi_RC_rev16', app_name: 'Delphi', stage: 'RC', revision: 16 });
});

test('Get Current Version reads the revision from an exported workflow runtime', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-current-version-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port: 3001,
    host: '127.0.0.1',
    'log-level': 3,
    auth: { database: 'auth.sqlite' },
    'project-id': '11111111-1111-4111-8111-111111111111',
    'release-channel': 'RC'
  }));
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, revision: 23, name: 'Iris GUI', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/version' } },
    { id: 'version', type: 'get_current_version', x: 200, y: 0, options: {} },
    { id: 'reply', type: 'respond', x: 400, y: 0, options: { status: 200, format: 'Text', body: '', headers: '{}' } }
  ], connections: [
    { id: 'a1', from: 'http', output: 'next', to: 'version', input: 'action', kind: 'action' },
    { id: 'a2', from: 'version', output: 'next', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v1', from: 'version', output: 'version', to: 'reply', input: 'body', kind: 'value' }
  ] }] };
  const app = createApp({ directory, document, definitions });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/version`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Iris GUI_RC_rev23');
});

test('Get Latest Version checks latest.zip and selects the newest numbered repository revision', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'HEAD' && request.url === '/repo/DelphiRC/latest.zip') {
      response.writeHead(200, { 'content-type': 'application/zip' }); response.end(); return;
    }
    if (request.method === 'GET' && request.url === '/repo/DelphiRC/') {
      const html = '<a href="delphi.rev14.zip">rev14</a><a href="delphi.rev16.zip">rev16</a><a href="latest.zip">latest</a>';
      response.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(html) }); response.end(html); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const outputs = {};
  const branch = await latestVersion.execute({
    appName: 'Delphi', deployment: { channel: 'RC', updateUrl: `http://127.0.0.1:${server.address().port}/repo/DelphiRC/latest.zip` }
  }, {}, {}, (id, value) => { outputs[id] = value; });
  assert.equal(branch, 'success');
  assert.deepEqual(outputs, { version: 'Delphi_RC_rev16', app_name: 'Delphi', stage: 'RC', revision: 16, error_message: '' });
  assert.deepEqual(requests, ['HEAD /repo/DelphiRC/latest.zip', 'GET /repo/DelphiRC/']);
});

test('Get Latest Version follows its error branch when no update URL is configured', async () => {
  const outputs = {};
  const branch = await latestVersion.execute({ appName: 'Delphi', deployment: { channel: 'Prod' } }, {}, {}, (id, value) => { outputs[id] = value; });
  assert.equal(branch, 'error');
  assert.equal(outputs.version, '');
  assert.match(outputs.error_message, /No update URL/);
});
