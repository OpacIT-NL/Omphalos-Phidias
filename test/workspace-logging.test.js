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
  const events = [], runs = [];
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
  definitions.set('capture_run_start', {
    type: 'capture_run_start', name: 'Capture Run Start', category: 'Tests', description: 'Captures run-start output for this test.', fields: [],
    inputPorts: [
      { id: 'action', name: 'Action', kind: 'action', types: [] },
      { id: 'run_id', name: 'Run ID', kind: 'value', types: ['text'] },
      { id: 'started_at', name: 'Started At', kind: 'value', types: ['text'] },
      { id: 'logged_in_user', name: 'Logged In User', kind: 'value', types: ['text'] },
      { id: 'workspace_name', name: 'Workspace Name', kind: 'value', types: ['text'] },
      { id: 'workspace_number_id', name: 'Workspace Number ID', kind: 'value', types: ['number'] }
    ],
    outputs: [],
    async execute(_ctx, _options, inputs) { runs.push(inputs); }
  });
  const workspace = {
    id: 'main', numberId: 1, name: 'Audited workspace', active: true, forceLog: true, logAllRunsToBlock: true,
    blocks: [
      { id: 'ok-http', numberId: 1, type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/ok' } },
      { id: 'reply', numberId: 2, type: 'respond', x: 300, y: 0, options: { status: 200, format: 'Text', body: 'ok', headers: '{}' } },
      { id: 'bad-http', numberId: 3, type: 'http', x: 0, y: 200, options: { method: 'GET', path: '/bad' } },
      { id: 'failure', numberId: 4, type: 'fail_for_log', x: 300, y: 200, options: {} },
      { id: 'log-event', numberId: 5, type: 'workspace_log', x: 0, y: 400, options: {} },
      { id: 'capture', numberId: 6, type: 'capture_workspace_log', x: 300, y: 400, options: {} },
      { id: 'run-start', numberId: 7, type: 'run_id_tiggered', x: 0, y: 600, options: {} },
      { id: 'capture-run', numberId: 8, type: 'capture_run_start', x: 300, y: 600, options: {} }
    ],
    connections: [
      { id: 'ok-action', from: 'ok-http', output: 'next', to: 'reply', input: 'action', kind: 'action' },
      { id: 'bad-action', from: 'bad-http', output: 'next', to: 'failure', input: 'action', kind: 'action' },
      { id: 'log-action', from: 'log-event', output: 'next', to: 'capture', input: 'action', kind: 'action' },
      { id: 'log-user', from: 'log-event', output: 'logged_in_user', to: 'capture', input: 'logged_in_user', kind: 'value' },
      { id: 'log-content', from: 'log-event', output: 'content', to: 'capture', input: 'content', kind: 'value' },
      { id: 'log-run', from: 'log-event', output: 'run_id', to: 'capture', input: 'run_id', kind: 'value' },
      { id: 'run-action', from: 'run-start', output: 'next', to: 'capture-run', input: 'action', kind: 'action' },
      { id: 'run-id', from: 'run-start', output: 'run_id', to: 'capture-run', input: 'run_id', kind: 'value' },
      { id: 'run-time', from: 'run-start', output: 'started_at', to: 'capture-run', input: 'started_at', kind: 'value' },
      { id: 'run-user', from: 'run-start', output: 'logged_in_user', to: 'capture-run', input: 'logged_in_user', kind: 'value' },
      { id: 'run-workspace', from: 'run-start', output: 'workspace_name', to: 'capture-run', input: 'workspace_name', kind: 'value' },
      { id: 'run-workspace-number', from: 'run-start', output: 'workspace_number_id', to: 'capture-run', input: 'workspace_number_id', kind: 'value' }
    ]
  };
  const app = createApp({ directory, document: { version: 1, name: 'Audited app', workspaces: [workspace] }, definitions, logger });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(base + '/ok')).status, 200);
  assert.equal(runs.length, 1);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map(event => event.run_id)).size, 1);
  assert.ok(events.every(event => /^[0-9a-f-]{36}$/.test(event.run_id)));
  assert.ok(events.every(event => event.logged_in_user === 'svc_automation'));
  assert.deepEqual(events.map(event => event.content.block.numberId), [1, 2]);
  assert.ok(events.every(event => event.content.successful));
  assert.deepEqual(events[0].content.outputs.body, '');
  const firstRun = events[0].run_id;
  assert.equal(runs[0].run_id, firstRun);
  assert.equal(runs[0].logged_in_user, 'svc_automation');
  assert.equal(runs[0].workspace_name, 'Audited workspace');
  assert.equal(runs[0].workspace_number_id, 1);
  assert.ok(!Number.isNaN(Date.parse(runs[0].started_at)));

  assert.equal((await fetch(base + '/bad')).status, 500);
  assert.equal(runs.length, 2);
  const failed = events.find(event => event.content.block.numberId === 4);
  assert.ok(failed);
  assert.equal(failed.content.status, 'failed');
  assert.equal(failed.content.successful, false);
  assert.match(failed.content.error.message, /logged failure/);
  assert.notEqual(failed.run_id, firstRun);
  assert.equal(runs[1].run_id, failed.run_id);

  const forcedLines = consoleLines.filter(line => line.includes('Workspace run'));
  assert.equal(forcedLines.length, 4);
  assert.ok(forcedLines.every(line => line.includes('[INFO]')));
  const file = await fs.readFile(logger.filename, 'utf8');
  assert.equal(file.split('\n').filter(line => line.includes('Workspace run')).length, 4);
});

