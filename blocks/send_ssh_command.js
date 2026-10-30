'use strict';

const PASSWORD_PROMPT = /(?:^|[\r\n])[^\r\n]{0,160}\b(?:password|passphrase)\b[^:\r\n]{0,80}:\s*$/i;

function stripTerminalCodes(value) {
  return String(value).replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

function redact(value, secret) {
  const text = String(value || '');
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

function execute(connection, command, options = {}) {
  const password = String(options.password || '');
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    connection.exec(command, { pty: true }, (error, stream) => {
      if (error) return reject(error);
      const output = [];
      const errors = [];
      let promptBuffer = '';
      let passwordSent = false;
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => {
        finish(reject, signal.reason || new Error('SSH command was cancelled'));
        stream.close?.();
      };
      const inspect = data => {
        if (passwordSent) return;
        promptBuffer = (promptBuffer + stripTerminalCodes(data)).slice(-512);
        if (!PASSWORD_PROMPT.test(promptBuffer)) return;
        if (!password) {
          finish(reject, new Error('SSH server requested a password, but the Linux credential has no password'));
          stream.close?.();
          return;
        }
        passwordSent = true;
        stream.write(`${password}\n`);
      };
      const collect = target => data => {
        const text = String(data);
        target.push(text);
        inspect(text);
      };

      stream.on('data', collect(output));
      stream.stderr.on('data', collect(errors));
      stream.once('error', error => finish(reject, error));
      stream.once('close', (code, closeSignal) => finish(resolve, {
        code,
        signal: closeSignal,
        stdout: redact(output.join('').trimEnd(), password),
        stderr: redact(errors.join('').trimEnd(), password),
        passwordSent
      }));
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
    });
  });
}

function connect(credential) {
  const { Client } = require('ssh2');
  const connection = new Client();
  return new Promise((resolve, reject) => connection
    .once('ready', () => resolve(connection))
    .once('error', reject)
    .connect({
      host: String(credential.host),
      port: Number(credential.port) || 22,
      username: String(credential.username),
      ...(credential.privateKey
        ? { privateKey: String(credential.privateKey) }
        : { password: String(credential.password || '') })
    }));
}

module.exports = {
  type: 'send_ssh_command',
  name: 'Send SSH Command',
  category: 'Server Management',
  description: 'Runs one or more commands using a Linux SSH credential and answers interactive password prompts with that credential.',
  inputs: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'credential', name: 'Linux Credential', kind: 'value', types: ['linux_credential'], required: true },
    { id: 'textcommand', name: 'Command', kind: 'value', types: ['text'], required: true }
  ],
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'credential', name: 'Linux Credential', kind: 'value', types: ['linux_credential'], required: true },
    { id: 'textcommand', name: 'Command', kind: 'value', types: ['text'], required: true },
    ...['host', 'port', 'username', 'password'].map(id => ({ id, name: id, kind: 'value', types: id === 'port' ? ['number'] : ['text'], hidden: true }))
  ],
  fields: [],
  outputs: ['action', 'erroraction'],
  outputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'erroraction', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'output', name: 'Output', kind: 'value', types: ['text'] },
    { id: 'error', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, inputs, setOutput) {
    const credential = inputs.credential || (inputs.host || options.host ? {
      host: inputs.host || options.host,
      port: inputs.port || options.port,
      username: inputs.username || options.username,
      password: inputs.password || options.password
    } : null);
    if (!credential) {
      setOutput('error', 'A Linux Credential is required');
      return 'erroraction';
    }
    const commands = String(inputs.textcommand ?? options.textcommand ?? '').split(/\r?\n/).filter(line => line.trim());
    const password = String(credential.password || '');
    if (password) ctx.secretValues?.add(password);
    let connection;
    try {
      connection = await connect(credential);
      const lines = [];
      for (const command of commands) {
        lines.push(`${credential.username}@${credential.host}:~$ ${command.trim()}`);
        const result = await execute(connection, command, { password, signal: ctx.signal });
        if (result.stdout) lines.push(result.stdout);
        if (result.stderr) lines.push(result.stderr);
        if (result.code !== 0) throw new Error(`SSH command exited with code ${result.code}${result.stderr ? `: ${result.stderr}` : ''}`);
      }
      setOutput('output', redact(lines.join('\n'), password));
      setOutput('error', '');
      return 'action';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      setOutput('error', redact(error.message, password));
      return 'erroraction';
    } finally {
      connection?.end();
    }
  },
  executeSSH: execute,
  connectSSH: connect
};
