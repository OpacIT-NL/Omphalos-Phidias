'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

const LEVELS = Object.freeze({ critical: 0, error: 1, warning: 2, info: 3, debug: 4 });

function normalizeLogValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Error || value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set || value instanceof URL || Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    const result = new Array(value.length);
    seen.set(value, result);
    for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: normalizeLogValue(value[key], seen), enumerable: true, configurable: true, writable: true });
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return value;
  const result = {};
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (Object.hasOwn(descriptor, 'value')) descriptor.value = normalizeLogValue(descriptor.value, seen);
    Object.defineProperty(result, key, descriptor);
  }
  return result;
}
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
  let filename = createLogFile(directory, now().toISOString().slice(0, 10));
  const subscribers = new Set(), recent = [];
  const makeLine = (name, values) => {
    const timestamp = now().toISOString();
    const message = format(...values.map(value => normalizeLogValue(value)))
      .replace(/\r\n?|\n/g, '\n')
      .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const lines = message.split('\n');
    if (message.endsWith('\n')) lines.pop();
    if (!lines.length) lines.push('');
    const prefix = `${timestamp} [${name.toUpperCase()}] `;
    return { timestamp, line: lines.map(line => prefix + line).join('\n') + '\n' };
  };
  const append = ({ timestamp, line }) => {
    try { fs.appendFileSync(filename, line, { encoding: 'utf8', mode: 0o600 }); }
    catch (error) { stderr.write(`${timestamp} [CRITICAL] Cannot write log file (${error.code || 'unknown error'}).\n`); }
  };
  const publish = (name, rendered) => {
    const entry = Object.freeze({ level: name, timestamp: rendered.timestamp, line: rendered.line.trimEnd() });
    recent.push(entry);
    if (recent.length > 500) recent.splice(0, recent.length - 500);
    for (const subscriber of subscribers) {
      try { subscriber(entry); } catch {}
    }
  };
  function write(name, values) {
    const severity = LEVELS[name];
    if (severity > level && severity > fileLevel) return;
    const rendered = makeLine(name, values);
    if (severity <= level) {
      (severity <= LEVELS.warning ? stderr : stdout).write(rendered.line);
      publish(name, rendered);
    }
    if (severity <= fileLevel) append(rendered);
  }
  function forceWrite(name, values) {
    const rendered = makeLine(name, values);
    (LEVELS[name] <= LEVELS.warning ? stderr : stdout).write(rendered.line);
    publish(name, rendered);
    append(rendered);
  }
  return Object.freeze({
    get filename() { return filename; },
    notice(...values) {
      const rendered = makeLine('info', values);
      stdout.write(rendered.line);
      publish('info', rendered);
      if (LEVELS.info <= fileLevel) append(rendered);
    },
    forceInfo(...values) { forceWrite('info', values); },
    forceWarning(...values) { forceWrite('warning', values); },
    forceError(...values) { forceWrite('error', values); },
    ...Object.fromEntries(Object.keys(LEVELS).map(name => [name, (...values) => write(name, values)])),
    setLevel(value) { level = validateLogLevel(value); },
    setFileLevel(value) { fileLevel = validateLogLevel(value, 'file-log-level'); },
    subscribe(subscriber, { replay = true } = {}) {
      if (typeof subscriber !== 'function') throw new TypeError('Log subscriber must be a function');
      if (replay) for (const entry of recent) subscriber(entry);
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    startNewCycle() {
      filename = createLogFile(directory, now().toISOString().slice(0, 10));
      return filename;
    }
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
