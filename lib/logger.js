'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

const LEVELS = Object.freeze({ critical: 0, error: 1, warning: 2, info: 3, debug: 4 });
function validateLogLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('config.json: log-level must be an integer between 0 and 4');
  return level;
}
function createLogger({ level = 3, directory = path.join(__dirname, '..', 'logs'), stdout = process.stdout, stderr = process.stderr, now = () => new Date() } = {}) {
  validateLogLevel(level);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  function write(name, values) {
    if (LEVELS[name] > level) return;
    const timestamp = now().toISOString();
    // Each event is one physical line, including errors and untrusted input.
    const message = format(...values).replace(/[\x00-\x1f\x7f]/g, character => character === '\n' ? '\\n' : character === '\r' ? '\\r' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const line = `${timestamp} [${name.toUpperCase()}] ${message}\n`;
    (LEVELS[name] <= LEVELS.warning ? stderr : stdout).write(line);
    try {
      fs.appendFileSync(path.join(directory, `${timestamp.slice(0, 10)}.log`), line, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      // Keep the console working if the disk fills; don't recursively log failures.
      stderr.write(`${timestamp} [CRITICAL] Cannot write log file (${error.code || 'unknown error'}).\n`);
    }
  }
  return Object.freeze({ ...Object.fromEntries(Object.keys(LEVELS).map(name => [name, (...values) => write(name, values)])), setLevel(value) { level = validateLogLevel(value); } });
}
module.exports = { createLogger, validateLogLevel, LEVELS };
