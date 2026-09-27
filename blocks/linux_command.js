'use strict';
const { spawn } = require('node:child_process');

const MAX_OUTPUT = 1024 * 1024;

function runCommand(command, directory, timeoutSeconds, signal) {
  return new Promise(resolve => {
    let stdout = [], stderr = [], size = 0, reason = '', forceTimer;
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: directory || process.cwd(),
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const kill = signalName => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signalName); } catch {}
    };
    const stop = message => {
      if (!reason) reason = message;
      kill('SIGTERM');
      forceTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
      forceTimer.unref?.();
    };
    const collect = target => chunk => {
      size += chunk.length;
      if (size > MAX_OUTPUT) return stop('Command output exceeded 1 MB.');
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const abort = () => stop('Command cancelled.');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(`Command timed out after ${timeoutSeconds} seconds.`), timeoutSeconds * 1000);
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(forceTimer); signal.removeEventListener('abort', abort);
      if (error && !reason) reason = error.message;
      const errorText = Buffer.concat(stderr).toString();
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: reason ? [errorText, reason].filter(Boolean).join(errorText.endsWith('\n') ? '' : '\n') : errorText,
        exitCode: Number.isInteger(code) ? code : -1,
        failed: Boolean(reason) || code !== 0
      });
    };
    child.once('error', error => finish(-1, error));
    child.once('close', code => finish(code));
  });
}

module.exports = {
  type: 'linux_command', name: 'Linux command', category: 'System',
  description: 'Run a shell command as the operating-system user running this automation.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'command', name: 'Command', kind: 'value', types: ['text'] }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'stdout', name: 'Standard Output', kind: 'value', types: ['text'] },
    { id: 'stderr', name: 'Standard Error', kind: 'value', types: ['text'] },
    { id: 'exitCode', name: 'Exit Code', kind: 'value', types: ['number'] }
  ],
  fields: [
    { key: 'command', label: 'Command', type: 'text', default: 'whoami' },
    { key: 'directory', label: 'Working directory (blank = application directory)', type: 'text', default: '' },
    { key: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 30, min: 1, max: 60 }
  ],
  async execute(ctx, options, inputs, setOutput) {
    const command = String(Object.hasOwn(inputs, 'command') ? inputs.command : ctx.render(options.command));
    const directory = String(ctx.render(options.directory) || '');
    const result = await runCommand(command, directory, Number(options.timeout), ctx.signal);
    setOutput('stdout', result.stdout);
    setOutput('stderr', result.stderr);
    setOutput('exitCode', result.exitCode);
    return result.failed ? 'error' : 'success';
  }
};

module.exports.runCommand = runCommand;
