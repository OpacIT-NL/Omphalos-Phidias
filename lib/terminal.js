'use strict';
const readline = require('node:readline');
const { Writable } = require('node:stream');
const CANCEL = Symbol('cancel');
class Terminal {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.output = output; this.closed = false; this.muted = false; this.active = false; this.buffer = [];
    this.writer = new Writable({ write: (chunk, encoding, callback) => { if (!this.muted) output.write(chunk, encoding); callback(); } });
    this.rl = readline.createInterface({ input, output: this.writer, terminal: Boolean(input.isTTY && output.isTTY), historySize: 0 });
    this.rl.on('line', line => this.deliver(line));
    this.rl.on('SIGINT', () => { this.rl.write(null, { ctrl: true, name: 'u' }); this.deliver(CANCEL); });
    this.rl.on('close', () => { this.closed = true; this.deliver(null); });
  }
  deliver(value) { if (this.waiting) { const resolve = this.waiting; this.waiting = null; resolve(value); } else this.buffer.push(value); }
  async read(prompt, secret = false) {
    if (this.closed) return null;
    this.active = true; this.muted = secret; this.prompt = prompt;
    this.rl.setPrompt(secret ? '' : prompt);
    if (secret) this.output.write(prompt); else this.rl.prompt();
    const line = this.buffer.length ? this.buffer.shift() : await new Promise(resolve => { this.waiting = resolve; });
    this.active = false; this.muted = false;
    if (secret || line === CANCEL) this.output.write('\n');
    if (!this.rl.terminal && typeof line === 'string' && !secret) this.output.write(line + '\n');
    return line;
  }
  async ask(prompt, secret = false) {
    const value = await this.read(prompt, secret);
    if (value === null || value === CANCEL) throw new Error('Cancelled.');
    return value;
  }
  write(message) { this.output.write(message + '\n'); }
  log(line, stream = this.output) {
    if (!this.active || this.closed) { stream.write(line); return; }
    if (this.rl.terminal) { readline.clearLine(this.output, 0); readline.cursorTo(this.output, 0); }
    stream.write(line);
    if (this.muted) this.output.write(this.prompt);
    else this.rl.prompt(true);
  }
  async run(engine) {
    while (!this.closed && !engine.stopped) {
      const line = await this.read(engine.prompt);
      if (line === null) break;
      if (line === CANCEL) { engine.cancel(); continue; }
      await engine.execute(line);
    }
    this.close();
  }
  close() { if (!this.closed) this.rl.close(); }
}
module.exports = { Terminal };
