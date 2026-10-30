'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureConfig, loadConfig, defaultConfig } = require('../lib/config');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'config.json');
}
test('first-launch configuration generation preserves existing settings and file contents', async t => {
  const file = await fixture(t);
  assert.deepEqual(loadConfig(file, { create: true }).document, defaultConfig());
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const custom = JSON.stringify({ port: 8123, host: '0.0.0.0', 'log-level': 1, 'file-log-level': 2, auth: { database: 'custom.sqlite', secureCookies: true } });
  await fs.writeFile(file, custom);
  ensureConfig(file);
  const read = loadConfig(file, { create: true });
  assert.equal(read.port, 8123); assert.equal(read.host, '0.0.0.0'); assert.equal(read.logLevel, 1); assert.equal(read.fileLogLevel, 2);
  assert.equal(read.secureCookies, true); assert.equal(await fs.readFile(file, 'utf8'), custom);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['config.json']);
});
test('first-launch initialization never overwrites malformed or invalid existing configuration', async t => {
  const file = await fixture(t);
  for (const contents of ['{broken', '{"port":0}', '{"port":3000,"log-level":9}', '{"port":3000,"file-log-level":9}']) {
    await fs.writeFile(file, contents);
    assert.throws(() => loadConfig(file, { create: true }));
    assert.equal(await fs.readFile(file, 'utf8'), contents);
  }
});
test('older configurations inherit file logging from log-level', async t => {
  const file = await fixture(t);
  await fs.writeFile(file, JSON.stringify({ port: 3000, host: '127.0.0.1', 'log-level': 1 }));
  const config = loadConfig(file);
  assert.equal(config.logLevel, 1); assert.equal(config.fileLogLevel, 1);
});
