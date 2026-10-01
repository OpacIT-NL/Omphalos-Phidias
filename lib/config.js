'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validateLogLevel } = require('./logger');
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
function defaultConfig() {
  return { port: 3000, host: '127.0.0.1', 'log-level': 3, 'file-log-level': 3, 'projects-directory': 'projects', auth: { database: 'data/auth.sqlite', secureCookies: false }, console: { enablePasswordHash: null } };
}
function normalizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.json must contain an object');
  const config = { ...defaultConfig(), ...structuredClone(value) };
  if (!Object.hasOwn(value, 'file-log-level')) config['file-log-level'] = config['log-level'];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('config.json: port must be an integer between 1 and 65535');
  if (typeof config.host !== 'string' || !net.isIP(config.host)) throw new Error('config.json: host must be an IPv4 or IPv6 address');
  validateLogLevel(config['log-level']);
  validateLogLevel(config['file-log-level'], 'file-log-level');
  if (typeof config['projects-directory'] !== 'string' || !config['projects-directory'].trim()) throw new Error('config.json: projects-directory must be a directory path');
  for (const key of ['auth', 'console']) {
    if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) throw new Error(`config.json: ${key} must be an object`);
    config[key] = { ...defaultConfig()[key], ...config[key] };
  }
  if (typeof config.auth.database !== 'string' || !config.auth.database.trim()) throw new Error('config.json: auth.database must be a file path');
  if (typeof config.auth.secureCookies !== 'boolean') throw new Error('config.json: auth.secureCookies must be a boolean');
  const hash = config.console.enablePasswordHash;
  if (hash !== null && (typeof hash !== 'string' || !/^\$argon2id\$v=19\$/.test(hash))) throw new Error('config.json: console.enablePasswordHash must be an Argon2id hash or null');
  return config;
}
function ensureConfig(file = CONFIG_FILE) {
  if (fs.existsSync(file)) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(defaultConfig(), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Publish a complete file without replacing one created by another process.
    try { fs.linkSync(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { fs.rmSync(temporary, { force: true }); }
}
function loadConfig(file = CONFIG_FILE, { create = false } = {}) {
  if (create) ensureConfig(file);
  const document = normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  const root = path.dirname(file);
  return { document, port: document.port, host: document.host, logLevel: document['log-level'], fileLogLevel: document['file-log-level'], directory: path.resolve(root, document['projects-directory']), authDatabase: path.resolve(root, document.auth.database), secureCookies: document.auth.secureCookies };
}
function atomicWrite(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, contents, { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
class ConfigState {
  constructor(file = CONFIG_FILE, apply = async () => {}) {
    this.file = file;
    this.running = loadConfig(file).document;
    this.saved = structuredClone(this.running);
    this.apply = apply;
  }
  async set(keys, value) {
    const next = structuredClone(this.running);
    const target = keys.slice(0, -1).reduce((object, key) => object[key], next);
    target[keys.at(-1)] = value;
    const checked = normalizeConfig(next);
    await this.apply(checked, this.running);
    this.running = checked;
  }
  dirty() { return JSON.stringify(this.running) !== JSON.stringify(this.saved); }
  startup() { return loadConfig(this.file).document; }
  save(auth) {
    const contents = JSON.stringify(normalizeConfig(this.running), null, 2) + '\n';
    const previous = fs.readFileSync(this.file);
    // The callback returns a restoration operation if the SQLite commit fails.
    auth.commitPendingUsers(() => {
      atomicWrite(this.file, contents);
      return () => atomicWrite(this.file, previous);
    });
    this.saved = structuredClone(this.running);
  }
}
module.exports = { loadConfig, normalizeConfig, defaultConfig, ensureConfig, ConfigState };
