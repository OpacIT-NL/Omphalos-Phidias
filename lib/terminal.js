'use strict';
const readline = require('node:readline');
const { Writable } = require('node:stream');
const CANCEL = Symbol('cancel');
class Terminal {
  constructor({ input = process.stdin, output = process.stdout, terminal = Boolean(input.isTTY && output.isTTY), lineEnding = '\n' } = {}) {
    this.output = output; this.terminal = terminal; this.lineEnding = lineEnding; this.closed = false; this.muted = false; this.active = false; this.buffer = [];
    this.send = (value, encoding) => {
      const rendered = lineEnding === '\n' ? value : String(value).replace(/\r?\n/g, lineEnding);
      return encoding === 'buffer' ? output.write(rendered) : output.write(rendered, encoding);
    };
    this.writer = new Writable({ write: (chunk, encoding, callback) => { if (!this.muted) this.send(chunk, encoding); callback(); } });
    this.writer.isTTY = terminal;
    this.writer.columns = output.columns || 80;
    this.writer.rows = output.rows || 24;
    this.rl = readline.createInterface({ input, output: this.writer, terminal, historySize: 0 });
    this.rl.on('line', line => this.deliver(line));
    this.rl.on('SIGINT', () => { this.rl.write(null, { ctrl: true, name: 'u' }); this.deliver(CANCEL); });
    this.rl.on('close', () => { this.closed = true; this.deliver(null); });
  }
  deliver(value) { if (this.waiting) { const resolve = this.waiting; this.waiting = null; resolve(value); } else this.buffer.push(value); }
  async read(prompt, secret = false) {
    if (this.closed) return null;
    this.active = true; this.muted = secret; this.prompt = prompt;
    this.rl.setPrompt(secret ? '' : prompt);
    if (secret) this.send(prompt); else this.rl.prompt();
    const line = this.buffer.length ? this.buffer.shift() : await new Promise(resolve => { this.waiting = resolve; });
    this.active = false; this.muted = false;
    if (secret || line === CANCEL) this.send(this.lineEnding);
    if (!this.rl.terminal && typeof line === 'string' && !secret) this.send(line + this.lineEnding);
    return line;
  }
  async ask(prompt, secret = false) {
    const value = await this.read(prompt, secret);
    if (value === null || value === CANCEL) throw new Error('Cancelled.');
    return value;
  }
  write(message) { this.send(message + this.lineEnding); }
  log(line, stream = this.output) {
    if (!this.active || this.closed) { stream.write(line); return; }
    if (this.rl.terminal) { readline.clearLine(this.output, 0); readline.cursorTo(this.output, 0); }
    stream.write(line);
    if (this.muted) this.send(this.prompt);
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
