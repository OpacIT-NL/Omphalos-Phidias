'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('ssh2');

function ensureHostKey(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(filename, 0o600);
    return fs.readFileSync(filename);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  try {
    fs.writeFileSync(filename, privateKey.export({ type: 'pkcs1', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  fs.chmodSync(filename, 0o600);
  return fs.readFileSync(filename);
}

function createSSHConsoleServer({ hostKeyFile, authenticate, openShell, logger = null, greeting = 'Phidias SSH console' }) {
  if (typeof authenticate !== 'function' || typeof openShell !== 'function') throw new TypeError('SSH console authentication and shell handlers are required');
  const clients = new Set(), streams = new Set();
  const server = new Server({ hostKeys: [ensureHostKey(hostKeyFile)], greeting }, client => {
    clients.add(client);
    let authenticatedUser = null, authenticating = false;
    const remoteAddress = () => client._sock?.remoteAddress || '';
    client.on('authentication', context => {
      if (context.method !== 'password' || authenticating || authenticatedUser) return context.reject(['password']);
      authenticating = true;
      Promise.resolve(authenticate({ username: context.username, password: context.password, ip: remoteAddress() }))
        .then(user => {
          authenticating = false;
          if (!user) return context.reject(['password']);
          authenticatedUser = typeof user === 'string' ? user : user.username;
          context.accept();
        })
        .catch(error => {
          authenticating = false;
          logger?.warning?.('SSH authentication failed for %s from %s: %s', context.username, remoteAddress() || 'unknown', error.message);
          context.reject(['password']);
        });
    });
    client.on('ready', () => {
      logger?.info?.('SSH console login: %s from %s', authenticatedUser, remoteAddress() || 'unknown');
      client.on('session', accept => {
        const session = accept(); let opened = false;
        session.on('pty', acceptPty => acceptPty());
        session.on('window-change', acceptWindow => acceptWindow?.());
        session.on('shell', acceptShell => {
          if (opened) return;
          opened = true;
          const stream = acceptShell(); streams.add(stream);
          const close = () => streams.delete(stream);
          stream.once('close', close); stream.once('end', close);
          Promise.resolve(openShell({ stream, username: authenticatedUser, client }))
            .catch(error => { logger?.error?.('SSH console failed: %s', error.stack || error); if (!stream.destroyed) stream.end(`\r\n% ${error.message}\r\n`); });
        });
      });
    });
    client.on('error', error => logger?.debug?.('SSH client error: %s', error.message));
    client.once('close', () => clients.delete(client));
  });
  server.on('error', error => logger?.error?.('SSH server error: %s', error.stack || error));
  server.endSessions = (message = 'SSH session ended by application.') => {
    for (const stream of [...streams]) {
      try { stream.end(`\r\n${message}\r\n`); } catch {}
    }
    for (const client of [...clients]) { try { client.end(); } catch {} }
  };
  server.closeClients = () => {
    server.endSessions('SSH server is shutting down.');
  };
  return server;
}

module.exports = { createSSHConsoleServer, ensureHostKey };
