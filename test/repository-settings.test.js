'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { createLogger } = require('../lib/logger');
const { entries } = require('../lib/zip');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-repository-settings-'));
  const repositoryDirectory = path.join(directory, 'repo');
  const logger = createLogger({ level: 0, directory: path.join(directory, 'logs') });
  const { server, auth } = await createServer({ directory: path.join(directory, 'projects'), repositoryDirectory, authDatabase: path.join(directory, 'auth.sqlite'), secureCookies: false, logger });
  await auth.createUser('tester', 'a-test-password-12345');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = (route, options = {}) => fetch(base + route, options);
  const login = await raw('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'a-test-password-12345' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
  const api = (route, method = 'GET', body) => raw(route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { raw, api, auth, repositoryDirectory };
}

const files = archive => new Map(entries(archive));

test('repository settings include application keys only for authorized client networks', async t => {
  const { raw, api, auth, repositoryDirectory } = await fixture(t);
  const created = await (await api('/api/projects', 'POST', { name: 'Network deploy' })).json();
  created.workspaces[0].blocks[1].options.body = 'published';
  const saved = await (await api(`/api/projects/${created.id}`, 'PUT', created)).json();
  const route = `/repo/Network-deployRC/network-deploy.rev${saved.revision}.zip`;

  let archive = Buffer.from(await (await raw(route)).arrayBuffer());
  assert.equal(files(archive).has('application.key'), false);

  let response = await api('/api/repository-settings', 'PUT', { authorizedNetworks: ['not-a-network'], trustedProxies: [] });
  assert.equal(response.status, 400);

  response = await api('/api/repository-settings', 'PUT', { authorizedNetworks: ['10.0.0.0/8'], trustedProxies: [] });
  assert.equal(response.status, 200);
  archive = Buffer.from(await (await raw(route, { headers: { 'x-forwarded-for': '10.20.30.40' } })).arrayBuffer());
  assert.equal(files(archive).has('application.key'), false);

  response = await api('/api/repository-settings', 'PUT', { authorizedNetworks: ['10.0.0.0/8'], trustedProxies: ['127.0.0.1/32'] });
  assert.equal(response.status, 200);
  archive = Buffer.from(await (await raw(route, { headers: { 'x-forwarded-for': '10.20.30.40' } })).arrayBuffer());
  assert.deepEqual(files(archive).get('application.key'), await auth.applicationKey(created.id));

  const stored = await fs.readFile(path.join(repositoryDirectory, 'Network-deployRC', `network-deploy.rev${saved.revision}.zip`));
  assert.equal(files(stored).has('application.key'), false);

  response = await api('/api/repository-settings', 'PUT', { authorizedNetworks: ['127.0.0.0/8'], trustedProxies: [] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorizedNetworks: ['127.0.0.0/8'], trustedProxies: [] });
  archive = Buffer.from(await (await raw(route)).arrayBuffer());
  assert.deepEqual(files(archive).get('application.key'), await auth.applicationKey(created.id));

  const settings = await (await api('/api/repository-settings')).json();
  assert.deepEqual(settings, { authorizedNetworks: ['127.0.0.0/8'], trustedProxies: [] });
});
