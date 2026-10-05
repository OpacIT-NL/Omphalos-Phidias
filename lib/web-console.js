'use strict';

const MAX_INPUT = 10000;
const MAX_OUTPUT = 200000;

class WebConsoleSession {
  constructor(factory) {
    this.output = [];
    this.question = null;
    this.running = null;
    this.waiters = [];
    this.lastUsed = Date.now();
    this.engine = factory({
      ask: (prompt, secret) => this.ask(prompt, secret),
      write: message => this.write(message)
    });
    if (!this.engine || typeof this.engine.execute !== 'function') throw new Error('Invalid web console factory');
  }
  signal() {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
  write(message) {
    const text = String(message);
    this.output.push(text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[output truncated]` : text);
    while (this.output.length > 100) this.output.shift();
    this.signal();
  }
  ask(prompt, secret = false) {
    return new Promise((resolve, reject) => {
      this.question = { prompt: String(prompt), secret: Boolean(secret), resolve, reject };
      this.signal();
    });
  }
  snapshot() {
    this.lastUsed = Date.now();
    const result = {
      output: this.output.splice(0),
      mode: this.engine.mode,
      prompt: this.question?.prompt || this.engine.prompt,
      secret: Boolean(this.question?.secret),
      busy: Boolean(this.running && !this.question)
    };
    return result;
  }
  async waitForState(milliseconds = 100) {
    if (this.question || !this.running || this.output.length) return;
    let timer;
    await Promise.race([
      new Promise(resolve => this.waiters.push(resolve)),
      new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })
    ]);
    clearTimeout(timer);
  }
  async submit(input) {
    if (typeof input !== 'string' || input.length > MAX_INPUT) throw Object.assign(new Error('Console input must be text no longer than 10,000 characters.'), { status: 400 });
    this.lastUsed = Date.now();
    if (this.question) {
      const question = this.question;
      this.question = null;
      question.resolve(input);
    } else {
      if (this.running) throw Object.assign(new Error('The previous console command is still running.'), { status: 409 });
      this.running = Promise.resolve(this.engine.execute(input)).finally(() => { this.running = null; this.signal(); });
    }
    await this.waitForState();
    return this.snapshot();
  }
  close() {
    if (this.question) {
      const question = this.question;
      this.question = null;
      question.reject(new Error('Console session closed.'));
    }
    this.engine.cancel?.();
    this.signal();
  }
}

module.exports = { WebConsoleSession };
