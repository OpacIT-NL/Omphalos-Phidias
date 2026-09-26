'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const argon2 = require('argon2');
const { Auth } = require('../lib/auth');
const { defaultConfig, ConfigState, loadConfig } = require('../lib/config');
const { CommandConsole } = require('../lib/console');
const { createLogger } = require('../lib/logger');
const password = 'test-console-password-123';
async function fixture(t, apply) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-console-'));
  const file = path.join(folder, 'config.json');
  await fs.writeFile(file, JSON.stringify(defaultConfig()));
  const database = path.join(folder, 'auth.sqlite'), auth = new Auth(database);
  const config = new ConfigState(file, apply), messages = [], answers = [], questions = [];
  let shutdowns = 0;
  const engine = new CommandConsole({ config, auth, logger: createLogger({ level: 0, directory: path.join(folder, 'logs') }),
    write: text => messages.push(text), ask: async (prompt, secret) => { questions.push({ prompt, secret }); if (!answers.length) throw new Error('No test answer'); return answers.shift(); },
    shutdown: async () => { shutdowns++; }, status: () => 'Test listener'
  });
  t.after(async () => { auth.close(); await fs.rm(folder, { recursive: true, force: true }); });
  return { engine, config, auth, messages, answers, questions, file, database, shutdowns: () => shutdowns };
}
test('console modes, privilege boundaries, aliases, do, and redacted configuration', async t => {
  const { engine, config, messages, answers, file, questions } = await fixture(t);
  assert.equal(engine.prompt, 'Console$> ');
  await engine.execute('port 8080'); await engine.execute('copy run start');
  assert.equal(config.running.port, 3000); assert.equal(engine.mode, 'disabled');
  await engine.execute('en'); assert.equal(engine.prompt, 'Console#> ');
  await engine.execute('conf t'); assert.equal(engine.prompt, 'Config#> ');
  await engine.execute('port 8080'); assert.equal(config.running.port, 8080);
  await engine.execute('copy run start'); assert.equal(JSON.parse(await fs.readFile(file)).port, 3000);
  answers.push(password, password); await engine.execute('enable secret');
  assert.equal(await argon2.verify(config.running.console.enablePasswordHash, password), true);
  await engine.execute('do show run');
  assert.ok(messages.join('\n').includes('[configured; hidden]'));
  assert.ok(!messages.join('\n').includes(password)); assert.ok(!messages.join('\n').includes('$argon2id$'));
  assert.ok(questions.every(question => question.secret));
  await engine.execute('do copy run start'); assert.equal(engine.mode, 'config');
  assert.equal(JSON.parse(await fs.readFile(file)).port, 8080);
  await engine.execute('exit'); assert.equal(engine.prompt, 'Console#> ');
  await engine.execute('dis'); assert.equal(engine.prompt, 'Console$> ');
  answers.push('incorrect'); await engine.execute('enable'); assert.equal(engine.mode, 'disabled');
  answers.push(password); await engine.execute('enable'); assert.equal(engine.mode, 'enabled');
  await engine.execute('config terminal'); await engine.execute('do show status'); assert.equal(engine.mode, 'config');
  await engine.execute('do disable'); assert.equal(engine.mode, 'disabled');
});
test('running settings are validated, applied, explicitly saved, and loaded without require cache', async t => {
  const applied = [];
  const { engine, config, file } = await fixture(t, async next => { if (next.port === 9999) throw new Error('Port in use'); applied.push(next); });
  await engine.execute('enable'); await engine.execute('configure terminal');
  await engine.execute('port 9999'); assert.equal(config.running.port, 3000);
  for (const command of ['port 0', 'port 65536', 'host localhost', 'log-level 5', 'log-level 1.5', 'auth secure-cookies maybe']) await engine.execute(command);
  assert.deepEqual(config.running, defaultConfig());
  await engine.execute('host ::1'); await engine.execute('port 8081'); await engine.execute('log-level 4');
  await engine.execute('projects-directory "project storage"'); await engine.execute('auth database "private data/users.sqlite"'); await engine.execute('auth secure-cookies true');
  assert.equal(config.running.host, '::1'); assert.equal(config.running['projects-directory'], 'project storage');
  assert.equal(config.running.auth.secureCookies, true); assert.ok(applied.length >= 6);
  assert.equal(loadConfig(file).port, 3000);
  await engine.execute('exit'); await engine.execute('copy running-config startup-config');
  assert.equal(loadConfig(file).port, 8081); assert.equal(loadConfig(file).logLevel, 4); assert.equal(config.dirty(), false);
  assert.equal(new ConfigState(file).running.auth.database, 'private data/users.sqlite');
});
test('accounts run before save, remain outside config.json, and persist with their sessions on copy run start', async t => {
  const { engine, auth, answers, file, database } = await fixture(t);
  await engine.execute('enable'); await engine.execute('conf t');
  answers.push(password, password); await engine.execute('username alice');
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  const session = await auth.login('alice', password, 'localhost');
  const request = { headers: { cookie: `sentinel_session=${session.token}` } };
  assert.equal(auth.session(request).username, 'alice');
  const before = new Auth(database); assert.equal(before.runningUser('alice'), null); before.close();
  await engine.execute('do copy run start');
  assert.equal(auth.pendingUsers.size, 0); assert.equal(auth.volatileSessions.size, 0);
  assert.ok(!String(await fs.readFile(file)).includes('alice')); assert.ok(!String(await fs.readFile(file)).includes(password));
  const after = new Auth(database);
  assert.match(after.runningUser('alice').password_hash, /^\$argon2id\$/); assert.equal(after.session(request).username, 'alice'); after.close();
  answers.push('a replacement password', 'a replacement password'); await engine.execute('user password alice');
  assert.equal(auth.session(request), null);
  await assert.rejects(auth.login('alice', password, 'localhost'), { status: 401 });
  assert.ok(await auth.login('alice', 'a replacement password', 'localhost'));
  // Unsaved password changes are discarded by a restart.
  const restarted = new Auth(database); assert.ok(await restarted.login('alice', password, 'localhost')); restarted.close();
  await engine.execute('do copy run start');
  const saved = new Auth(database); await assert.rejects(saved.login('alice', password, 'localhost'), { status: 401 }); saved.close();
  await engine.execute('no username alice'); assert.equal(auth.listUsers().length, 0);
  await engine.execute('do copy run start'); assert.equal(auth.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});
test('failed save leaves staged accounts available and startup unchanged', async t => {
  const { engine, config, auth, answers, file, messages } = await fixture(t);
  await engine.execute('enable'); await engine.execute('conf t');
  answers.push(password, password); await engine.execute('user create alice');
  await engine.execute('port 8080');
  config.file = path.join(path.dirname(file), 'missing.json');
  await engine.execute('do copy run start');
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.equal(auth.pendingUsers.size, 1); assert.equal(loadConfig(file).port, 3000);
  assert.ok(messages.at(-1).startsWith('%'));
  config.file = file; await engine.execute('do copy run start');
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
});
test('shutdown requires enabled privileges and confirmation for unsaved changes', async t => {
  const { engine, answers, shutdowns } = await fixture(t);
  await engine.execute('shutdown'); assert.equal(shutdowns(), 0);
  await engine.execute('enable'); await engine.execute('conf t'); await engine.execute('port 8080');
  await engine.execute('shutdown'); assert.equal(shutdowns(), 0);
  answers.push('no'); await engine.execute('do shutdown'); assert.equal(shutdowns(), 0);
  answers.push('yes'); await engine.execute('do shutdown'); assert.equal(shutdowns(), 1); assert.equal(engine.stopped, true);
});
test('enable password authentication is rate limited and can be removed in config mode', async t => {
  const { engine, answers, questions, config } = await fixture(t);
  await engine.execute('enable'); await engine.execute('conf t'); answers.push(password, password); await engine.execute('enable password');
  await engine.execute('dis');
  answers.push('wrong', 'wrong', 'wrong');
  for (let i = 0; i < 3; i++) await engine.execute('enable');
  const count = questions.length;
  await engine.execute('enable'); assert.equal(questions.length, count); assert.equal(engine.mode, 'disabled');
  engine.enableBlockedUntil = 0; answers.push(password); await engine.execute('enable');
  await engine.execute('conf t'); await engine.execute('no enable password'); assert.equal(config.running.console.enablePasswordHash, null);
  await engine.execute('dis'); await engine.execute('enable'); assert.equal(engine.mode, 'enabled');
});


test('enable passwords have no length or complexity requirements', async t => {
  const { engine, answers, config } = await fixture(t);
  await engine.execute('enable'); await engine.execute('conf t');
  answers.push('x', 'x'); await engine.execute('enable secret');
  assert.equal(await argon2.verify(config.running.console.enablePasswordHash, 'x'), true);
  await engine.execute('disable'); answers.push('x'); await engine.execute('enable');
  assert.equal(engine.mode, 'enabled');
  await engine.execute('conf t'); answers.push('', ''); await engine.execute('enable password');
  assert.equal(await argon2.verify(config.running.console.enablePasswordHash, ''), true);
  await engine.execute('disable'); answers.push(''); await engine.execute('enable');
  assert.equal(engine.mode, 'enabled');
});

test('help and question-mark show the current mode, and do help lists enabled commands', async t => {
  const { engine, messages } = await fixture(t);
  await engine.execute('help'); assert.match(messages.at(-1), /enable/); assert.doesNotMatch(messages.at(-1), /copy run start/);
  await engine.execute('?'); assert.equal(messages.at(-1), messages.at(-2));
  await engine.execute('enable'); await engine.execute('help');
  assert.match(messages.at(-1), /copy run start/); assert.match(messages.at(-1), /shutdown/);
  await engine.execute('conf t'); await engine.execute('?');
  assert.match(messages.at(-1), /host <IPv4\/IPv6>/); assert.match(messages.at(-1), /username/);
  await engine.execute('do help'); assert.match(messages.at(-1), /show running-config/); assert.equal(engine.mode, 'config');
});
