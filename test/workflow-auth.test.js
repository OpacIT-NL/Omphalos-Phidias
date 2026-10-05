'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Auth } = require('../lib/auth');
const { createApp, loadDefinitions } = require('../runtime/app');

const node = (id, type, options) => ({ id, type, x: 0, y: 0, options });
const edge = (id, from, output, to, input = 'action', kind = 'action') => ({ id, from, output, to, input, kind });
const reply = (id, status, format, body) => node(id, 'respond', { status, format, body, headers: '{}' });

test('workflow browser sessions and API bearer tokens use a builder-compatible auth database', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-workflow-auth-'));
  const database = path.join(directory, 'builder-auth.sqlite');
  const builderAuth = new Auth(database);
  await builderAuth.createUser('alice', 'a-secure-test-password');
  builderAuth.close();

  const blocks = [
    node('database-path', 'text', { text: database }),
    node('browser-endpoint', 'http', { method: 'GET', path: '/protected' }),
    node('browser-check', 'check_if_logged_in', { database: './unused-auth.sqlite' }),
    node('browser-login', 'display_login', { database: './unused-auth.sqlite' }),
    node('browser-user', 'get_current_logged_in_user', { database: './unused-auth.sqlite', sessionType: 'Browser' }),
    reply('browser-ok', 200, 'Text', 'missing user'),
    node('cross-browser-endpoint', 'http', { method: 'GET', path: '/cross-protected' }),
    node('cross-browser-emitter-id', 'text', { text: 'cross-browser-auth' }),
    node('cross-browser-emitter', 'emitter', { restriction_type: 'all', search_type: 'number' }),

    node('browser-logout-endpoint', 'http', { method: 'POST', path: '/browser-logout' }),
    node('browser-logout', 'logout', { database: './unused-auth.sqlite', sessionType: 'Browser' }),
    reply('browser-logout-ok', 200, 'Text', 'logged out'),

    node('api-login-endpoint', 'http', { method: 'POST', path: '/api-login' }),
    node('api-login', 'login_through_api', { database: './unused-auth.sqlite' }),
    reply('api-login-ok', 200, 'JSON', '{}'),
    reply('api-login-error', 401, 'JSON', 'login failed'),

    node('api-protected-endpoint', 'http', { method: 'GET', path: '/api-protected' }),
    node('api-check', 'check_api_token', { database: './unused-auth.sqlite' }),
    node('api-user', 'get_current_logged_in_user', { database: './unused-auth.sqlite', sessionType: 'API' }),
    reply('api-protected-ok', 200, 'Text', 'missing user'),
    reply('api-protected-denied', 401, 'JSON', 'unauthorized'),

    node('api-logout-endpoint', 'http', { method: 'POST', path: '/api-logout' }),
    node('api-logout', 'logout', { database: './unused-auth.sqlite', sessionType: 'API' }),
    reply('api-logout-ok', 200, 'Text', 'logged out')
  ];
  const connections = [
    edge('db1', 'database-path', 'text', 'browser-check', 'database', 'value'),
    edge('db2', 'database-path', 'text', 'browser-login', 'database', 'value'),
    edge('db3', 'database-path', 'text', 'browser-user', 'database', 'value'),
    edge('db4', 'database-path', 'text', 'browser-logout', 'database', 'value'),
    edge('db5', 'database-path', 'text', 'api-login', 'database', 'value'),
    edge('db6', 'database-path', 'text', 'api-check', 'database', 'value'),
    edge('db7', 'database-path', 'text', 'api-user', 'database', 'value'),
    edge('db8', 'database-path', 'text', 'api-logout', 'database', 'value'),
    edge('b1', 'browser-endpoint', 'next', 'browser-check'),
    edge('b2', 'browser-check', 'false', 'browser-login'),
    edge('b3', 'browser-check', 'true', 'browser-user'),
    edge('b4', 'browser-login', 'authenticated', 'browser-user'),
    edge('b5', 'browser-user', 'found', 'browser-ok'),
    edge('b6', 'browser-user', 'username', 'browser-ok', 'body', 'value'),
    edge('cb1', 'cross-browser-endpoint', 'next', 'cross-browser-emitter'),
    edge('cb2', 'cross-browser-emitter-id', 'text', 'cross-browser-emitter', 'id', 'value'),

    edge('bl1', 'browser-logout-endpoint', 'next', 'browser-logout'),
    edge('bl2', 'browser-logout', 'logged_out', 'browser-logout-ok'),
    edge('bl3', 'browser-logout', 'not_logged_in', 'browser-logout-ok'),

    edge('al1', 'api-login-endpoint', 'next', 'api-login'),
    edge('al2', 'api-login', 'success', 'api-login-ok'),
    edge('al3', 'api-login', 'result', 'api-login-ok', 'body', 'value'),
    edge('al4', 'api-login', 'error', 'api-login-error'),
    edge('al5', 'api-login', 'error_message', 'api-login-error', 'body', 'value'),

    edge('ap1', 'api-protected-endpoint', 'next', 'api-check'),
    edge('ap2', 'api-check', 'true', 'api-user'),
    edge('ap3', 'api-check', 'false', 'api-protected-denied'),
    edge('ap4', 'api-user', 'found', 'api-protected-ok'),
    edge('ap5', 'api-user', 'not_logged_in', 'api-protected-denied'),
    edge('ap6', 'api-user', 'username', 'api-protected-ok', 'body', 'value'),

    edge('ao1', 'api-logout-endpoint', 'next', 'api-logout'),
    edge('ao2', 'api-logout', 'logged_out', 'api-logout-ok'),
    edge('ao3', 'api-logout', 'not_logged_in', 'api-logout-ok')
  ];
  const crossWorkspace = {
    id: 'cross-auth', name: 'Shared browser authentication', active: true,
    blocks: [
      node('cross-database-path', 'text', { text: database }),
      node('cross-receiver-id', 'text', { text: 'cross-browser-auth' }),
      node('cross-receiver', 'receiver', {}),
      node('cross-check', 'check_if_logged_in', { database: './unused-auth.sqlite' }),
      node('cross-login', 'display_login', { database: './unused-auth.sqlite' }),
      node('cross-user', 'get_current_logged_in_user', { database: './unused-auth.sqlite', sessionType: 'Browser' }),
      reply('cross-ok', 200, 'Text', 'missing user')
    ],
    connections: [
      edge('cr1', 'cross-receiver-id', 'text', 'cross-receiver', 'id', 'value'),
      edge('cr2', 'cross-receiver', 'action', 'cross-check'),
      edge('cr3', 'cross-check', 'false', 'cross-login'),
      edge('cr4', 'cross-check', 'true', 'cross-user'),
      edge('cr5', 'cross-login', 'authenticated', 'cross-user'),
      edge('cr6', 'cross-user', 'found', 'cross-ok'),
      edge('cr7', 'cross-user', 'username', 'cross-ok', 'body', 'value'),
      edge('cr8', 'cross-database-path', 'text', 'cross-check', 'database', 'value'),
      edge('cr9', 'cross-database-path', 'text', 'cross-login', 'database', 'value'),
      edge('cr10', 'cross-database-path', 'text', 'cross-user', 'database', 'value')
    ]
  };
  const document = { version: 1, name: 'Secured application', workspaces: [{ id: 'main', name: 'Main', active: true, blocks, connections }, crossWorkspace] };
  const errors = [];
  const app = createApp({ directory, document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')), onError: error => errors.push(error) });
  const address = await app.start(0, '127.0.0.1');
  t.after(async () => { await app.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${address.port}`;

  const loginPage = await fetch(base + '/protected');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.headers.get('content-type'), /^text\/html/);
  assert.match(loginPage.headers.get('content-security-policy'), /form-action 'self'/);
  const loginHTML = await loginPage.text();
  assert.match(loginHTML, /OpacIT Omphalos/);
  assert.match(loginHTML, /Phidias · Secured application/);
  assert.match(loginHTML, /autocomplete="current-password"/);

  const wrongLogin = await fetch(base + '/protected', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'alice', password: 'wrong-password' })
  });
  assert.equal(wrongLogin.status, 401);
  assert.equal(wrongLogin.headers.get('set-cookie'), null);
  assert.match(await wrongLogin.text(), /Invalid username or password/);

  const browserLogin = await fetch(base + '/protected', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'alice', password: 'a-secure-test-password' })
  });
  assert.equal(browserLogin.status, 303);
  assert.equal(browserLogin.headers.get('location'), '/protected');
  const setCookie = browserLogin.headers.get('set-cookie');
  assert.match(setCookie, /^phidias_session=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Expires=|Max-Age=/i);
  const browserCookie = setCookie.split(';')[0];
  const protectedPage = await fetch(base + '/protected', { headers: { cookie: browserCookie } });
  assert.equal(protectedPage.status, 200);
  assert.equal(await protectedPage.text(), 'alice');

  const crossLoginPage = await fetch(base + '/cross-protected');
  assert.equal(crossLoginPage.status, 200);
  assert.match(crossLoginPage.headers.get('content-type'), /^text\/html/);
  const crossLogin = await fetch(base + '/cross-protected', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'alice', password: 'a-secure-test-password' })
  });
  assert.equal(crossLogin.status, 303);
  assert.equal(crossLogin.headers.get('location'), '/cross-protected');
  const crossCookie = crossLogin.headers.get('set-cookie').split(';')[0];
  const crossProtectedPage = await fetch(base + '/cross-protected', { headers: { cookie: crossCookie } });
  assert.equal(crossProtectedPage.status, 200);
  assert.equal(await crossProtectedPage.text(), 'alice');
  const nonLoginPost = await fetch(base + '/protected', { method: 'POST', headers: { cookie: browserCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
  assert.equal(nonLoginPost.status, 401);
  assert.match(await nonLoginPost.text(), /Invalid username or password/);

  const browserLogout = await fetch(base + '/browser-logout', { method: 'POST', headers: { cookie: browserCookie } });
  assert.equal(browserLogout.status, 200);
  assert.match(browserLogout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(base + '/protected', { headers: { cookie: browserCookie } })).headers.get('content-type').startsWith('text/html'), true);

  const failedAPI = await fetch(base + '/api-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'wrong-password' }) });
  assert.equal(failedAPI.status, 401);
  assert.deepEqual(await failedAPI.json(), 'Invalid username or password.');

  const apiLogin = await fetch(base + '/api-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'a-secure-test-password' }) });
  assert.equal(apiLogin.status, 200);
  const apiSession = await apiLogin.json();
  assert.match(apiSession.token, /^[a-f0-9]{64}$/);
  assert.equal(apiSession.token_type, 'Bearer');
  assert.equal(apiSession.username, 'alice');
  assert.ok(apiSession.expires_at > Date.now());

  assert.equal((await fetch(base + '/api-protected')).status, 401);
  const authorization = `Bearer ${apiSession.token}`;
  const apiProtected = await fetch(base + '/api-protected', { headers: { authorization } });
  assert.equal(apiProtected.status, 200);
  assert.equal(await apiProtected.text(), 'alice');

  const apiLogout = await fetch(base + '/api-logout', { method: 'POST', headers: { authorization } });
  assert.equal(apiLogout.status, 200);
  assert.equal((await fetch(base + '/api-protected', { headers: { authorization } })).status, 401);
  assert.deepEqual(errors, []);
});

test('login blocks enforce the project and RC or Prod identity packaged in config.json', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-workflow-acl-'));
  const database = path.join(directory, 'auth.sqlite'), projectId = crypto.randomUUID();
  const auth = new Auth(database);
  await auth.createUser('admin', 'admin-secure-password');
  await auth.createUser('rc-user', 'rc-user-secure-password');
  const rcUser = auth.user('rc-user');
  auth.setGrants('user', rcUser.id, projectId, ['login_rc']);
  auth.close();
  const blocks = [
    node('db', 'text', { text: database }),
    node('endpoint', 'http', { method: 'GET', path: '/login' }),
    node('login', 'display_login', { database: './unused.sqlite' }),
    reply('ok', 200, 'Text', 'signed in')
  ];
  const document = { version: 1, name: 'ACL app', workspaces: [{ id: 'main', name: 'Main', active: true, blocks, connections: [
    edge('db-login', 'db', 'text', 'login', 'database', 'value'), edge('start', 'endpoint', 'next', 'login'), edge('done', 'login', 'authenticated', 'ok')
  ] }] };
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const writeConfig = channel => fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ port: 3001, host: '127.0.0.1', 'log-level': 3, 'project-id': projectId, 'release-channel': channel }));
  const submit = (base, username, password) => fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }) });

  await writeConfig('RC');
  let app = createApp({ directory, document: structuredClone(document), definitions: new Map(definitions) });
  let address = await app.start(0, '127.0.0.1');
  assert.equal((await submit(`http://127.0.0.1:${address.port}`, 'rc-user', 'rc-user-secure-password')).status, 303);
  await app.stop();

  await writeConfig('Prod');
  app = createApp({ directory, document: structuredClone(document), definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  address = await app.start(0, '127.0.0.1');
  t.after(async () => { await app.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await submit(`http://127.0.0.1:${address.port}`, 'rc-user', 'rc-user-secure-password')).status, 403);
  assert.equal((await submit(`http://127.0.0.1:${address.port}`, 'admin', 'admin-secure-password')).status, 303);
});
