'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { crc32 } = require('../lib/zip');
const exec = promisify(execFile);

test('release ZIP excludes local config/data and preserves installed config when extracted', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-release-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source'), installed = path.join(temporary, 'installed');
  await fs.mkdir(source); await fs.mkdir(installed);
  const root = path.resolve(__dirname, '..');
  for (const file of ['server.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.env.example', 'blocks', 'lib', 'public', 'runtime', 'scripts', 'test']) await fs.cp(path.join(root, file), path.join(source, file), { recursive: true });
  const personalConfig = '{"port":8123,"host":"0.0.0.0","log-level":1}\n';
  await fs.writeFile(path.join(source, 'config.json'), personalConfig);
  for (const folder of ['data', 'projects', 'log', 'logs', 'node_modules']) {
    await fs.mkdir(path.join(source, folder));
    await fs.writeFile(path.join(source, folder, 'private.txt'), 'not-for-release');
  }
  await exec(process.execPath, ['scripts/package-release.js', 'v0.0.1'], { cwd: source });
  const archive = await fs.readFile(path.join(source, 'dist', 'amp-release.zip'));
  const checksum = await fs.readFile(path.join(source, 'dist', 'amp-release.zip.sha256'), 'utf8');
  assert.equal(checksum, `${createHash('sha256').update(archive).digest('hex')}  amp-release.zip\n`);
  const files = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), nameSize = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString();
    const start = offset + 30 + nameSize + extra, contents = archive.subarray(start, start + size);
    assert.equal(crc32(contents), archive.readUInt32LE(offset + 14));
    assert.ok(!name.includes('..') && !name.startsWith('/'));
    files.set(name, contents); offset = start + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  assert.ok(files.has('server.js')); assert.ok(files.has('lib/console.js'));
  assert.ok(!files.has('config.json'));
  assert.ok([...files.keys()].every(file => !/^(data|projects|log|logs|node_modules)\//.test(file)));
  assert.equal(JSON.parse(files.get('package.json')).version, '0.0.1');
  assert.equal(JSON.parse(files.get('package-lock.json')).packages[''].version, '0.0.1');
  await fs.writeFile(path.join(installed, 'config.json'), personalConfig);
  for (const [name, contents] of files) {
    const target = path.join(installed, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents);
  }
  assert.equal(await fs.readFile(path.join(installed, 'config.json'), 'utf8'), personalConfig);
  // Packaging must also work in a clean checkout that has never launched.
  await fs.rm(path.join(source, 'config.json'));
  await exec(process.execPath, ['scripts/package-release.js', 'v0.0.2'], { cwd: source });
  await assert.rejects(fs.access(path.join(source, 'config.json')), { code: 'ENOENT' });
});
