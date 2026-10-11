'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Auth } = require('../lib/auth');
const { createAuthBroker } = require('../lib/auth-broker');
const { createApp, loadDefinitions } = require('../runtime/app');

test('credential blocks retrieve and use secrets through the signed broker', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-credential-runtime-'));
  const auth = new Auth(path.join(directory, 'auth.sqlite'), { keyFile: path.join(directory, 'phidias.key') });
  const projectId = crypto.randomUUID(), applicationKey = auth.ensureApplicationKey(projectId);
  auth.createCredential({ type: 'other', name: 'Remote API', username: 'service', password: 'remote-password', extra: {} });
  const broker = createAuthBroker({ auth, mysqlConfig: null, logger: { info() {}, error() {} } });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(directory, 'application.key'), applicationKey);
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port: 3001, host: '127.0.0.1', 'log-level': 0, 'force-console-input-log': false,
    auth: { database: 'unused.sqlite', broker: { url: `http://127.0.0.1:${broker.address().port}` } },
    'project-id': projectId, 'release-channel': 'RC'
  }));
  const document = { version: 1, name: 'Broker test', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/credential' } },
    { id: 'name', type: 'text', x: 0, y: 0, options: { text: 'Remote API' } },
    { id: 'lookup', type: 'get_other_credentials_by_name', x: 0, y: 0, options: {} },
    { id: 'info', type: 'get_credential_info', x: 0, y: 0, options: {} },
    { id: 'key', type: 'text', x: 0, y: 0, options: { text: 'password' } },
    { id: 'object', type: 'create_object_and_add_property_1x', x: 0, y: 0, options: {} },
    { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'JSON', body: '', headers: '{}' } }
  ], connections: [
    { id: 'a1', from: 'http', output: 'next', to: 'lookup', input: 'action', kind: 'action' },
    { id: 'v1', from: 'name', output: 'text', to: 'lookup', input: 'name', kind: 'value' },
    { id: 'a2', from: 'lookup', output: 'action', to: 'info', input: 'action', kind: 'action' },
    { id: 'v2', from: 'lookup', output: 'credential', to: 'info', input: 'credential', kind: 'value' },
    { id: 'a3', from: 'info', output: 'action', to: 'object', input: 'action', kind: 'action' },
    { id: 'v3', from: 'key', output: 'text', to: 'object', input: 'key1', kind: 'value' },
    { id: 'v4', from: 'info', output: 'password', to: 'object', input: 'value1', kind: 'value' },
    { id: 'a4', from: 'object', output: 'action', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v5', from: 'object', output: 'object', to: 'reply', input: 'body', kind: 'value' }
  ] }] };
  const app = createApp({ directory, document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1');
  t.after(async () => {
    await app.stop();
    await new Promise(resolve => broker.close(resolve));
    auth.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${address.port}/credential`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { password: 'remote-password' });
});
