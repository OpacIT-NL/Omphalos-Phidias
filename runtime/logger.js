'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

const LEVELS = Object.freeze({ critical: 0, error: 1, warning: 2, info: 3, debug: 4 });
function validateLogLevel(level, name = 'log-level') {
  if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error(`config.json: ${name} must be an integer between 0 and 4`);
  return level;
}
function createLogFile(directory, date) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let sequence = 1; sequence <= 999999; sequence++) {
    const filename = path.join(directory, `${date}-${sequence}.txt`);
    try {
      const descriptor = fs.openSync(filename, 'wx', 0o600);
      fs.closeSync(descriptor);
      return filename;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Cannot allocate another log file for ${date}`);
}
function createLogger({ level = 3, fileLevel = level, directory = path.join(process.cwd(), 'log'), stdout = process.stdout, stderr = process.stderr, now = () => new Date() } = {}) {
  validateLogLevel(level);
  validateLogLevel(fileLevel, 'file-log-level');
  const filename = createLogFile(directory, now().toISOString().slice(0, 10));
  function write(name, values) {
    const severity = LEVELS[name];
    if (severity > level && severity > fileLevel) return;
    const timestamp = now().toISOString();
    const message = format(...values).replace(/[\x00-\x1f\x7f]/g, character => character === '\n' ? '\\n' : character === '\r' ? '\\r' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const line = `${timestamp} [${name.toUpperCase()}] ${message}\n`;
    if (severity <= level) (severity <= LEVELS.warning ? stderr : stdout).write(line);
    if (severity <= fileLevel) {
      try {
        fs.appendFileSync(filename, line, { encoding: 'utf8', mode: 0o600 });
      } catch (error) {
        stderr.write(`${timestamp} [CRITICAL] Cannot write log file (${error.code || 'unknown error'}).\n`);
      }
    }
  }
  return Object.freeze({
    filename,
    ...Object.fromEntries(Object.keys(LEVELS).map(name => [name, (...values) => write(name, values)])),
    setLevel(value) { level = validateLogLevel(value); },
    setFileLevel(value) { fileLevel = validateLogLevel(value, 'file-log-level'); }
  });
}
function installConsoleLogger(logger, target = console) {
  const original = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, target[name]]));
  target.log = (...values) => logger.info(...values);
  target.info = (...values) => logger.info(...values);
  target.warn = (...values) => logger.warning(...values);
  target.error = (...values) => logger.error(...values);
  target.debug = (...values) => logger.debug(...values);
  return () => Object.assign(target, original);
}
module.exports = { createLogger, validateLogLevel, installConsoleLogger, LEVELS };
