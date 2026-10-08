'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createApp, loadDefinitions } = require('../runtime/app');
const { createLogger } = require('../runtime/logger');

test('workspace logging emits structured block events with one Run ID per trigger', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-workspace-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const consoleLines = [];
  const logger = createLogger({
    level: 0,
    fileLevel: 0,
    directory: path.join(directory, 'log'),
    stdout: { write: line => consoleLines.push(line) },
    stderr: { write: line => consoleLines.push(line) }
  });
  const events = [];
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  definitions.set('capture_workspace_log', {
    type: 'capture_workspace_log',
    name: 'Capture Workspace Log',
    category: 'Tests',
    description: 'Captures workspace log output for this test.',
    fields: [],
    inputPorts: [
      { id: 'action', name: 'Action', kind: 'action', types: [] },
      { id: 'logged_in_user', name: 'Logged In User', kind: 'value', types: ['text'] },
      { id: 'content', name: 'Content', kind: 'value', types: ['object'] },
      { id: 'run_id', name: 'Run ID', kind: 'value', types: ['text'] }
    ],
    outputs: [],
    async execute(_ctx, _options, inputs) { events.push(inputs); }
  });
  definitions.set('fail_for_log', {
    type: 'fail_for_log', name: 'Fail For Log', category: 'Tests', description: 'Fails for this test.', fields: [], outputs: [],
    async execute() { throw new Error('logged failure'); }
  });
  const workspace = {
    id: 'main', numberId: 1, name: 'Audited workspace', active: true, forceLog: true, logAllRunsToBlock: true,
    blocks: [
      { id: 'ok-http', numberId: 1, type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/ok' } },
      { id: 'reply', numberId: 2, type: 'respond', x: 300, y: 0, options: { status: 200, format: 'Text', body: 'ok', headers: '{}' } },
      { id: 'bad-http', numberId: 3, type: 'http', x: 0, y: 200, options: { method: 'GET', path: '/bad' } },
      { id: 'failure', numberId: 4, type: 'fail_for_log', x: 300, y: 200, options: {} },
      { id: 'log-event', numberId: 5, type: 'workspace_log', x: 0, y: 400, options: {} },
      { id: 'capture', numberId: 6, type: 'capture_workspace_log', x: 300, y: 400, options: {} }
    ],
    connections: [
      { id: 'ok-action', from: 'ok-http', output: 'next', to: 'reply', input: 'action', kind: 'action' },
      { id: 'bad-action', from: 'bad-http', output: 'next', to: 'failure', input: 'action', kind: 'action' },
      { id: 'log-action', from: 'log-event', output: 'next', to: 'capture', input: 'action', kind: 'action' },
      { id: 'log-user', from: 'log-event', output: 'logged_in_user', to: 'capture', input: 'logged_in_user', kind: 'value' },
      { id: 'log-content', from: 'log-event', output: 'content', to: 'capture', input: 'content', kind: 'value' },
      { id: 'log-run', from: 'log-event', output: 'run_id', to: 'capture', input: 'run_id', kind: 'value' }
    ]
  };
  const app = createApp({ directory, document: { version: 1, name: 'Audited app', workspaces: [workspace] }, definitions, logger });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(base + '/ok')).status, 200);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map(event => event.run_id)).size, 1);
  assert.ok(events.every(event => /^[0-9a-f-]{36}$/.test(event.run_id)));
  assert.ok(events.every(event => event.logged_in_user === 'svc_automation'));
  assert.deepEqual(events.map(event => event.content.block.numberId), [1, 2]);
  assert.ok(events.every(event => event.content.successful));
  assert.deepEqual(events[0].content.outputs.body, '');
  const firstRun = events[0].run_id;

  assert.equal((await fetch(base + '/bad')).status, 500);
  const failed = events.find(event => event.content.block.numberId === 4);
  assert.ok(failed);
  assert.equal(failed.content.status, 'failed');
  assert.equal(failed.content.successful, false);
  assert.match(failed.content.error.message, /logged failure/);
  assert.notEqual(failed.run_id, firstRun);

  const forcedLines = consoleLines.filter(line => line.includes('Workspace run'));
  assert.equal(forcedLines.length, 4);
  assert.ok(forcedLines.every(line => line.includes('[INFO]')));
  const file = await fs.readFile(logger.filename, 'utf8');
  assert.equal(file.split('\n').filter(line => line.includes('Workspace run')).length, 4);
});

test('workspace logging settings are optional for older workspaces and validated when present', () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = {
    version: 1,
    name: 'Legacy logging defaults',
    workspaces: [{ id: 'main', numberId: 1, name: 'Main', active: false, blocks: [], connections: [] }]
  };
  const { validate } = require('../runtime/validate');
  validate(document, definitions);
  assert.equal(document.workspaces[0].forceLog, false);
  assert.equal(document.workspaces[0].logAllRunsToBlock, false);
  document.workspaces[0].forceLog = 'yes';
  assert.throws(() => validate(document, definitions), /logging settings/);
});

test('application Force Console input log audits stdin regardless of log level', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-console-input-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port: 3001,
    host: '127.0.0.1',
    'log-level': 0,
    'force-console-input-log': true
  }));
  const lines = [], stdin = new PassThrough();
  const logger = createLogger({
    level: 0,
    fileLevel: 0,
    directory: path.join(directory, 'log'),
    stdout: { write: line => lines.push(line) },
    stderr: { write: line => lines.push(line) }
  });
  const document = {
    version: 1,
    name: 'Console audit',
    workspaces: [{
      id: 'main', numberId: 1, name: 'Main', active: true, blocks: [
        { id: 'input', numberId: 1, type: 'bot_input', x: 0, y: 0, options: {} }
      ], connections: []
    }]
  };
  const app = createApp({ directory, document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')), logger, stdin });
  await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  stdin.write('complete console command\n');
  for (let attempt = 0; attempt < 50 && !lines.some(line => line.includes('complete console command')); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(lines.join(''), /\[INFO\] Console input: complete console command/);
  assert.match(await fs.readFile(logger.filename, 'utf8'), /\[INFO\] Console input: complete console command/);
});
