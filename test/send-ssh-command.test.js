'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { executeSSH } = require('../blocks/send_ssh_command');

function interactiveConnection(onWrite) {
  let execOptions;
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  stream.writes = [];
  stream.write = value => {
    stream.writes.push(value);
    onWrite?.(value, stream);
    return true;
  };
  stream.close = () => stream.emit('close', 1, null);
  return {
    stream,
    get execOptions() { return execOptions; },
    exec(_command, options, callback) {
      execOptions = options;
      callback(null, stream);
    }
  };
}

test('Send SSH Command detects a fragmented sudo prompt and supplies the credential password', async () => {
  const connection = interactiveConnection((_value, stream) => {
    setImmediate(() => {
      stream.emit('data', 'root\n');
      stream.emit('close', 0, null);
    });
  });
  const pending = executeSSH(connection, 'sudo whoami', { password: 'correct horse' });
  connection.stream.stderr.emit('data', '[sudo] pass');
  connection.stream.stderr.emit('data', 'word for svc: ');
  const result = await pending;

  assert.deepEqual(connection.execOptions, { pty: true });
  assert.deepEqual(connection.stream.writes, ['correct horse\n']);
  assert.equal(result.passwordSent, true);
  assert.equal(result.stdout, 'root');
  assert.match(result.stderr, /password for svc:/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /correct horse/);
});

test('Send SSH Command never sends a password without a password prompt', async () => {
  const connection = interactiveConnection();
  const pending = executeSSH(connection, 'printf safe', { password: 'do-not-send' });
  connection.stream.emit('data', 'password policy is enabled\n');
  connection.stream.emit('close', 0, null);
  const result = await pending;

  assert.deepEqual(connection.stream.writes, []);
  assert.equal(result.passwordSent, false);
});

test('Send SSH Command fails clearly when the server prompts but the credential has no password', async () => {
  const connection = interactiveConnection();
  const pending = executeSSH(connection, 'sudo whoami');
  connection.stream.stderr.emit('data', 'Password: ');

  await assert.rejects(pending, /Linux credential has no password/);
  assert.deepEqual(connection.stream.writes, []);
});

test('Send SSH Command redacts a password if a remote terminal echoes it', async () => {
  const connection = interactiveConnection((_value, stream) => {
    setImmediate(() => {
      stream.emit('data', 'bad-server-echo\n');
      stream.emit('close', 0, null);
    });
  });
  const pending = executeSSH(connection, 'sudo command', { password: 'bad-server-echo' });
  connection.stream.emit('data', '[sudo] password: ');
  const result = await pending;

  assert.doesNotMatch(result.stdout, /bad-server-echo/);
  assert.match(result.stdout, /\[REDACTED\]/);
});
