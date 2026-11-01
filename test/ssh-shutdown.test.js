'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { closeListener } = require('../server');
const { createSSHConsoleServer } = require('../runtime/ssh-console');

test('closeListener closes an ssh2 listener that has no listening property', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-ssh-shutdown-'));
  const server = createSSHConsoleServer({
    hostKeyFile: path.join(directory, 'ssh-host-key'),
    authenticate: async () => 'operator',
    openShell() {}
  });

  t.after(async () => {
    if (server.address()) await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const failed = error => {
      server.off('listening', resolve);
      reject(error);
    };
    server.once('error', failed);
    server.once('listening', () => {
      server.off('error', failed);
      resolve();
    });
    server.listen(0, '127.0.0.1');
  });

  assert.ok(server.address());
  await closeListener(server);
  assert.equal(server.address(), null);
});
