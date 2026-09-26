'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validate } = require('../runtime/validate');
const { loadDefinitions } = require('../runtime/app');
const { zip } = require('./zip');
const root = path.resolve(__dirname, '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const idPattern = /^[a-f0-9-]{36}$/;
const error = (message, status) => Object.assign(new Error(message), { status });
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
    try { return JSON.parse(await fs.readFile(path.join(this.location(id), 'workspaces.json'), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') throw error('Project not found', 404); throw err; }
  }
  definitions(id) { return loadDefinitions(path.join(this.location(id), 'blocks')); }
  async create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw error('Use a project name of 1–100 characters', 400);
    const id = randomUUID(), staging = path.join(this.directory, `.creating-${id}`);
    await fs.mkdir(staging);
    try {
      await fs.cp(path.join(root, 'blocks'), path.join(staging, 'blocks'), { recursive: true });
      await fs.copyFile(path.join(root, 'runtime/app.js'), path.join(staging, 'app.js'));
      await fs.copyFile(path.join(root, 'runtime/validate.js'), path.join(staging, 'validate.js'));
      await fs.writeFile(path.join(staging, 'package.json'), json({ name: `phidias-${id}`, version: '1.0.0', private: true, scripts: { start: 'node app.js' }, engines: { node: '>=22' } }));
      await fs.writeFile(path.join(staging, 'README.md'), '# Automation built with OpacIT Omphalos Phidias\n\nRun `node app.js` using Node.js 22 or newer. Set PORT (default 3001) and HOST (default 0.0.0.0). No installation is required. Stop with SIGINT or SIGTERM. See workspaces.json for workflow definitions and blocks/ for block implementations.\n');
      const project = { version: 1, id, name: name.trim(), revision: 1, updatedAt: new Date().toISOString(), workspaces: [{ id: randomUUID(), name: 'Main workspace', active: true, blocks: [
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
      if (document.revision !== current.revision) throw error('This project changed in another editor. Reload the project before saving.', 409);
      validate(document, this.definitions(id));
      const next = { version: 1, id, name: document.name.trim(), revision: current.revision + 1, updatedAt: new Date().toISOString(), workspaces: document.workspaces };
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
      for (const name of ['app.js', 'validate.js', 'package.json', 'README.md']) files.push([name, await fs.readFile(path.join(directory, name))]);
      files.push(['workspaces.json', json(project)]);
      for (const entry of await fs.readdir(path.join(directory, 'blocks'), { withFileTypes: true })) {
        if (entry.isFile() && /^[a-z0-9_-]+\.js$/.test(entry.name)) files.push([`blocks/${entry.name}`, await fs.readFile(path.join(directory, 'blocks', entry.name))]);
      }
      return zip(files);
    });
  }
}
module.exports = { Store };
