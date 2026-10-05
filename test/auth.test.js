'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const argon2 = require('argon2');
const { DatabaseSync } = require('node:sqlite');
const { Auth } = require('../lib/auth');
const { createServer } = require('../server');
const { createLogger } = require('../lib/logger');
const password = 'correct horse battery staple';
const request = token => ({ headers: { cookie: `sentinel_session=${token}` } });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-auth-'));
  const filename = path.join(directory, 'auth.sqlite');
  const auth = new Auth(filename, { secureCookies: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { auth, filename, directory };
}

test('ACL migration preserves existing users and grants them administrator access', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-auth-migration-')), filename = path.join(directory, 'auth.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)');
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 });
  legacy.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run('existing', hash, Date.now()); legacy.close();
  const auth = new Auth(filename); t.after(() => { auth.close(); return fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('existing').count, 1);
  assert.equal(auth.hasCore('existing', 'manage_users'), true);
  assert.equal(auth.hasProject('existing', crypto.randomUUID(), 'delete'), true);
  assert.equal((await auth.login('existing', password, '127.0.0.1')).username, 'existing');
});

test('SQLite persists salted Argon2id hashes and hashed sessions across restart', async t => {
  const { auth, filename } = await fixture(t);
  let current = auth; t.after(() => current.close());
  await auth.createUser('Alice', password); await auth.createUser('Bob', password);
  const users = auth.db.prepare('SELECT username, password_hash FROM users ORDER BY username').all();
  assert.equal(users[0].username, 'alice');
  for (const user of users) {
    assert.match(user.password_hash, /^\$argon2id\$v=19\$/);
    assert.deepEqual(Object.fromEntries(user.password_hash.split('$')[3].split(',').map(part => part.split('='))), { m: '65536', t: '3', p: '1' });
    assert.equal(await argon2.verify(user.password_hash, password), true);
  }
  assert.notEqual(users[0].password_hash, users[1].password_hash);
  if (process.platform !== 'win32') assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  const session = await auth.login('ALICE', password, '127.0.0.1');
  const row = auth.db.prepare('SELECT * FROM sessions').get();
  assert.equal(row.token_hash, crypto.createHash('sha256').update(session.token).digest('hex'));
  assert.notEqual(row.token_hash, session.token);
  assert.match(auth.cookie(session.token), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  auth.close(); current = new Auth(filename, { secureCookies: true });
  assert.equal(current.session(request(session.token)).username, 'alice');
  assert.equal(current.session(request('made-up-token')), null);
  assert.equal((await current.login('alice', password, '127.0.0.1')).username, 'alice');
});

test('expiration, logout and password reset revoke sessions', async t => {
  const { auth } = await fixture(t); t.after(() => auth.close()); await auth.createUser('alice', password);
  const first = await auth.login('alice', password, 'localhost');
  const second = await auth.login('alice', password, 'localhost');
  assert.notEqual(first.token, second.token); assert.notEqual(first.csrfToken, second.csrfToken);
  auth.logout(request(first.token)); assert.equal(auth.session(request(first.token)), null);
  assert.ok(auth.session(request(second.token)));
  auth.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal(auth.session(request(second.token)), null);
  const third = await auth.login('alice', password, 'localhost');
  await auth.resetPassword('alice', 'a completely new password');
  assert.equal(auth.session(request(third.token)), null);
  await assert.rejects(auth.login('alice', password, 'localhost'), { status: 401 });
  assert.ok(await auth.login('alice', 'a completely new password', 'localhost'));
});

test('password and username policy, SQL injection resistance, no duplicate users', async t => {
  const { auth } = await fixture(t); t.after(() => auth.close());
  await assert.rejects(auth.createUser('alice', 'short'), /at least 12/);
  await assert.rejects(auth.createUser('alice', 'a'.repeat(1025)), /1,024/);
  await assert.rejects(auth.createUser("admin' OR 1=1 --", password), /username/);
  await auth.createUser('alice', password);
  await assert.rejects(auth.createUser('ALICE', password), /already exists/);
  await assert.rejects(auth.resetPassword('missing', password), /not found/);
  await assert.rejects(auth.login("admin' OR 1=1 --", password, 'localhost'), { status: 401 });
  await assert.rejects(auth.login('alice', 'a'.repeat(1025), 'localhost'), { status: 401 });
});

test('failed-login rate limits survive restart and expire', async t => {
  const { auth, filename } = await fixture(t);
  let current = auth; t.after(() => current.close());
  for (let i = 0; i < 10; i++) await assert.rejects(current.login('unknown', 'incorrect', 'localhost'), { status: 401 });
  await assert.rejects(current.login('unknown', 'incorrect', 'other-ip'), error => error.status === 429 && error.retryAfter > 0);
  auth.close(); current = new Auth(filename);
  await assert.rejects(current.login('unknown', 'incorrect', 'other-ip'), { status: 429 });
  current.db.prepare('UPDATE login_limits SET expires_at = ?').run(Date.now() - 1);
  await assert.rejects(current.login('unknown', 'incorrect', 'localhost'), { status: 401 });
  for (let i = 0; i < 20; i++) current.consumeAttempt('shared-ip', `user-${i}`);
  assert.throws(() => current.consumeAttempt('shared-ip', 'another-user'), { status: 429 });
});

test('HTTP login rotates sessions, sets secure cookies, and returns retry guidance', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-auth-http-'));
  const { server, auth } = await createServer({ directory: path.join(directory, 'projects'), authDatabase: path.join(directory, 'auth.sqlite'), secureCookies: true, logger: createLogger({ level: 0, directory: path.join(directory, 'logs') }) });
  await auth.createUser('alice', password);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = cookie => fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ username: 'alice', password }) });
  const first = await login(); assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /; Secure/);
  const firstCookie = first.headers.get('set-cookie').split(';')[0];
  const second = await login(firstCookie); assert.equal(second.status, 200);
  assert.notEqual(second.headers.get('set-cookie'), first.headers.get('set-cookie'));
  assert.equal((await fetch(base + '/api/session', { headers: { cookie: firstCookie } })).status, 401);
  auth.db.prepare('UPDATE login_limits SET attempts = 100').run();
  const limited = await login(); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
