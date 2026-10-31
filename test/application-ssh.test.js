'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { Client } = require('ssh2');
const { Auth } = require('../lib/auth');
const { createAuthBroker } = require('../lib/auth-broker');
const { createApp } = require('../runtime/app');
const { createLogger } = require('../runtime/logger');

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('deployed application SSH uses brokered Phidias credentials and forwards its console', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-app-ssh-'));
  const auth = new Auth(path.join(directory, 'broker-auth.sqlite'), { keyFile: path.join(directory, 'phidias.key') });
  await auth.createUser('app-operator', 'a sufficiently long password');
  const projectId = crypto.randomUUID(), applicationKey = auth.ensureApplicationKey(projectId);
  const broker = createAuthBroker({ auth, mysqlConfig: null, logger: { info() {}, error() {} } });
  await new Promise((resolve, reject) => { broker.once('error', reject); broker.listen(0, '127.0.0.1', resolve); });
  const sshPort = await availablePort();
  await fs.writeFile(path.join(directory, 'application.key'), applicationKey);
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    port: 3001, host: '127.0.0.1', 'ssh-port': sshPort, 'log-level': 4, 'force-console-input-log': false,
    auth: { database: 'data/auth.sqlite', broker: { url: `http://127.0.0.1:${broker.address().port}` } },
    'project-id': projectId, 'release-channel': 'RC'
  }));
  const logger = createLogger({ level: 4, directory: path.join(directory, 'log'), stdout: { write() {} }, stderr: { write() {} } });
  const app = createApp({ directory, document: { version: 1, id: projectId, name: 'SSH App', revision: 1, workspaceCategories: [], workspaces: [{ id: crypto.randomUUID(), numberId: 1, name: 'Main', active: true, forceLog: false, logAllRunsToBlock: false, blocks: [], connections: [] }] }, definitions: new Map(), logger });
  let stopped = false;
  t.after(async () => {
    if (!stopped) await app.stop().catch(() => {});
    await new Promise(resolve => broker.close(resolve));
    auth.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await app.start(0, '127.0.0.1');

  const client = new Client(), output = [];
  let shellStream;
  let consoleOutputReceived;
  await new Promise((resolve, reject) => {
    client.once('ready', () => client.shell((error, stream) => {
      if (error) return reject(error);
      shellStream = stream;
      consoleOutputReceived = new Promise((resolveOutput, rejectOutput) => {
        const timer = setTimeout(() => rejectOutput(new Error(`Timed out waiting for application SSH output; received ${JSON.stringify(output.join(''))}`)), 5000);
        stream.on('data', chunk => {
          output.push(chunk.toString());
          const received = output.join('');
          if (received.includes('SSH App application console (app-operator)') && received.includes('Console$> ') && received.includes('forwarded application output')) {
            clearTimeout(timer); resolveOutput();
          }
        });
        stream.once('error', error => { clearTimeout(timer); rejectOutput(error); });
      });
      resolve();
    }));
    client.once('error', reject);
    client.connect({ host: '127.0.0.1', port: sshPort, username: 'app-operator', password: 'a sufficiently long password', hostVerifier: () => true, readyTimeout: 5000 });
  });
  logger.info('forwarded application output');
  await consoleOutputReceived;
  assert.match(output.join(''), /SSH App application console \(app-operator\)/);
  assert.match(output.join(''), /Console\$> /);
  assert.match(output.join(''), /forwarded application output/);

  const shellClosed = new Promise(resolve => shellStream.once('close', resolve));
  shellStream.write('exit\n');
  await shellClosed;
  assert.match(output.join(''), /Session closed\./);

  const clientClosed = new Promise(resolve => client.once('close', resolve));
  client.end();
  await clientClosed;
  await app.stop(); stopped = true;
});
