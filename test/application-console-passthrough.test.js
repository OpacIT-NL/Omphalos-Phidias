'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../runtime/logger');
const { createApp, loadDefinitions } = require('../runtime/app');
const consoleBlock = require('../blocks/application_console_passthrough');

test('Application Console Passthrough outputs safe bounded HTML', async () => {
  const outputs = {};
  await consoleBlock.execute({ createConsolePassthrough: () => 'safe-token' }, {
    title: '</strong><script>alert(1)</script>', height: 5000, max_lines: 1
  }, {}, (name, value) => { outputs[name] = value; });
  assert.match(outputs.html, /application-console\/safe-token/);
  assert.match(outputs.html, /--phidias-console-height:1200px/);
  assert.match(outputs.html, /const maximum = 10/);
  assert.doesNotMatch(outputs.html, /<script>alert\(1\)<\/script>/);
  assert.match(outputs.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const script = outputs.html.match(/<script>\n([\s\S]*)\n<\/script>$/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('Application Console Passthrough streams logger entries with replay', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-console-stream-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const logger = createLogger({ level: 4, directory: folder, stdout: { write() {} }, stderr: { write() {} } });
  logger.info('Before page');
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Console app', workspaces: [{
    id: 'console-page', name: 'Console page', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/console' } },
      { id: 'panel', type: 'application_console_passthrough', x: 200, y: 0, options: { title: 'Logs', height: 300, max_lines: 100 } },
      { id: 'reply', type: 'respond', x: 400, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
    ],
    connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'panel', input: 'action', kind: 'action' },
      { id: 'a2', from: 'panel', output: 'next', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v1', from: 'panel', output: 'html', to: 'reply', input: 'body', kind: 'value' }
    ]
  }] };
  const app = createApp({ document, definitions, logger });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(base + '/console')).text();
  const streamPath = page.match(/\/_phidias\/application-console\/[a-f0-9-]{36}/)?.[0];
  assert.ok(streamPath);
  assert.equal((await fetch(base + streamPath)).status, 406);
  const controller = new AbortController();
  const response = await fetch(base + streamPath, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  logger.warning('After page');
  let received = '';
  while (!received.includes('After page')) received += new TextDecoder().decode((await reader.read()).value || new Uint8Array());
  controller.abort();
  assert.match(received, /Before page/);
  assert.match(received, /After page/);
  assert.match(received, /"level":"warning"/);
});
