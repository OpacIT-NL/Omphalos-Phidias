'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

test('SQLite loader suppresses only the Node SQLite experimental warning', async () => {
  const helper = path.resolve(__dirname, '../lib/sqlite.js');
  const script = `const { loadSQLite } = require(${JSON.stringify(helper)}); loadSQLite(); process.emitWarning('visible warning', { type: 'Warning' });`;
  const { stderr } = await run(process.execPath, ['-e', script]);
  assert.doesNotMatch(stderr, /SQLite is an experimental feature/);
  assert.match(stderr, /visible warning/);
});
