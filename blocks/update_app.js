'use strict';
const { spawn } = require('node:child_process');

const MAX_OUTPUT = 1024 * 1024;

function writeLog(ctx, message) {
  if (ctx.logger?.forceInfo) ctx.logger.forceInfo('%s', message);
  else if (ctx.logger?.info) ctx.logger.info('%s', message);
  else console.log(message);
}

function commandOutputLogger(ctx) {
  let pending = '';
  return {
    write(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (line) writeLog(ctx, `[OS] ${line}`);
    },
    flush() { if (pending) writeLog(ctx, `[OS] ${pending}`); pending = ''; }
  };
}

function runCommand(executable, args, display, ctx) {
  writeLog(ctx, `[OS] ${display}`);
  return new Promise(resolve => {
    let output = '', outputSize = 0, settled = false, terminationReason = '', forceTimer;
    const stdoutLogger = commandOutputLogger(ctx), stderrLogger = commandOutputLogger(ctx);
    const child = spawn(executable, args, {
      cwd: ctx.directory || process.cwd(),
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const kill = signal => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch {}
    };
    const collect = logger => chunk => {
      outputSize += chunk.length;
      if (outputSize <= MAX_OUTPUT) output += chunk.toString();
      logger.write(chunk);
      if (outputSize > MAX_OUTPUT && !terminationReason) {
        stop('Command output exceeded 1 MB.');
      }
    };
    child.stdout.on('data', collect(stdoutLogger));
    child.stderr.on('data', collect(stderrLogger));
    const stop = reason => {
      terminationReason ||= reason;
      kill('SIGTERM');
      forceTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
      forceTimer.unref?.();
    };
    const abort = () => stop('Update cancelled.');
    ctx.signal?.addEventListener('abort', abort, { once: true });
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      ctx.signal?.removeEventListener('abort', abort);
      stdoutLogger.flush(); stderrLogger.flush();
      if (error) terminationReason ||= error.message;
      resolve({ failed: Boolean(terminationReason) || code !== 0, exitCode: Number.isInteger(code) ? code : -1, output, error: terminationReason || (code === 0 ? '' : `${executable} exited with code ${code}`) });
    };
    child.once('error', error => finish(-1, error));
    child.once('close', code => finish(code));
  });
}

async function performUpdate(ctx, runner = runCommand) {
  const channel = ctx.deployment?.channel;
  const updateUrl = ctx.deployment?.updateUrl;
  if (!['RC', 'Prod'].includes(channel)) throw new Error('This application has no RC or Prod release channel in config.json');
  if (!updateUrl) throw new Error(`No update URL is configured for the ${channel} release channel`);

  const messages = [];
  const log = message => { messages.push(message); writeLog(ctx, message); };
  const execute = async (executable, args, display) => {
    const result = await runner(executable, args, display, ctx);
    if (result.output) messages.push(result.output.trimEnd());
    if (result.failed) throw new Error(result.error || `${executable} exited with code ${result.exitCode}`);
  };

  log(`[SYSTEM] Updating to latest ${channel} revision...`);
  log('[UpdateManager] Deleting current zip');
  await execute('rm', ['-f', 'current.zip'], 'rm current.zip');
  log('[UpdateManager] Downloading latest version');
  await execute('wget', ['-O', 'latest.zip', updateUrl], `wget ${updateUrl}`);
  log('[UpdateManager] Unzipping latest.zip');
  await execute('unzip', ['-o', 'latest.zip'], 'unzip -o latest.zip');
  log('[UpdateManager] Update completed');
  log('[SYSTEM] New version installed. Please restart the Node server to apply the update.');
  return messages.filter(Boolean).join('\n');
}

module.exports = {
  type: 'update_app', name: 'Update Application', category: 'System',
  description: 'Download and install latest.zip from the update URL configured for this RC or Prod application.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'log', name: 'Update Log', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, _inputs, setOutput) {
    try {
      setOutput('log', await performUpdate(ctx));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(ctx, `[SYSTEM] Update failed: ${message}`);
      setOutput('error_message', message);
      return 'error';
    }
  }
};

module.exports.performUpdate = performUpdate;
module.exports.runCommand = runCommand;
