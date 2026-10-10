'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validateLogLevel } = require('./logger');
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
function defaultConfig() {
  return {
    port: 3000,
    host: '127.0.0.1',
    'log-level': 3,
    'file-log-level': 3,
    'projects-directory': 'projects',
    auth: { provider: 'sqlite', database: 'data/auth.sqlite', mysql: null, secureCookies: false, broker: { enabled: false, host: '0.0.0.0', port: 3002 } },
    console: { enablePasswordHash: null, forceInputLog: false }
  };
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
  if (!['sqlite', 'mysql'].includes(config.auth.provider)) throw new Error('config.json: auth.provider must be sqlite or mysql');
  if (config.auth.mysql !== null) {
    const mysql = config.auth.mysql;
    if (!mysql || typeof mysql !== 'object' || Array.isArray(mysql)) throw new Error('config.json: auth.mysql must be an object or null');
    if (typeof mysql.host !== 'string' || !mysql.host.trim()) throw new Error('config.json: auth.mysql.host is required');
    if (!Number.isInteger(mysql.port) || mysql.port < 1 || mysql.port > 65535) throw new Error('config.json: auth.mysql.port must be between 1 and 65535');
    for (const key of ['username','password','database']) if (typeof mysql[key] !== 'string' || !mysql[key].length) throw new Error(`config.json: auth.mysql.${key} is required`);
    config.auth.mysql = { host: mysql.host.trim(), port: mysql.port, username: mysql.username, password: mysql.password, database: mysql.database };
  }
  if (config.auth.provider === 'mysql' && !config.auth.mysql) throw new Error('config.json: auth.mysql is required when auth.provider is mysql');
  if (typeof config.auth.secureCookies !== 'boolean') throw new Error('config.json: auth.secureCookies must be a boolean');
  if (!config.auth.broker || typeof config.auth.broker !== 'object' || Array.isArray(config.auth.broker)) throw new Error('config.json: auth.broker must be an object');
  config.auth.broker = { ...defaultConfig().auth.broker, ...config.auth.broker };
  if (typeof config.auth.broker.enabled !== 'boolean') throw new Error('config.json: auth.broker.enabled must be a boolean');
  if (typeof config.auth.broker.host !== 'string' || !net.isIP(config.auth.broker.host)) throw new Error('config.json: auth.broker.host must be an IPv4 or IPv6 address');
  if (!Number.isInteger(config.auth.broker.port) || config.auth.broker.port < 1 || config.auth.broker.port > 65535) throw new Error('config.json: auth.broker.port must be between 1 and 65535');
  const hash = config.console.enablePasswordHash;
  if (hash !== null && (typeof hash !== 'string' || !/^\$argon2id\$v=19\$/.test(hash))) throw new Error('config.json: console.enablePasswordHash must be an Argon2id hash or null');
  if (typeof config.console.forceInputLog !== 'boolean') throw new Error('config.json: console.forceInputLog must be a boolean');
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
  const authDatabase = path.resolve(root, document.auth.database);
  return { document, port: document.port, host: document.host, logLevel: document['log-level'], fileLogLevel: document['file-log-level'], directory: path.resolve(root, document['projects-directory']), authDatabase, authConfig: { ...document.auth, database: authDatabase }, configFile: file, secureCookies: document.auth.secureCookies };
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
  async save(auth) {
    const contents = JSON.stringify(normalizeConfig(this.running), null, 2) + '\n';
    const previous = fs.readFileSync(this.file);
    const backendIdentity = auth => ({ provider: auth.provider, database: auth.database, mysql: auth.mysql });
    const backendChanged = JSON.stringify(backendIdentity(this.running.auth)) !== JSON.stringify(backendIdentity(this.saved.auth));
    if (backendChanged) {
      await auth.commitPendingUsers(() => () => {});
      const { migrateAuth } = require('./auth-backend');
      const target = { ...this.running.auth, database: path.resolve(path.dirname(this.file), this.running.auth.database) };
      await migrateAuth(auth, target, target.database);
      try { atomicWrite(this.file, contents); }
      catch (error) { atomicWrite(this.file, previous); throw error; }
      this.saved = structuredClone(this.running); return;
    }
    // The callback returns a restoration operation if the SQLite commit fails.
    await auth.commitPendingUsers(() => {
      atomicWrite(this.file, contents);
      return () => atomicWrite(this.file, previous);
    });
    this.saved = structuredClone(this.running);
  }
}
module.exports = { loadConfig, normalizeConfig, defaultConfig, ensureConfig, ConfigState };
