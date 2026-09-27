'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validate } = require('../runtime/validate');
const { loadDefinitions } = require('../runtime/app');
const { zip } = require('./zip');
const root = path.resolve(__dirname, '..');
const automationDependencies = { 'basic-ftp': '^5.0.5', mysql2: '^3.15.3', ssh2: '^1.17.0' };
const json = value => JSON.stringify(value, null, 2) + '\n';
const idPattern = /^[a-f0-9-]{36}$/;
const error = (message, status) => Object.assign(new Error(message), { status });
const validateAppConfig = config => {
  if (config === null || config === undefined) return null;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw error('Application settings must contain a host and port', 400);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw error('Application port must be an integer between 1 and 65535', 400);
  if (typeof config.host !== 'string' || !net.isIP(config.host)) throw error('Application host must be an IPv4 or IPv6 address', 400);
  return { port: config.port, host: config.host };
};
class Store {
  constructor(directory) { this.directory = path.resolve(directory); this.locks = new Map(); }
  location(id) { if (!idPattern.test(id)) throw error('Invalid project ID', 400); return path.join(this.directory, id); }
  async init() { await fs.mkdir(this.directory, { recursive: true }); }
  async list() {
    const result = [];
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
      const project = await this.get(entry.name);
      result.push({ id: entry.name, name: project.name, revision: project.revision, updatedAt: project.updatedAt });
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id) {
    try { return this.sanitize(JSON.parse(await fs.readFile(path.join(this.location(id), 'workspaces.json'), 'utf8')), id); }
    catch (err) { if (err.code === 'ENOENT') throw error('Project not found', 404); throw err; }
  }
  definitions(id) {
    const definitions = loadDefinitions(path.join(root, 'blocks'));
    const local = loadDefinitions(path.join(this.location(id), 'blocks'));
    // Bundled definitions receive compatibility and security fixes immediately;
    // project-only custom block types remain available.
    for (const [type, definition] of local) if (!definitions.has(type)) definitions.set(type, definition);
    return definitions;
  }
  sanitize(project, id) {
    project.appConfig = validateAppConfig(project.appConfig);
    const definitions = this.definitions(id);
    for (const workspace of project.workspaces || []) for (const block of workspace.blocks || []) {
      const definition = definitions.get(block.type);
      if (!definition || !block.options || typeof block.options !== 'object') continue;
      const declared = new Set(definition.fields.map(field => field.key));
      for (const field of definition.fields) {
        if (!Object.hasOwn(block.options, field.key) && field.default !== undefined) block.options[field.key] = structuredClone(field.default);
      }
      for (const input of definition.inputPorts.filter(port => port.kind === 'value')) {
        if (!declared.has(input.id)) delete block.options[input.id];
      }
    }
    return project;
  }
  async create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw error('Use a project name of 1–100 characters', 400);
    const id = randomUUID(), staging = path.join(this.directory, `.creating-${id}`);
    await fs.mkdir(staging);
    try {
      await fs.cp(path.join(root, 'blocks'), path.join(staging, 'blocks'), { recursive: true });
      await fs.copyFile(path.join(root, 'runtime/app.js'), path.join(staging, 'app.js'));
      await fs.copyFile(path.join(root, 'runtime/validate.js'), path.join(staging, 'validate.js'));
      await fs.copyFile(path.join(root, 'runtime/legacy.js'), path.join(staging, 'legacy.js'));
      await fs.copyFile(path.join(root, 'runtime/cron.js'), path.join(staging, 'cron.js'));
      await fs.writeFile(path.join(staging, 'package.json'), json({ name: `phidias-${id}`, version: '1.0.0', private: true, scripts: { start: 'node app.js' }, engines: { node: '>=22' }, dependencies: automationDependencies }));
      await fs.writeFile(path.join(staging, 'README.md'), '# Automation built with OpacIT Omphalos Phidias\n\nRun `npm install` once, then `node app.js` using Node.js 22 or newer. If config.json is included, its port and host are ready to use; otherwise first launch creates it and you can edit it before restarting. PORT and HOST remain optional overrides. Stop with SIGINT or SIGTERM. See workspaces.json for workflow definitions and blocks/ for block implementations.\n');
      const project = { version: 1, id, name: name.trim(), appConfig: null, revision: 1, updatedAt: new Date().toISOString(), workspaces: [{ id: randomUUID(), name: 'Main workspace', active: true, blocks: [
        { id: 'endpoint', type: 'http', x: 100, y: 120, options: { method: 'GET', path: '/hello' } },
        { id: 'response', type: 'respond', x: 460, y: 120, options: { status: 200, body: 'Hello from Phidias' } }
      ], connections: [{ id: randomUUID(), from: 'endpoint', output: 'next', to: 'response' }] }] };
      await fs.writeFile(path.join(staging, 'workspaces.json'), json(project));
      await fs.rename(staging, this.location(id));
      return project;
    } catch (err) { await fs.rm(staging, { recursive: true, force: true }); throw err; }
  }
  async exclusive(id, action) {
    const previous = this.locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action); this.locks.set(id, next);
    try { return await next; } finally { if (this.locks.get(id) === next) this.locks.delete(id); }
  }
  async save(id, document) {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      this.sanitize(document, id);
      if (document.revision !== current.revision) throw error('This project changed in another editor. Reload the project before saving.', 409);
      validate(document, this.definitions(id));
      const next = { version: 1, id, name: document.name.trim(), appConfig: validateAppConfig(document.appConfig), revision: current.revision + 1, updatedAt: new Date().toISOString(), workspaces: document.workspaces };
      const file = path.join(this.location(id), 'workspaces.json'), temp = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, json(next)); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return next;
    });
  }
  async export(id) {
    return this.exclusive(id, async () => {
      const project = await this.get(id); validate(project, this.definitions(id));
      const directory = this.location(id), files = [];
      for (const name of ['app.js', 'validate.js', 'legacy.js', 'cron.js']) files.push([name, await fs.readFile(path.join(root, 'runtime', name))]);
      const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json')));
      metadata.dependencies = { ...metadata.dependencies, ...automationDependencies };
      files.push(['package.json', json(metadata)]);
      files.push(['README.md', await fs.readFile(path.join(directory, 'README.md'))]);
      files.push(['workspaces.json', json(project)]);
      if (project.appConfig) files.push(['config.json', json(project.appConfig)]);
      const blockFiles = new Map();
      const retiredBlockFiles = new Set(['http.js', 'request.js', 'respond.js']);
      for (const source of [path.join(root, 'blocks'), path.join(directory, 'blocks')]) {
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
          if (retiredBlockFiles.has(entry.name)) continue;
          if (entry.isFile() && /^[a-z0-9_-]+\.js$/.test(entry.name) && !blockFiles.has(entry.name)) blockFiles.set(entry.name, await fs.readFile(path.join(source, entry.name)));
        }
      }
      for (const [name, contents] of blockFiles) files.push([`blocks/${name}`, contents]);
      return zip(files);
    });
  }
}
module.exports = { Store };
