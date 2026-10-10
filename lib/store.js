'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validate, ensureNumberIds } = require('../runtime/validate');
const { loadDefinitions } = require('../runtime/app');
const { zip, entries: zipEntries, replaceFile } = require('./zip');
const root = path.resolve(__dirname, '..');
const automationDependencies = { argon2: '^0.45.1', 'basic-ftp': '^5.0.5', mssql: '^12.7.4', mysql2: '^3.15.3', pg: '^8.23.1', ssh2: '^1.17.0' };
const json = value => JSON.stringify(value, null, 2) + '\n';
const idPattern = /^[a-f0-9-]{36}$/;
const authenticationBlockTypes = new Set(['display_login', 'check_if_logged_in', 'login_through_api', 'check_api_token', 'logout', 'get_current_logged_in_user']);
const templateNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,95}\.(?:html|css)$/i;
const defaultAppConfig = Object.freeze({ port: 3001, host: '0.0.0.0', 'log-level': 3, 'force-console-input-log': false, 'database-credential-set': null, 'logging-database-credential-set': null, 'auth-storage': 'sqlite', 'credential-broker-url': null, 'update-url': null });
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
  const forceConsoleInputLog = config['force-console-input-log'] ?? false;
  if (typeof forceConsoleInputLog !== 'boolean') throw error('Force Console Log block output must be true or false', 400);
  const databaseCredentialSet = config['database-credential-set'] ?? null;
  if (databaseCredentialSet !== null && (typeof databaseCredentialSet !== 'string' || !idPattern.test(databaseCredentialSet))) throw error('Select a valid database credential set', 400);
  const loggingDatabaseCredentialSet = config['logging-database-credential-set'] ?? null;
  if (loggingDatabaseCredentialSet !== null && (typeof loggingDatabaseCredentialSet !== 'string' || !idPattern.test(loggingDatabaseCredentialSet))) throw error('Select a valid logging database credential set', 400);
  const authStorage = config['auth-storage'] ?? 'sqlite';
  if (!['sqlite', 'mysql'].includes(authStorage)) throw error('Authentication storage must be SQLite or MySQL', 400);
  const credentialBrokerUrl = config['credential-broker-url'] ?? null;
  if (credentialBrokerUrl !== null) {
    if (typeof credentialBrokerUrl !== 'string' || credentialBrokerUrl.length > 2048) throw error('Credential broker URL must be an HTTP or HTTPS URL', 400);
    let parsed;
    try { parsed = new URL(credentialBrokerUrl); } catch { throw error('Credential broker URL must be an HTTP or HTTPS URL', 400); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw error('Credential broker URL must be an HTTP or HTTPS URL without embedded credentials', 400);
  }
  if (authStorage === 'mysql' && !credentialBrokerUrl) throw error('A credential broker URL is required for MySQL authentication storage', 400);
  const updateUrl = config['update-url'] ?? null;
  if (updateUrl !== null) {
    if (typeof updateUrl !== 'string' || updateUrl.length > 2048) throw error('Update URL must be an HTTP or HTTPS URL', 400);
    let parsed;
    try { parsed = new URL(updateUrl); } catch { throw error('Update URL must be an HTTP or HTTPS URL', 400); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw error('Update URL must be an HTTP or HTTPS URL without embedded credentials', 400);
  }
  return { port: config.port, host: config.host, 'log-level': logLevel, 'force-console-input-log': forceConsoleInputLog, 'auth-storage': authStorage, ...(credentialBrokerUrl ? { 'credential-broker-url': credentialBrokerUrl.replace(/\/$/, '') } : {}), ...(databaseCredentialSet ? { 'database-credential-set': databaseCredentialSet } : {}), ...(loggingDatabaseCredentialSet ? { 'logging-database-credential-set': loggingDatabaseCredentialSet } : {}), ...(updateUrl ? { 'update-url': updateUrl } : {}) };
};
class Store {
  constructor(directory, repositoryDirectory = path.join(path.dirname(path.resolve(directory)), 'repo'), { databaseCredential = null, authDatabase = null, applicationKey = null } = {}) {
    this.directory = path.resolve(directory); this.repositoryDirectory = path.resolve(repositoryDirectory); this.locks = new Map();
    this.databaseCredential = databaseCredential; this.authDatabase = authDatabase ? path.resolve(authDatabase) : null; this.applicationKey = applicationKey;
  }
  location(id) { if (!idPattern.test(id)) throw error('Invalid project ID', 400); return path.join(this.directory, id); }
  async init() {
    await Promise.all([fs.mkdir(this.directory, { recursive: true }), fs.mkdir(this.repositoryDirectory, { recursive: true })]);
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
      const filename = path.join(this.location(entry.name), 'workspaces.json');
      let project;
      try { project = JSON.parse(await fs.readFile(filename, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const before = JSON.stringify(project);
      this.sanitize(project, entry.name);
      if (JSON.stringify(project) !== before) await atomicWrite(filename, json(project));
    }
  }
  async repositoryFile(folder, filename) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(folder) || !/^[a-zA-Z0-9._-]{1,120}\.zip$/.test(filename)) throw error('Repository file not found', 404);
    try {
      const file = path.join(this.repositoryDirectory, folder, filename), details = await fs.lstat(file);
      if (!details.isFile()) throw error('Repository file not found', 404);
      return await fs.readFile(file);
    }
    catch (err) { if (err.code === 'ENOENT') throw error('Repository file not found', 404); throw err; }
  }
  async repositoryEntries(folder = null) {
    if (folder !== null && !/^[a-zA-Z0-9._-]{1,100}$/.test(folder)) throw error('Repository folder not found', 404);
    const directory = folder === null ? this.repositoryDirectory : path.join(this.repositoryDirectory, folder);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      if (folder === null) return entries.filter(entry => entry.isDirectory() && /^[a-zA-Z0-9._-]{1,100}$/.test(entry.name)).map(entry => ({ name: entry.name, directory: true }));
      const files = entries.filter(entry => entry.isFile() && /^[a-zA-Z0-9._-]{1,120}\.zip$/.test(entry.name));
      return await Promise.all(files.map(async entry => {
        const details = await fs.stat(path.join(directory, entry.name));
        return { name: entry.name, directory: false, size: details.size, modifiedAt: details.mtime.toISOString() };
      }));
    } catch (err) { if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw error('Repository folder not found', 404); throw err; }
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
  async databaseCredentialUsage(credentialId) {
    const usage = [];
    for (const project of await this.list()) {
      const configurations = await this.deploymentConfigs(project.id);
      for (const channel of ['RC', 'Prod']) {
        if (configurations[channel]?.['database-credential-set'] === credentialId) usage.push({ projectId: project.id, projectName: project.name, channel, role: 'application' });
        if (configurations[channel]?.['logging-database-credential-set'] === credentialId) usage.push({ projectId: project.id, projectName: project.name, channel, role: 'logging' });
      }
    }
    return usage;
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
  async clearBlockCache(id) {
    await this.get(id);
    const directories = [path.join(root, 'blocks'), path.join(this.location(id), 'blocks')].map(directory => path.resolve(directory));
    let cleared = 0;
    for (const filename of Object.keys(require.cache)) {
      const resolved = path.resolve(filename);
      if (!directories.some(directory => resolved === directory || resolved.startsWith(directory + path.sep))) continue;
      delete require.cache[filename]; cleared++;
    }
    return { cleared, definitions: this.definitions(id) };
  }
  sanitize(project, id) {
    project.appConfig = validateAppConfig(project.appConfig);
    if (project.workspaceCategories === undefined) project.workspaceCategories = [];
    ensureNumberIds(project);
    const definitions = this.definitions(id);
    for (const workspace of project.workspaces || []) {
      const authenticationBlocks = new Set((workspace.blocks || []).filter(block => authenticationBlockTypes.has(block.type)).map(block => block.id));
      for (const block of workspace.blocks || []) if (authenticationBlocks.has(block.id) && block.options && typeof block.options === 'object') delete block.options.database;
      workspace.connections = (workspace.connections || []).filter(connection => !(authenticationBlocks.has(connection.to) && connection.input === 'database'));
    }
    for (const workspace of project.workspaces || []) for (const block of workspace.blocks || []) {
      const definition = definitions.get(block.type);
      if (!definition || !block.options || typeof block.options !== 'object') continue;
      if (block.type === 'database_sql_file_option') block.options = {};
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
      await fs.mkdir(path.join(staging, 'html'));
      await fs.copyFile(path.join(root, 'runtime/app.js'), path.join(staging, 'app.js'));
      await fs.copyFile(path.join(root, 'runtime/validate.js'), path.join(staging, 'validate.js'));
      await fs.copyFile(path.join(root, 'runtime/legacy.js'), path.join(staging, 'legacy.js'));
      await fs.copyFile(path.join(root, 'runtime/cron.js'), path.join(staging, 'cron.js'));
      await fs.copyFile(path.join(root, 'runtime/auth.js'), path.join(staging, 'auth.js'));
      await fs.copyFile(path.join(root, 'runtime/logger.js'), path.join(staging, 'logger.js'));
      await fs.copyFile(path.join(root, 'runtime/sqlite.js'), path.join(staging, 'sqlite.js'));
      await fs.copyFile(path.join(root, 'runtime/favicon.ico'), path.join(staging, 'favicon.ico'));
      await fs.writeFile(path.join(staging, 'package.json'), json({ name: `phidias-${id}`, version: '1.0.0', private: true, scripts: { start: 'node app.js' }, engines: { node: '>=22' }, dependencies: automationDependencies }));
      await fs.writeFile(path.join(staging, 'README.md'), '# Automation built with OpacIT Omphalos Phidias\n\nRun `npm install` once, then `node app.js` using Node.js 22 or newer. If config.json is included, its port and host are ready to use; otherwise first launch creates it and you can edit it before restarting. PORT and HOST remain optional overrides. Log level 0–4 is read from config.json. Each launch writes console output to a new log/yyyy-mm-dd-N.txt file. Stop with SIGINT or SIGTERM. See workspaces.json for workflow definitions, blocks/ for block implementations, and html/ for HTML and CSS templates used by Get Template. Authentication blocks use `auth.database` from config.json; keep that SQLite database outside folders replaced during application updates.\n');
      const project = { version: 1, id, name: name.trim(), appConfig: null, workspaceCategories: [], revision: 1, updatedAt: new Date().toISOString(), workspaces: [{ id: randomUUID(), numberId: 1, name: 'Main workspace', active: true, forceLog: false, logAllRunsToBlock: false, blocks: [
        { id: 'endpoint', numberId: 1, type: 'http', x: 100, y: 120, options: { method: 'GET', path: '/hello' } },
        { id: 'response', numberId: 2, type: 'respond', x: 460, y: 120, options: { status: 200, format: 'Text', body: 'Hello from Phidias' } }
      ], connections: [{ id: randomUUID(), from: 'endpoint', output: 'next', to: 'response' }] }] };
      await fs.writeFile(path.join(staging, 'workspaces.json'), json(project));
      await fs.writeFile(path.join(staging, 'deployment-configs.json'), json({ RC: null, Prod: null }));
      await fs.rename(staging, this.location(id));
      return project;
    } catch (err) { await fs.rm(staging, { recursive: true, force: true }); throw err; }
  }
  async importArchive(archive, { name = null } = {}) {
    if (!Buffer.isBuffer(archive) || !archive.length) throw error('Choose a non-empty ZIP archive', 400);
    let entries;
    try { entries = zipEntries(archive, { maxFiles: 2000, maxEntrySize: 25 * 1024 * 1024, maxTotalSize: 100 * 1024 * 1024 }); }
    catch (failure) { throw error(`Could not read ZIP archive: ${failure.message}`, 400); }
    const clean = new Map();
    for (const [rawName, contents] of entries) {
      const entryName = String(rawName).replaceAll('\\', '/');
      if (!entryName || entryName.includes('\0') || entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName) || entryName.split('/').includes('..')) throw error('ZIP archive contains an unsafe path', 400);
      if (entryName.endsWith('/')) continue;
      if (clean.has(entryName)) throw error(`ZIP archive contains duplicate file ${entryName}`, 400);
      clean.set(entryName, contents);
    }
    let prefix = '';
    if (!clean.has('workspaces.json')) {
      const candidates = [...clean.keys()].filter(value => value.endsWith('/workspaces.json'));
      if (candidates.length !== 1) throw error('ZIP archive must contain workspaces.json', 400);
      prefix = candidates[0].slice(0, -'workspaces.json'.length);
      if ([...clean.keys()].some(value => !value.startsWith(prefix))) throw error('ZIP archive must contain one application folder', 400);
    }
    const file = relative => clean.get(prefix + relative);
    const workspaceFile = file('workspaces.json');
    if (!workspaceFile || workspaceFile.length > 10 * 1024 * 1024) throw error('workspaces.json is missing or too large', 400);
    let source;
    try { source = JSON.parse(workspaceFile.toString('utf8')); } catch { throw error('workspaces.json does not contain valid JSON', 400); }
    const projectName = String(name || source?.name || 'Imported application').trim();
    const created = await this.create(projectName);
    try {
      const imported = {
        version: 1, id: created.id, name: projectName, appConfig: null,
        workspaceCategories: Array.isArray(source.workspaceCategories) ? source.workspaceCategories : [],
        revision: 1, updatedAt: new Date().toISOString(), workspaces: source.workspaces
      };
      if (!Array.isArray(imported.workspaces) || !imported.workspaces.length) throw error('The imported application has no workspaces', 400);
      this.sanitize(imported, created.id); validate(imported, this.definitions(created.id));
      const htmlDirectory = this.templateDirectory(created.id);
      await fs.rm(htmlDirectory, { recursive: true, force: true }); await fs.mkdir(htmlDirectory, { recursive: true });
      for (const [entryName, contents] of clean) {
        const relative = entryName.slice(prefix.length);
        if (!relative.startsWith('html/')) continue;
        const templateName = relative.slice(5);
        if (!templateNamePattern.test(templateName) || templateName.includes('/')) throw error(`Invalid HTML template filename: ${templateName}`, 400);
        if (contents.length > 2 * 1024 * 1024) throw error(`HTML template is too large: ${templateName}`, 400);
        await atomicWrite(path.join(htmlDirectory, templateName), contents);
      }
      let deployment = null;
      if (file('config.json')) {
        try {
          const config = JSON.parse(file('config.json').toString('utf8'));
          const databaseId = config.database?.['credential-set'], loggingId = config['logging-database']?.['credential-set'];
          deployment = validateAppConfig({
            port: config.port ?? defaultAppConfig.port, host: config.host ?? defaultAppConfig.host,
            'log-level': config['log-level'] ?? defaultAppConfig['log-level'],
            'force-console-input-log': config['force-console-input-log'] ?? false,
            'auth-storage': config.auth?.provider === 'mysql' ? 'mysql' : 'sqlite',
            'credential-broker-url': config.auth?.broker?.url || null,
            ...(databaseId && this.databaseCredential?.(databaseId) ? { 'database-credential-set': databaseId } : {}),
            ...(loggingId && this.databaseCredential?.(loggingId) ? { 'logging-database-credential-set': loggingId } : {}),
            'update-url': config['update-url'] || null
          });
        } catch (failure) { if (failure.status) throw failure; throw error(`Invalid imported config.json: ${failure.message}`, 400); }
      }
      await atomicWrite(path.join(this.location(created.id), 'workspaces.json'), json(imported));
      await atomicWrite(this.deploymentConfigsFile(created.id), json({ RC: deployment, Prod: null }));
      return imported;
    } catch (failure) {
      await fs.rm(this.location(created.id), { recursive: true, force: true }); throw failure;
    }
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
  deploymentConfigsFile(id) { return path.join(this.location(id), 'deployment-configs.json'); }
  async deploymentConfigs(id) {
    const project = await this.get(id);
    try {
      const stored = JSON.parse(await fs.readFile(this.deploymentConfigsFile(id), 'utf8'));
      return { RC: validateAppConfig(stored?.RC), Prod: validateAppConfig(stored?.Prod) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const legacy = validateAppConfig(project.appConfig);
      const migrated = { RC: legacy ? { ...legacy } : null, Prod: legacy ? { ...legacy } : null };
      await atomicWrite(this.deploymentConfigsFile(id), json(migrated));
      return migrated;
    }
  }
  async packagedConfig(id, channel, config) {
    const selected = validateAppConfig(config) || defaultAppConfig;
    const credentialId = selected['database-credential-set'];
    const loggingCredentialId = selected['logging-database-credential-set'];
    if (credentialId && (!this.databaseCredential || !(await this.databaseCredential(credentialId)))) throw error('The selected database credential set no longer exists', 409);
    if (loggingCredentialId && (!this.databaseCredential || !(await this.databaseCredential(loggingCredentialId)))) throw error('The selected logging database credential set no longer exists', 409);
    const { ['database-credential-set']: _selection, ['logging-database-credential-set']: _loggingSelection, ['auth-storage']: authStorage, ['credential-broker-url']: credentialBrokerUrl, ['update-url']: updateUrl, ...application } = selected;
    const auth = authStorage === 'mysql'
      ? { provider: 'mysql', broker: { url: credentialBrokerUrl } }
      : { database: this.authDatabase || 'data/auth.sqlite' };
    return { ...application, ...(updateUrl ? { 'update-url': updateUrl } : {}), auth, ...(credentialId ? { database: { 'credential-set': credentialId } } : {}), ...(loggingCredentialId ? { 'logging-database': { 'credential-set': loggingCredentialId } } : {}), 'project-id': id, 'release-channel': channel };
  }
  async configureArchive(archive, id, channel, config) {
    return replaceFile(archive, 'config.json', json(await this.packagedConfig(id, channel, config)));
  }
  async saveDeploymentConfig(id, channel, config) {
    if (!['RC', 'Prod'].includes(channel)) throw error('Deployment channel must be RC or Prod', 400);
    return this.exclusive(id, async () => {
      const configurations = await this.deploymentConfigs(id);
      configurations[channel] = validateAppConfig(config);
      if (configurations[channel]?.['database-credential-set'] && (!this.databaseCredential || !(await this.databaseCredential(configurations[channel]['database-credential-set'])))) throw error('The selected database credential set no longer exists', 400);
      if (configurations[channel]?.['logging-database-credential-set'] && (!this.databaseCredential || !(await this.databaseCredential(configurations[channel]['logging-database-credential-set'])))) throw error('The selected logging database credential set no longer exists', 400);
      await atomicWrite(this.deploymentConfigsFile(id), json(configurations));
      const entries = await this.readVersions(id);
      for (const entry of entries.filter(item => item.channels.includes(channel))) {
        const paths = this.revisionPaths(entry, channel);
        try {
          const archive = await fs.readFile(paths.revision);
          await atomicWrite(paths.revision, await this.configureArchive(archive, id, channel, configurations[channel]));
        } catch (err) { if (err.code !== 'ENOENT') throw err; }
      }
      await this.refreshLatest(entries, channel);
      return configurations;
    });
  }
  async archive(id, project, config = undefined, includeApplicationKey = false) {
      validate(project, this.definitions(id));
      const directory = this.location(id), files = [];
      for (const name of ['app.js', 'validate.js', 'legacy.js', 'cron.js', 'auth.js', 'logger.js', 'sqlite.js', 'favicon.ico']) files.push([name, await fs.readFile(path.join(root, 'runtime', name))]);
      const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json')));
      metadata.dependencies = { ...(metadata.dependencies || {}), ...automationDependencies };
      files.push(['package.json', json(metadata)]);
      files.push(['README.md', await fs.readFile(path.join(directory, 'README.md'))]);
      files.push(['workspaces.json', json(project)]);
      if (includeApplicationKey) {
        if (!this.applicationKey) throw error('Application key service is unavailable', 503);
        files.push(['application.key', await this.applicationKey(id)]);
      }
      const applicationConfig = config === undefined ? (await this.deploymentConfigs(id)).RC : validateAppConfig(config);
      files.push(['config.json', json(await this.packagedConfig(id, 'RC', applicationConfig))]);
      const htmlDirectory = path.join(directory, 'html');
      await fs.mkdir(htmlDirectory, { recursive: true });
      for (const entry of await fs.readdir(htmlDirectory, { withFileTypes: true })) {
        if (entry.isFile() && templateNamePattern.test(entry.name)) files.push([`html/${entry.name}`, await fs.readFile(path.join(htmlDirectory, entry.name))]);
      }
      const blockFiles = new Map();
      const retiredBlockFiles = new Set(['http.js', 'request.js', 'respond.js']);
      for (const source of [path.join(root, 'blocks'), path.join(directory, 'blocks')]) {
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
          if (retiredBlockFiles.has(entry.name)) continue;
          if (entry.isFile() && /^[a-z0-9_-]+\.(?:js|cjs)$/.test(entry.name) && !blockFiles.has(entry.name)) blockFiles.set(entry.name, await fs.readFile(path.join(source, entry.name)));
        }
      }
      for (const [name, contents] of blockFiles) files.push([`blocks/${name}`, contents]);
      return zip(files);
  }
  async export(id) {
    return this.exclusive(id, async () => this.archive(id, await this.get(id), undefined, true));
  }
  versionsFile(id) { return path.join(this.location(id), 'versions.json'); }
  snapshotFile(id, revision) { return path.join(this.location(id), 'versions', `rev${revision}.json`); }
  snapshotHTMLDirectory(id, revision) { return path.join(this.location(id), 'versions', `rev${revision}-html`); }
  templateDirectory(id) { return path.join(this.location(id), 'html'); }
  templateFile(id, name) {
    if (typeof name !== 'string' || !templateNamePattern.test(name)) throw error('Template names must end in .html or .css and contain only letters, numbers, spaces, dots, underscores, or hyphens', 400);
    return path.join(this.templateDirectory(id), name);
  }
  async templates(id) {
    await this.get(id);
    await fs.mkdir(this.templateDirectory(id), { recursive: true });
    return (await fs.readdir(this.templateDirectory(id), { withFileTypes: true }))
      .filter(entry => entry.isFile() && templateNamePattern.test(entry.name)).map(entry => entry.name).sort((a, b) => a.localeCompare(b));
  }
  async template(id, name) {
    const project = await this.get(id);
    try {
      const file = this.templateFile(id, name), details = await fs.lstat(file);
      if (!details.isFile()) throw error('Template not found', 404);
      return { name, contents: await fs.readFile(file, 'utf8'), revision: project.revision };
    }
    catch (err) { if (err.code === 'ENOENT') throw error('Template not found', 404); throw err; }
  }
  async saveTemplate(id, name, contents, previousName, expectedRevision) {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      if (expectedRevision !== current.revision) throw error('This project changed in another editor. Reload the project before saving the template.', 409);
      if (typeof contents !== 'string') throw error('Template contents must be text', 400);
      if (Buffer.byteLength(contents, 'utf8') > 2 * 1024 * 1024) throw error('Template contents must not exceed 2 MiB', 413);
      const file = this.templateFile(id, name);
      const previousFile = previousName !== null && previousName !== undefined ? this.templateFile(id, previousName) : null;
      if (previousFile) {
        try { await fs.access(previousFile); } catch (err) { if (err.code === 'ENOENT') throw error('Template not found', 404); throw err; }
      }
      if (!previousFile || previousName !== name) {
        try { await fs.access(file); throw error('A template with that filename already exists', 409); }
        catch (err) { if (err.code !== 'ENOENT') throw err; }
      }
      await atomicWrite(file, contents);
      if (previousName && previousName !== name) await fs.rm(this.templateFile(id, previousName), { force: true });
      const next = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      const archive = await this.archive(id, next);
      await atomicWrite(path.join(this.location(id), 'workspaces.json'), json(next));
      await this.publishRevision(id, next, archive);
      // Confirm the final file after archive and revision publication. Returning
      // the request body here used to let the editor report success before it
      // knew that the on-disk template still contained the submitted text.
      const persistedContents = await fs.readFile(file, 'utf8');
      if (persistedContents !== contents) throw error('The template could not be verified after saving', 500);
      return { project: next, template: { name, contents: persistedContents } };
    });
  }
  async deleteTemplate(id, name, expectedRevision) {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      if (expectedRevision !== current.revision) throw error('This project changed in another editor. Reload the project before deleting the template.', 409);
      const file = this.templateFile(id, name);
      try { await fs.access(file); } catch (err) { if (err.code === 'ENOENT') throw error('Template not found', 404); throw err; }
      await fs.rm(file);
      const next = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      const archive = await this.archive(id, next);
      await atomicWrite(path.join(this.location(id), 'workspaces.json'), json(next));
      await this.publishRevision(id, next, archive);
      return next;
    });
  }
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
    const htmlSnapshot = this.snapshotHTMLDirectory(id, project.revision);
    await fs.rm(htmlSnapshot, { recursive: true, force: true });
    await fs.cp(this.templateDirectory(id), htmlSnapshot, { recursive: true });
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
      archive = await this.configureArchive(archive, id, 'Prod', (await this.deploymentConfigs(id)).Prod);
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
      const htmlSnapshot = this.snapshotHTMLDirectory(id, revision);
      try {
        const details = await fs.stat(htmlSnapshot);
        if (details.isDirectory()) {
          await fs.rm(this.templateDirectory(id), { recursive: true, force: true });
          await fs.cp(htmlSnapshot, this.templateDirectory(id), { recursive: true });
        }
      } catch (err) { if (err.code !== 'ENOENT') throw err; }
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
      await fs.rm(this.snapshotHTMLDirectory(id, revision), { recursive: true, force: true });
      await Promise.all(['RC', 'Prod'].map(channel => this.refreshLatest(entries, channel)));
      await atomicWrite(this.versionsFile(id), json(entries));
      return { ok: true };
    });
  }
  async deleteRCVersionsBefore(id, beforeRevision) {
    if (!Number.isInteger(beforeRevision) || beforeRevision < 1) throw error('Revision number must be a positive integer', 400);
    return this.exclusive(id, async () => {
      const current = await this.get(id), entries = await this.readVersions(id);
      const deleted = [], skippedProd = [], skippedCurrent = [];
      const kept = [];
      for (const entry of entries) {
        if (entry.revision >= beforeRevision) { kept.push(entry); continue; }
        if (entry.channels.includes('Prod')) { skippedProd.push(entry.revision); kept.push(entry); continue; }
        if (entry.revision === current.revision) { skippedCurrent.push(entry.revision); kept.push(entry); continue; }
        const paths = this.revisionPaths(entry, 'RC');
        await fs.rm(paths.revision, { force: true });
        await fs.rm(paths.latest, { force: true });
        await fs.rm(this.snapshotFile(id, entry.revision), { force: true });
        await fs.rm(this.snapshotHTMLDirectory(id, entry.revision), { recursive: true, force: true });
        deleted.push(entry.revision);
      }
      await this.refreshLatest(kept, 'RC');
      await atomicWrite(this.versionsFile(id), json(kept));
      return { deleted: deleted.sort((a, b) => a - b), skippedProd: skippedProd.sort((a, b) => a - b), skippedCurrent };
    });
  }
  async deleteProject(id) {
    return this.exclusive(id, async () => {
      const entries = await this.readVersions(id);
      const folders = new Set(entries.flatMap(entry => ['RC', 'Prod'].map(channel => `${entry.slug}${channel}`)));
      await fs.rm(this.location(id), { recursive: true, force: true });
      for (const folder of folders) await fs.rm(path.join(this.repositoryDirectory, folder), { recursive: true, force: true });
      return { ok: true };
    });
  }
}
module.exports = { Store };
