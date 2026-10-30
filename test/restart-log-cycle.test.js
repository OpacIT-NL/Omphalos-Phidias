'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function waitFor(check, child, stderr, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started >= timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for exported application restart. stderr: ${stderr()}`));
      } else if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Exported application exited with ${child.exitCode}. stderr: ${stderr()}`));
      }
    }, 20);
  });
}

test('Restart App begins a new numbered log cycle', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-restart-cycle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'blocks'));
  const runtime = path.resolve(__dirname, '../runtime');
  for (const name of ['validate.js', 'legacy.js', 'cron.js', 'logger.js']) {
    await fs.copyFile(path.join(runtime, name), path.join(directory, name));
  }
  await fs.copyFile(path.join(runtime, 'app.js'), path.join(directory, 'app.js'));
  await fs.copyFile(path.resolve(__dirname, '../blocks/api_endpoint.js'), path.join(directory, 'blocks/api_endpoint.js'));
  await fs.copyFile(path.resolve(__dirname, '../blocks/restart_app.js'), path.join(directory, 'blocks/restart_app.js'));

  const port = await availablePort();
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port,
    host: '127.0.0.1',
    'log-level': 4,
    'force-console-input-log': false
  }));
  await fs.writeFile(path.join(directory, 'workspaces.json'), JSON.stringify({
    version: 1,
    name: 'Restart cycle test',
    workspaces: [{
      id: 'main',
      numberId: 1,
      name: 'Main',
      active: true,
      blocks: [
        { id: 'endpoint', numberId: 1, type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/restart' } },
        { id: 'restart', numberId: 2, type: 'restart_app', x: 300, y: 0, options: {} }
      ],
      connections: [{ id: 'restart-action', from: 'endpoint', output: 'next', to: 'restart', input: 'action', kind: 'action' }]
    }]
  }));

  const child = spawn(process.execPath, ['app.js'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await waitFor(() => (stdout.match(/Restart cycle test listening/g) || []).length === 1, child, () => stderr);

  const response = await fetch(`http://127.0.0.1:${port}/restart`, { method: 'POST' });
  assert.equal(response.status, 204);
  await waitFor(() => (stdout.match(/Restart cycle test listening/g) || []).length === 2, child, () => stderr);

  child.kill('SIGTERM');
  await once(child, 'exit');
  const names = (await fs.readdir(path.join(directory, 'log'))).sort();
  assert.equal(names.length, 2);
  assert.match(names[0], /^\d{4}-\d{2}-\d{2}-1\.txt$/);
  assert.match(names[1], /^\d{4}-\d{2}-\d{2}-2\.txt$/);
  const first = await fs.readFile(path.join(directory, 'log', names[0]), 'utf8');
  const second = await fs.readFile(path.join(directory, 'log', names[1]), 'utf8');
  assert.match(first, /Stopping Restart cycle test \(workflow restart\)/);
  assert.match(first, /Restart cycle test stopped/);
  assert.doesNotMatch(first, /Restarting Restart cycle test/);
  assert.match(second, /Restarting Restart cycle test/);
  assert.match(second, /Restart cycle test listening/);
});
