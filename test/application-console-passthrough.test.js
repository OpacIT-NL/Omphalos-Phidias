'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../runtime/logger');
const { createApp, loadDefinitions, consolePromptFromMode } = require('../runtime/app');
const consoleBlock = require('../blocks/application_console_passthrough');
const { applyVariable } = require('../blocks/apply_variable');

test('Application Console Passthrough outputs safe bounded HTML', async () => {
  const outputs = {};
  await consoleBlock.execute({ createConsolePassthrough: () => 'safe-token' }, {
    title: '</strong><script>alert(1)</script>', height: 5000, max_lines: 1
  }, {}, (name, value) => { outputs[name] = value; });
  assert.match(outputs.html, /application-console\/safe-token/);
  assert.match(outputs.html, /--phidias-console-height:1200px/);
  assert.match(outputs.html, /const maximum = 10/);
  assert.match(outputs.html, /class="phidias-application-console__input-form"/);
  assert.match(outputs.html, /method: "POST"/);
  assert.match(outputs.html, /"x-phidias-console-token": "safe-token"/);
  assert.doesNotMatch(outputs.html, /<script>alert\(1\)<\/script>/);
  assert.match(outputs.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const script = outputs.html.match(/<script>\n([\s\S]*)\n<\/script>$/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  const inserted = applyVariable('<main>%content%</main>', 'content', outputs.html);
  assert.match(inserted, /Console\$&gt;/);
  assert.doesNotMatch(inserted, /Console%content%gt/);
});

test('Application Console Passthrough maps console modes to visible prompts', async () => {
  assert.equal(consolePromptFromMode('0\n'), 'Console$>');
  assert.equal(consolePromptFromMode('1'), 'Console#>');
  assert.equal(consolePromptFromMode('2'), 'Config#>');
  assert.equal(consolePromptFromMode('db'), 'DB_CLI#>');
  assert.equal(consolePromptFromMode('sql'), 'MySQL>');
  assert.equal(consolePromptFromMode('enablepassword'), 'Please type the Enable Password: ');
  assert.equal(consolePromptFromMode('PluralPage'), 'PluralPage_CLI>');
});

test('Application Console Passthrough streams output and passes input to Console Input blocks', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-console-stream-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.mkdir(path.join(folder, 'config'));
  await fs.writeFile(path.join(folder, 'config', 'console-mode.txt'), '0\n');
  const logger = createLogger({ level: 4, directory: folder, stdout: { write() {} }, stderr: { write() {} } });
  logger.info('Before page');
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Console app', workspaces: [{
    id: 'console-page', name: 'Console page', active: true,
    blocks: [
      { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/console' } },
      { id: 'panel', type: 'application_console_passthrough', x: 200, y: 0, options: { title: 'Logs', height: 300, max_lines: 100 } },
      { id: 'reply', type: 'respond', x: 400, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } },
      { id: 'input', type: 'bot_input', x: 0, y: 200, options: {} },
      { id: 'input-log', type: 'console_log', x: 200, y: 200, options: { level: 'info', value: '' } }
    ],
    connections: [
      { id: 'a1', from: 'http', output: 'next', to: 'panel', input: 'action', kind: 'action' },
      { id: 'a2', from: 'panel', output: 'next', to: 'reply', input: 'action', kind: 'action' },
      { id: 'v1', from: 'panel', output: 'html', to: 'reply', input: 'body', kind: 'value' },
      { id: 'a3', from: 'input', output: 'action', to: 'input-log', input: 'action', kind: 'action' },
      { id: 'v2', from: 'input', output: 'value', to: 'input-log', input: 'value', kind: 'value' }
    ]
  }] };
  const app = createApp({ directory: folder, document, definitions, logger });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(base + '/console', { headers: { cookie: 'session=before-page' } })).text();
  assert.match(page, /class="phidias-application-console__prompt" aria-hidden="true">Console\$&gt;<\/span>/);
  const streamPath = page.match(/\/_phidias\/application-console\/[a-f0-9-]{36}/)?.[0];
  assert.ok(streamPath);
  const token = streamPath.split('/').at(-1);
  const polled = await (await fetch(base + streamPath + '?poll=1&after=0')).json();
  assert.equal(polled.prompt, 'Console$>');
  assert.ok(polled.entries.some(entry => entry.line.includes('Before page')));
  assert.ok(Number.isSafeInteger(polled.cursor));
  assert.equal((await fetch(base + streamPath)).status, 406);
  assert.equal((await fetch(base + streamPath, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ input: 'rejected' })
  })).status, 403);
  assert.equal((await fetch(base + streamPath, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', 'x-phidias-console-token': token },
    body: JSON.stringify({ input: 'two\nlines' })
  })).status, 400);
  const controller = new AbortController();
  const response = await fetch(base + streamPath, { headers: { accept: 'text/event-stream', cookie: 'session=after-page; preference=dark' }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await fs.writeFile(path.join(folder, 'config', 'console-mode.txt'), 'sql\n');
  const inputResponse = await fetch(base + streamPath, {
    method: 'POST',
    headers: { origin: base, cookie: 'session=after-page; preference=dark', 'content-type': 'application/json', 'x-phidias-console-token': token },
    body: JSON.stringify({ input: 'status from browser' })
  });
  assert.equal(inputResponse.status, 202);
  assert.deepEqual(await inputResponse.json(), { accepted: true, receivers: 1 });
  let received = '';
  while (!received.includes('status from browser') || !received.includes('data: "MySQL>"')) received += new TextDecoder().decode((await reader.read()).value || new Uint8Array());
  controller.abort();
  assert.match(received, /Before page/);
  assert.match(received, /status from browser/);
  assert.match(received, /event: prompt\ndata: "MySQL>"/);
  assert.match(received, /"level":"info"/);
});
