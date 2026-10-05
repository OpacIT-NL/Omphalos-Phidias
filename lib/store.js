'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validate, ensureNumberIds } = require('../runtime/validate');
const { loadDefinitions } = require('../runtime/app');
const { zip } = require('./zip');
const root = path.resolve(__dirname, '..');
const automationDependencies = { argon2: '^0.45.1', 'basic-ftp': '^5.0.5', mysql2: '^3.15.3', ssh2: '^1.17.0' };
const json = value => JSON.stringify(value, null, 2) + '\n';
const idPattern = /^[a-f0-9-]{36}$/;
const error = (message, status) => Object.assign(new Error(message), { status });
const safeName = name => String(name || 'application').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80) || 'application';
const atomicWrite = async (file, contents) => {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(temp, contents); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
};
const validateAppConfig = config => {
  if (config === null || config === undefined) return null;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw error('Application settings must contain a host and port', 400);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw error('Application port must be an integer between 1 and 65535', 400);
  if (typeof config.host !== 'string' || !net.isIP(config.host)) throw error('Application host must be an IPv4 or IPv6 address', 400);
  const logLevel = config['log-level'] ?? 3;
  if (!Number.isInteger(logLevel) || logLevel < 0 || logLevel > 4) throw error('Application log level must be an integer between 0 and 4', 400);
  return { port: config.port, host: config.host, 'log-level': logLevel };
};
class Store {
  constructor(directory, repositoryDirectory = path.join(path.dirname(path.resolve(directory)), 'repo')) {
    this.directory = path.resolve(directory); this.repositoryDirectory = path.resolve(repositoryDirectory); this.locks = new Map();
  }
  location(id) { if (!idPattern.test(id)) throw error('Invalid project ID', 400); return path.join(this.directory, id); }
  async init() { await Promise.all([fs.mkdir(this.directory, { recursive: true }), fs.mkdir(this.repositoryDirectory, { recursive: true })]); }
  async repositoryFile(folder, filename) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(folder) || !/^[a-zA-Z0-9._-]{1,120}\.zip$/.test(filename)) throw error('Repository file not found', 404);
    try { return await fs.readFile(path.join(this.repositoryDirectory, folder, filename)); }
    catch (err) { if (err.code === 'ENOENT') throw error('Repository file not found', 404); throw err; }
  }
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
    if (project.workspaceCategories === undefined) project.workspaceCategories = [];
    ensureNumberIds(project);
    const definitions = this.definitions(id);
    for (const workspace of project.workspaces || []) for (const block of workspace.blocks || []) {
      const definition = definitions.get(block.type);
      if (!definition || !block.options || typeof block.options !== 'object') continue;
      const declared = new Set(definition.fields.map(field => field.key));
      for (const field of definition.fields) {
        if (!Object.hasOwn(block.options, field.key) && field.default !== undefined) {
          block.options[field.key] = block.type === 'respond' && field.key === 'format' ? 'Auto' : structuredClone(field.default);
        }
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
      await fs.copyFile(path.join(root, 'runtime/auth.js'), path.join(staging, 'auth.js'));
      await fs.copyFile(path.join(root, 'runtime/logger.js'), path.join(staging, 'logger.js'));
      await fs.writeFile(path.join(staging, 'package.json'), json({ name: `phidias-${id}`, version: '1.0.0', private: true, scripts: { start: 'node app.js' }, engines: { node: '>=22' }, dependencies: automationDependencies }));
      await fs.writeFile(path.join(staging, 'README.md'), '# Automation built with OpacIT Omphalos Phidias\n\nRun `npm install` once, then `node app.js` using Node.js 22 or newer. If config.json is included, its port and host are ready to use; otherwise first launch creates it and you can edit it before restarting. PORT and HOST remain optional overrides. Log level 0–4 is read from config.json. Each launch writes console output to a new log/yyyy-mm-dd-N.txt file. Stop with SIGINT or SIGTERM. See workspaces.json for workflow definitions and blocks/ for block implementations. Authentication blocks accept a SQLite path and can use a compatible Phidias builder auth database; keep that database outside folders replaced during application updates.\n');
      const project = { version: 1, id, name: name.trim(), appConfig: null, workspaceCategories: [], revision: 1, updatedAt: new Date().toISOString(), workspaces: [{ id: randomUUID(), numberId: 1, name: 'Main workspace', active: true, blocks: [
        { id: 'endpoint', numberId: 1, type: 'http', x: 100, y: 120, options: { method: 'GET', path: '/hello' } },
        { id: 'response', numberId: 2, type: 'respond', x: 460, y: 120, options: { status: 200, format: 'Text', body: 'Hello from Phidias' } }
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
      const next = { version: 1, id, name: document.name.trim(), appConfig: validateAppConfig(document.appConfig), workspaceCategories: document.workspaceCategories || [], revision: current.revision + 1, updatedAt: new Date().toISOString(), workspaces: document.workspaces };
      const archive = await this.archive(id, next);
      await atomicWrite(path.join(this.location(id), 'workspaces.json'), json(next));
      await this.publishRevision(id, next, archive);
      return next;
    });
  }
  async archive(id, project) {
      validate(project, this.definitions(id));
      const directory = this.location(id), files = [];
      for (const name of ['app.js', 'validate.js', 'legacy.js', 'cron.js', 'auth.js', 'logger.js']) files.push([name, await fs.readFile(path.join(root, 'runtime', name))]);
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
  }
  async export(id) {
    return this.exclusive(id, async () => this.archive(id, await this.get(id)));
  }
  versionsFile(id) { return path.join(this.location(id), 'versions.json'); }
  snapshotFile(id, revision) { return path.join(this.location(id), 'versions', `rev${revision}.json`); }
  async readVersions(id) {
    await this.get(id);
    try {
      const entries = JSON.parse(await fs.readFile(this.versionsFile(id), 'utf8'));
      return Array.isArray(entries) ? entries : [];
    } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }
  versionView(entry) {
    const filename = `${entry.slug.toLowerCase()}.rev${entry.revision}.zip`;
    return {
      revision: entry.revision, name: entry.name, createdAt: entry.createdAt, channels: entry.channels,
      rcUrl: entry.channels.includes('RC') ? `/repo/${entry.slug}RC/${filename}` : null,
      prodUrl: entry.channels.includes('Prod') ? `/repo/${entry.slug}Prod/${filename}` : null
    };
  }
  async versions(id) {
    return (await this.readVersions(id)).sort((a, b) => b.revision - a.revision).map(entry => this.versionView(entry));
  }
  archivePath(folder, filename) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(folder) || !/^[a-zA-Z0-9._-]{1,120}\.zip$/.test(filename)) throw error('Invalid repository path', 400);
    return path.join(this.repositoryDirectory, folder, filename);
  }
  revisionPaths(entry, channel) {
    const folder = `${entry.slug}${channel}`;
    return { revision: this.archivePath(folder, `${entry.slug.toLowerCase()}.rev${entry.revision}.zip`), latest: this.archivePath(folder, 'latest.zip') };
  }
  async publishRevision(id, project, archive) {
    const entries = await this.readVersions(id);
    const entry = { revision: project.revision, name: project.name, slug: safeName(project.name), createdAt: project.updatedAt, channels: ['RC'] };
    const paths = this.revisionPaths(entry, 'RC');
    await atomicWrite(paths.revision, archive);
    await atomicWrite(paths.latest, archive);
    await atomicWrite(this.snapshotFile(id, project.revision), json(project));
    entries.push(entry);
    await atomicWrite(this.versionsFile(id), json(entries));
  }
  async promote(id, revision) {
    return this.exclusive(id, async () => {
      const entries = await this.readVersions(id), entry = entries.find(item => item.revision === revision);
      if (!entry) throw error('Revision not found', 404);
      let archive;
      try { archive = await fs.readFile(this.revisionPaths(entry, 'RC').revision); }
      catch (err) { if (err.code === 'ENOENT') throw error('The RC archive for this revision is missing', 409); throw err; }
      const destination = this.revisionPaths(entry, 'Prod');
      await atomicWrite(destination.revision, archive);
      await atomicWrite(destination.latest, archive);
      if (!entry.channels.includes('Prod')) entry.channels.push('Prod');
      await atomicWrite(this.versionsFile(id), json(entries));
      return this.versionView(entry);
    });
  }
  async restore(id, revision, expectedRevision) {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      if (expectedRevision !== current.revision) throw error('This project changed in another editor. Reload the project before restoring.', 409);
      const entries = await this.readVersions(id);
      if (!entries.some(item => item.revision === revision)) throw error('Revision not found', 404);
      let snapshot;
      try { snapshot = JSON.parse(await fs.readFile(this.snapshotFile(id, revision), 'utf8')); }
      catch (err) { if (err.code === 'ENOENT') throw error('The recovery data for this revision is missing', 409); throw err; }
      const next = { ...snapshot, id, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      this.sanitize(next, id); validate(next, this.definitions(id));
      const archive = await this.archive(id, next);
      await atomicWrite(path.join(this.location(id), 'workspaces.json'), json(next));
      await this.publishRevision(id, next, archive);
      return next;
    });
  }
  async refreshLatest(entries, channel) {
    const latestEntry = entries.filter(entry => entry.channels.includes(channel)).sort((a, b) => b.revision - a.revision)[0];
    const folders = new Set(entries.map(entry => `${entry.slug}${channel}`));
    for (const folder of folders) await fs.rm(this.archivePath(folder, 'latest.zip'), { force: true });
    if (!latestEntry) return;
    const paths = this.revisionPaths(latestEntry, channel);
    await atomicWrite(paths.latest, await fs.readFile(paths.revision));
  }
  async deleteVersion(id, revision) {
    return this.exclusive(id, async () => {
      const current = await this.get(id), entries = await this.readVersions(id), index = entries.findIndex(item => item.revision === revision);
      if (index < 0) throw error('Revision not found', 404);
      if (revision === current.revision) throw error('The current revision cannot be deleted', 409);
      const [entry] = entries.splice(index, 1);
      for (const channel of entry.channels) {
        const paths = this.revisionPaths(entry, channel);
        await fs.rm(paths.revision, { force: true });
        await fs.rm(paths.latest, { force: true });
      }
      await fs.rm(this.snapshotFile(id, revision), { force: true });
      await Promise.all(['RC', 'Prod'].map(channel => this.refreshLatest(entries, channel)));
      await atomicWrite(this.versionsFile(id), json(entries));
      return { ok: true };
    });
  }
}
module.exports = { Store };
