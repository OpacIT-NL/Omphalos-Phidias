'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLogger, LEVELS } = require('../lib/logger');
const { createServer } = require('../server');

async function directory(t) {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-logs-'));
  t.after(() => fs.rm(value, { recursive: true, force: true }));
  return value;
}
function capture() {
  const lines = [];
  return { lines, stdout: { write: line => lines.push(line) }, stderr: { write: line => lines.push(line) } };
}
for (let level = 0; level <= 4; level++) {
  test(`log level ${level} writes exactly the cumulative levels to console and its launch file`, async t => {
    const folder = await directory(t), output = capture();
    const logger = createLogger({ level, directory: folder, ...output, now: () => new Date('2026-09-26T12:34:56.000Z') });
    for (const name of Object.keys(LEVELS)) logger[name]('Message %s', name);
    assert.equal(path.basename(logger.filename), '2026-09-26-1.txt');
    const file = await fs.readFile(logger.filename, 'utf8');
    assert.equal(file, output.lines.join(''));
    assert.equal(output.lines.length, level + 1);
    for (const [name, severity] of Object.entries(LEVELS)) assert.equal(file.includes(`[${name.toUpperCase()}]`), severity <= level);
    assert.match(file, /^2026-09-26T12:34:56\.000Z \[CRITICAL\] Message critical/);
  });
}
test('console and file levels filter independently and can change while running', async t => {
  const folder = await directory(t), output = capture();
  const logger = createLogger({ level: 1, fileLevel: 4, directory: folder, ...output, now: () => new Date('2026-09-26T12:34:56.000Z') });
  logger.error('Both destinations');
  logger.info('File only');
  logger.debug('Debug file only');
  assert.doesNotMatch(output.lines.join(''), /File only|Debug file only/);
  let file = await fs.readFile(logger.filename, 'utf8');
  assert.match(file, /Both destinations/); assert.match(file, /File only/); assert.match(file, /Debug file only/);
  logger.setLevel(4); logger.setFileLevel(0);
  logger.info('Console only');
  assert.match(output.lines.join(''), /Console only/);
  file = await fs.readFile(logger.filename, 'utf8');
  assert.doesNotMatch(file, /Console only/);
});
test('each logger launch gets the next daily file and keeps multiline entries on one line', async t => {
  const folder = await directory(t), output = capture();
  let time = new Date('2026-09-26T23:59:59Z');
  const options = { directory: folder, ...output, now: () => time };
  const firstLogger = createLogger(options);
  firstLogger.info('First entry');
  const secondLogger = createLogger(options);
  secondLogger.warning('Second entry\nforged log\r\u001b');
  time = new Date('2026-09-27T00:00:00Z');
  firstLogger.error(new Error('Third entry'));
  const thirdLogger = createLogger(options);
  thirdLogger.info('New date');
  assert.equal(path.basename(firstLogger.filename), '2026-09-26-1.txt');
  assert.equal(path.basename(secondLogger.filename), '2026-09-26-2.txt');
  assert.equal(path.basename(thirdLogger.filename), '2026-09-27-1.txt');
  assert.match(await fs.readFile(firstLogger.filename, 'utf8'), /First entry[\s\S]*\[ERROR\] Error: Third entry/);
  assert.match(await fs.readFile(secondLogger.filename, 'utf8'), /Second entry\\nforged log\\r\\u001b/);
  assert.match(await fs.readFile(thirdLogger.filename, 'utf8'), /New date/);
});
test('invalid log levels are rejected; file failures still report to console', async t => {
  const folder = await directory(t), output = capture();
  for (const level of [-1, 5, 2.5, '3', null, NaN]) assert.throws(() => createLogger({ level, directory: folder }), /integer between 0 and 4/);
  const logger = createLogger({ directory: folder, ...output, now: () => new Date('2026-09-26T00:00:00Z') });
  await fs.rm(logger.filename);
  await fs.mkdir(logger.filename);
  assert.doesNotThrow(() => logger.info('Console stays available'));
  assert.match(output.lines.join(''), /\[INFO\] Console stays available/);
  assert.match(output.lines.join(''), /\[CRITICAL\] Cannot write log file/);
});
test('server logs warnings, errors and debug traces without credential or query values', async t => {
  const folder = await directory(t), output = capture();
  const logger = createLogger({ level: 4, directory: path.join(folder, 'logs'), ...output });
  const { server, store, auth } = await createServer({ directory: path.join(folder, 'projects'), authDatabase: path.join(folder, 'auth.sqlite'), secureCookies: false, logger });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/projects?token=private-query', { headers: { cookie: 'sentinel_session=private-cookie', authorization: 'Bearer private-header' } });
  assert.equal(response.status, 401);
  await auth.createUser('tester', 'private-password-for-test');
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'private-password-for-test' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], session = await login.json();
  store.list = async () => { throw new Error('Simulated storage failure'); };
  assert.equal((await fetch(base + '/api/projects', { headers: { cookie } })).status, 500);
  const logs = output.lines.join('');
  assert.match(logs, /\[WARNING\] Request rejected: GET \/api\/projects \(401\)/);
  assert.match(logs, /\[DEBUG\] Request completed:/);
  assert.match(logs, /\[INFO\] User signed in/);
  assert.match(logs, /\[ERROR\] Request failed: GET \/api\/projects: Error: Simulated storage failure/);
  for (const secret of ['private-query', 'private-cookie', 'private-header', 'private-password-for-test', cookie.split('=')[1], session.csrfToken]) assert.ok(!logs.includes(secret));
});
