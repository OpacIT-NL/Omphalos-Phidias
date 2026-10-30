'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const argon2 = require('../lib/password-hash');
const { LocalDatabaseAuth } = require('../runtime/local-auth');
const { createApp, loadDefinitions } = require('../runtime/app');

const node = (id, type, options = {}) => ({ id, type, x: 0, y: 0, options });
const edge = (id, from, output, to, input = 'action', kind = 'action') => ({ id, from, output, to, input, kind });
const reply = (id, body) => node(id, 'respond', { status: 200, format: 'Text', body, headers: '{}' });

test('local database authentication reads only the required users columns and keeps ordinary sessions in memory', async () => {
  const passwordHash = await argon2.hash('correct horse battery staple', { type: argon2.argon2id });
  const queries = [];
  const database = {
    async execute(sql, parameters) {
      queries.push({ sql, parameters });
      return [[parameters[0] === 'alice' ? { id: 42, username: 'alice', password_hash: passwordHash, allow_login: 1, ignored: 'value' } : undefined].filter(Boolean), []];
    }
  };
  const authentication = new LocalDatabaseAuth(database, { cookieName: 'local_test_session' });

  await assert.rejects(authentication.login('alice', 'wrong password', '127.0.0.1'), /Invalid username or password/);
  const loggedIn = await authentication.login('alice', 'correct horse battery staple', '127.0.0.1');
  assert.equal(loggedIn.userid, '42');
  assert.equal(loggedIn.username, 'alice');
  assert.match(loggedIn.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(queries.map(query => query.sql), [
    'SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1',
    'SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1'
  ]);
  assert.deepEqual(queries.map(query => query.parameters), [['alice'], ['alice']]);

  const request = { headers: { cookie: authentication.browserCookie(loggedIn.token).split(';')[0] } };
  const browserSession = await authentication.browserSession(request);
  assert.equal(browserSession.userid, '42');
  assert.equal(browserSession.username, 'alice');
  assert.ok(browserSession.expiresAt >= loggedIn.expiresAt);
  assert.equal((await authentication.logout(request)).userid, '42');
  assert.equal(await authentication.browserSession(request), null);
  authentication.close();
});

test('local database authentication refuses an account when allow_login is 0', async () => {
  const passwordHash = await argon2.hash('correct horse battery staple', { type: argon2.argon2id });
  const database = {
    async execute() {
      return [[{ id: 42, username: 'alice', password_hash: passwordHash, allow_login: 0 }], []];
    }
  };
  const authentication = new LocalDatabaseAuth(database);
  await assert.rejects(
    authentication.login('alice', 'correct horse battery staple', '127.0.0.1'),
    error => error?.status === 403 && /not allowed to sign in/.test(error.message)
  );
  assert.equal(authentication.sessions.size, 0);
  authentication.close();
});

test('local account registration validates consent and stores an Argon2id password hash', async () => {
  const inserts = [];
  const database = {
    async execute(sql, parameters) {
      inserts.push({ sql, parameters });
      return [{ insertId: 91 }, []];
    }
  };
  const authentication = new LocalDatabaseAuth(database);
  const account = {
    username: 'New.User', email: 'Person@Example.TEST', password: 'a-long-registration-password',
    confirmPassword: 'a-long-registration-password', acceptTerms: true, acceptPrivacy: true
  };

  await assert.rejects(authentication.register({ ...account, confirmPassword: 'different-password' }, '127.0.0.1'), /passwords do not match/);
  await assert.rejects(authentication.register({ ...account, acceptTerms: false }, '127.0.0.1'), /accept the terms/);
  await assert.rejects(authentication.register({ ...account, acceptPrivacy: false }, '127.0.0.1'), /accept the privacy policy/);
  assert.equal(inserts.length, 0);

  const session = await authentication.register(account, '127.0.0.1');
  assert.equal(session.userid, '91');
  assert.equal(session.username, 'new.user');
  assert.equal(session.email, 'person@example.test');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].sql, 'INSERT INTO `users` (`username`,`email`,`password_hash`,`allow_login`) VALUES (?,?,?,1)');
  assert.equal(inserts[0].parameters[0], 'new.user');
  assert.equal(inserts[0].parameters[1], 'person@example.test');
  assert.match(inserts[0].parameters[2], /^\$argon2id\$/);
  assert.notEqual(inserts[0].parameters[2], account.password);
  assert.equal(await argon2.verify(inserts[0].parameters[2], account.password), true);
  authentication.close();
});

