'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('ssh2');
const { createSSHConsoleServer } = require('../lib/ssh-console');
const endSSHSession = require('../blocks/end_ssh_session');

test('SSH console accepts password login, opens a shell, and ends active sessions', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-ssh-'));
  const authenticated = [];
  const server = createSSHConsoleServer({
    hostKeyFile: path.join(directory, 'ssh_host_rsa_key'),
    authenticate({ username, password, ip }) {
      authenticated.push({ username, password, ip });
      if (username !== 'operator' || password !== 'correct password') throw new Error('rejected');
      return username;
    },
    openShell({ stream, username }) { stream.write(`Welcome ${username}\r\nConsole$> `); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    server.closeClients();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const client = new Client();
  const output = [];
  const closed = new Promise((resolve, reject) => {
    client.once('close', resolve);
    client.once('error', reject);
  });
  await new Promise((resolve, reject) => {
    client.once('ready', () => client.shell((error, stream) => {
      if (error) return reject(error);
      stream.on('data', chunk => output.push(chunk.toString()));
      resolve();
    }));
    client.once('error', reject);
    client.connect({ host: '127.0.0.1', port: server.address().port, username: 'operator', password: 'correct password', hostVerifier: () => true, readyTimeout: 5000 });
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(output.join(''), /Welcome operator\r\nConsole\$> /);
  assert.equal(authenticated[0].username, 'operator');
  assert.equal(authenticated[0].password, 'correct password');

  let ended = 0;
  await endSSHSession.execute({ endSSHSessions() { ended++; server.endSessions(); } });
  assert.equal(ended, 1);
  await closed;
});