test('Run ID trigger stays disabled unless Log all runs to log block is enabled', async t => {
  let starts = 0;
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  definitions.set('count_run_start', {
    type: 'count_run_start', name: 'Count Run Start', category: 'Tests', description: 'Counts run starts.', fields: [],
    inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }], outputs: [],
    async execute() { starts++; }
  });
  const workspace = {
    id: 'main', numberId: 1, name: 'Unlogged workspace', active: true, forceLog: false, logAllRunsToBlock: false,
    blocks: [
      { id: 'http', numberId: 1, type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/run' } },
      { id: 'reply', numberId: 2, type: 'respond', x: 300, y: 0, options: { status: 200, format: 'Text', body: 'ok', headers: '{}' } },
      { id: 'run-start', numberId: 3, type: 'run_id_tiggered', x: 0, y: 200, options: {} },
      { id: 'count', numberId: 4, type: 'count_run_start', x: 300, y: 200, options: {} }
    ],
    connections: [
      { id: 'reply-action', from: 'http', output: 'next', to: 'reply', input: 'action', kind: 'action' },
      { id: 'count-action', from: 'run-start', output: 'next', to: 'count', input: 'action', kind: 'action' }
    ]
  };
  const app = createApp({ document: { version: 1, name: 'Unlogged app', workspaces: [workspace] }, definitions });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/run`)).status, 200);
  assert.equal(starts, 0);
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

test('application force-console setting forces Console Log blocks without auditing stdin', async t => {
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
        { id: 'input', numberId: 1, type: 'bot_input', x: 0, y: 0, options: {} },
        { id: 'http', numberId: 2, type: 'http', x: 0, y: 200, options: { method: 'GET', path: '/forced-log' } },
        { id: 'console', numberId: 3, type: 'console_log', x: 300, y: 200, options: { value: 'forced console block message' } },
        { id: 'reply', numberId: 4, type: 'respond', x: 600, y: 200, options: { status: 200, format: 'Text', body: 'ok', headers: '{}' } }
      ], connections: [
        { id: 'to-console', from: 'http', output: 'next', to: 'console', input: 'action', kind: 'action' },
        { id: 'to-reply', from: 'console', output: 'action', to: 'reply', input: 'action', kind: 'action' }
      ]
    }]
  };
  const app = createApp({ directory, document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')), logger, stdin });
  await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  stdin.write('complete console command\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(lines.join(''), /complete console command/);
  assert.doesNotMatch(await fs.readFile(logger.filename, 'utf8'), /complete console command/);
  assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/forced-log`)).status, 200);
  assert.match(lines.join(''), /\[INFO\] forced console block message/);
  assert.match(await fs.readFile(logger.filename, 'utf8'), /\[INFO\] forced console block message/);
});