test('Login Local, local session check, userid output, and Logout Local work through an HTTP workflow', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-local-auth-'));
  await fs.cp(path.resolve(__dirname, '../defaults/templates'), path.join(directory, 'html'), { recursive: true });
  const authDatabase = path.join(directory, 'unrelated-builder-auth.sqlite');
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port: 3001,
    host: '127.0.0.1',
    'log-level': 3,
    auth: { database: authDatabase },
    'project-id': '00000000-0000-4000-8000-000000000042',
    'release-channel': 'RC'
  }));

  const passwordHash = await argon2.hash('application-password', { type: argon2.argon2id });
  const queries = [];
  const applicationDatabase = {
    async execute(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.startsWith('INSERT INTO `users`')) return [{ insertId: 7002 }, []];
      return [[parameters[0] === 'local-user' ? { id: 7001, username: 'local-user', password_hash: passwordHash, allow_login: 1 } : undefined].filter(Boolean), []];
    }
  };
  const blocks = [
    node('protected-endpoint', 'http', { method: 'GET', path: '/local' }),
    node('local-check', 'check_if_user_is_logged_in_local'),
    node('local-login', 'login_local'),
    reply('protected-response', 'missing id'),
    node('logout-endpoint', 'http', { method: 'POST', path: '/local-logout' }),
    node('local-logout', 'logout_local'),
    reply('logout-response', 'logged out'),
    node('register-endpoint', 'http', { method: 'GET', path: '/register' }),
    node('local-register', 'register_local_account'),
    reply('register-response', 'missing registration id')
  ];
  const connections = [
    edge('p1', 'protected-endpoint', 'next', 'local-check'),
    edge('p2', 'local-check', 'false', 'local-login'),
    edge('p3', 'local-check', 'true', 'protected-response'),
    edge('p4', 'local-check', 'userid', 'protected-response', 'body', 'value'),
    edge('p5', 'local-login', 'authenticated', 'protected-response'),
    edge('l1', 'logout-endpoint', 'next', 'local-logout'),
    edge('l2', 'local-logout', 'logged_out', 'logout-response'),
    edge('l3', 'local-logout', 'not_logged_in', 'logout-response'),
    edge('r1', 'register-endpoint', 'next', 'local-register'),
    edge('r2', 'local-register', 'registered', 'register-response'),
    edge('r3', 'local-register', 'userid', 'register-response', 'body', 'value')
  ];
  const document = { version: 1, name: 'Local users', workspaces: [{ id: 'main', name: 'Main', active: true, blocks, connections }] };
  const app = createApp({
    directory,
    document,
    definitions: loadDefinitions(path.resolve(__dirname, '../blocks')),
    databaseProvider: async () => applicationDatabase
  });
  const address = await app.start(0, '127.0.0.1');
  t.after(async () => { await app.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${address.port}`;

  const loginPage = await fetch(base + '/local');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.headers.get('content-type'), /^text\/html/);
  assert.match(await loginPage.text(), /name="remember_me"/);

  const rejected = await fetch(base + '/local', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'local-user', password: 'wrong' })
  });
  assert.equal(rejected.status, 401);
  assert.match(await rejected.text(), /Invalid username or password/);

  const accepted = await fetch(base + '/local', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'local-user', password: 'application-password' })
  });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get('location'), '/local');
  const setCookie = accepted.headers.get('set-cookie');
  assert.match(setCookie, /^phidias_local_session_[a-z0-9_]+=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];

  const protectedPage = await fetch(base + '/local', { headers: { cookie } });
  assert.equal(protectedPage.status, 200);
  assert.equal(await protectedPage.text(), '7001');

  const loggedOut = await fetch(base + '/local-logout', { method: 'POST', headers: { cookie } });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  const loginTemplateFile = path.join(directory, 'html', 'login.html');
  const loginCSSFile = path.join(directory, 'html', 'login.css');
  await fs.writeFile(loginTemplateFile, (await fs.readFile(loginTemplateFile, 'utf8')).replace('<h1>Sign in</h1>', '<h1>Customized sign in</h1>'));
  await fs.appendFile(loginCSSFile, '\n.auth-card { outline: 3px solid rgb(1 2 3); }\n');
  const afterLogout = await fetch(base + '/local', { headers: { cookie } });
  assert.match(afterLogout.headers.get('content-type'), /^text\/html/);
  const customizedLoginHTML = await afterLogout.text();
  assert.match(customizedLoginHTML, /Customized sign in/);
  assert.match(customizedLoginHTML, /outline: 3px solid rgb\(1 2 3\)/);

  const registrationTemplateFile = path.join(directory, 'html', 'register.html');
  await fs.writeFile(registrationTemplateFile, (await fs.readFile(registrationTemplateFile, 'utf8')).replace('<h1>Create account</h1>', '<h1>Customized registration</h1>'));
  const registrationPage = await fetch(base + '/register');
  assert.equal(registrationPage.status, 200);
  const registrationHTML = await registrationPage.text();
  assert.match(registrationHTML, /Customized registration/);
  assert.match(registrationHTML, /name="username"/);
  assert.match(registrationHTML, /name="email" type="email"/);
  assert.match(registrationHTML, /name="password" type="password"/);
  assert.match(registrationHTML, /name="confirm_password" type="password"/);
  assert.match(registrationHTML, /name="accept_terms"[^>]+required/);
  assert.match(registrationHTML, /href="\/tos"/);
  assert.match(registrationHTML, /name="accept_privacy"[^>]+required/);
  assert.match(registrationHTML, /href="\/privacy"/);

  const registrationValues = {
    username: 'New.User', email: 'New@Example.Test', password: 'new-application-password',
    confirm_password: 'new-application-password', accept_terms: 'yes', accept_privacy: 'yes'
  };
  const mismatch = await fetch(base + '/register', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...registrationValues, confirm_password: 'does-not-match' })
  });
  assert.equal(mismatch.status, 400);
  assert.match(await mismatch.text(), /passwords do not match/);

  const missingPrivacy = await fetch(base + '/register', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(registrationValues).filter(([key]) => key !== 'accept_privacy')))
  });
  assert.equal(missingPrivacy.status, 400);
  assert.match(await missingPrivacy.text(), /accept the privacy policy/);

  const registered = await fetch(base + '/register', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(registrationValues)
  });
  assert.equal(registered.status, 303);
  assert.equal(registered.headers.get('location'), '/register');
  const registrationCookie = registered.headers.get('set-cookie').split(';')[0];
  const registeredPage = await fetch(base + '/register', { headers: { cookie: registrationCookie } });
  assert.equal(registeredPage.status, 200);
  assert.equal(await registeredPage.text(), '7002');

  const selectQueries = queries.filter(query => query.sql === 'SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1');
  assert.equal(selectQueries.length, 2);
  for (const query of selectQueries) {
    assert.equal(query.sql, 'SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1');
    assert.deepEqual(query.parameters, ['local-user']);
  }
  const insertQueries = queries.filter(query => query.sql.startsWith('INSERT'));
  assert.equal(insertQueries.length, 1);
  assert.equal(insertQueries[0].sql, 'INSERT INTO `users` (`username`,`email`,`password_hash`,`allow_login`) VALUES (?,?,?,1)');
  assert.deepEqual(insertQueries[0].parameters.slice(0, 2), ['new.user', 'new@example.test']);
  assert.match(insertQueries[0].parameters[2], /^\$argon2id\$/);
  assert.equal(await argon2.verify(insertQueries[0].parameters[2], registrationValues.password), true);
});

test('local authentication blocks have no auth database options and expose userid as text', () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  for (const type of ['login_local', 'logout_local', 'check_if_user_is_logged_in_local', 'register_local_account']) {
    const definition = definitions.get(type);
    assert.ok(definition);
    assert.equal(definition.fields.some(field => field.key === 'database'), false);
    assert.equal(definition.inputPorts.some(port => port.id === 'database'), false);
  }
  const userid = definitions.get('check_if_user_is_logged_in_local').outputPorts.find(port => port.id === 'userid');
  assert.deepEqual(userid.types, ['text']);
});
