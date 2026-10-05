'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Auth } = require('./lib/auth');
const { loadConfig, ConfigState } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { Store } = require('./lib/store');
const { readBody } = require('./runtime/app');
const { version } = require('./package.json');
const htmlVersion = version.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const repositoryPage = (folder, entries) => {
  const title = folder ? `Repository / ${folder}` : 'Repository';
  const sorted = entries.slice().sort((left, right) => {
    if (left.directory !== right.directory) return left.directory ? -1 : 1;
    if (left.name === 'latest.zip') return -1;
    if (right.name === 'latest.zip') return 1;
    const leftRevision = Number(left.name.match(/\.rev(\d+)\.zip$/)?.[1] || -1), rightRevision = Number(right.name.match(/\.rev(\d+)\.zip$/)?.[1] || -1);
    return rightRevision - leftRevision || left.name.localeCompare(right.name);
  });
  const rows = sorted.map(entry => {
    const href = folder ? `/repo/${encodeURIComponent(folder)}/${encodeURIComponent(entry.name)}` : `/repo/${encodeURIComponent(entry.name)}/`;
    const size = entry.directory ? 'Folder' : `${Math.max(1, Math.ceil(entry.size / 1024)).toLocaleString()} KB`;
    const modified = entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam' }) : '';
    return `<a class="repo-row" href="${href}"><strong>${entry.directory ? '▸ ' : ''}${escapeHTML(entry.name)}</strong><span>${escapeHTML(size)}</span><time>${escapeHTML(modified)}</time></a>`;
  }).join('') || '<p class="repo-empty">This repository folder is empty.</p>';
  const parent = folder ? '<a class="repo-parent" href="/repo/">← Repository</a>' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · OpacIT Omphalos Phidias</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#1e1f22;color:#f2f3f5}*{box-sizing:border-box}body{margin:0;padding:32px;background:#1e1f22}.repo{width:min(900px,100%);margin:auto}.repo-head{padding-bottom:18px;border-bottom:1px solid #47494f}.repo-head h1{margin:6px 0 0;font-size:22px}.repo-head small,.repo-parent,.repo-row span,.repo-row time,.repo-empty{color:#b5bac1}.repo-parent{display:inline-block;text-decoration:none}.repo-list{margin-top:12px;border:1px solid #47494f;border-radius:7px;overflow:hidden;background:#2b2d31}.repo-row{display:grid;grid-template-columns:minmax(180px,1fr) 90px 180px;gap:16px;padding:12px 14px;border-bottom:1px solid #47494f;color:#f2f3f5;text-decoration:none}.repo-row:last-child{border-bottom:0}.repo-row:hover{background:#35373c}.repo-row span,.repo-row time{text-align:right;font-size:12px}.repo-empty{padding:28px;text-align:center}@media(max-width:620px){body{padding:16px}.repo-row{grid-template-columns:1fr auto}.repo-row time{display:none}}</style></head><body><main class="repo"><header class="repo-head">${parent}<small>OpacIT Omphalos Phidias</small><h1>${escapeHTML(title)}</h1></header><section class="repo-list">${rows}</section></main></body></html>`;
};
const assets = new Map([['/', ['index.html', 'text/html']], ['/login', ['login.html', 'text/html']], ['/login.js', ['login.js', 'text/javascript']], ['/editor.js', ['editor.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
async function createServer({ directory = loadConfig().directory, repositoryDirectory, authDatabase = loadConfig().authDatabase, secureCookies = loadConfig().secureCookies, logger = createLogger({ level: loadConfig().logLevel, fileLevel: loadConfig().fileLogLevel, directory: path.join(__dirname, 'log') }), closeResourcesOnClose = true } = {}) {
  const store = new Store(directory, repositoryDirectory); await store.init();
  const auth = new Auth(authDatabase, { secureCookies });
  const projectAccess = (username, id) => ['login_rc', 'login_prod', 'view', 'edit', 'promote', 'delete'].filter(permission => auth.hasProject(username, id, permission));
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    // Only log the path, never queries, headers, cookies, or request bodies.
    let requestPath = '(invalid URL)';
    res.on('finish', () => {
      if (res.statusCode >= 400 && res.statusCode < 500) logger.warning('Request rejected: %s %s (%d)', req.method, requestPath, res.statusCode);
      logger.debug('Request completed: %s %s (%d, %d ms)', req.method, requestPath, res.statusCode, Date.now() - started);
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      requestPath = url.pathname;
      logger.debug('Request received: %s %s', req.method, requestPath);
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return send(403, { error: 'Cross-origin writes are not allowed' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Send application/json' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const body = await readBody(req);
        const session = await auth.login(body?.username, body?.password, req.socket.remoteAddress);
        auth.logout(req); // Rotate any existing session on a fresh sign-in.
        res.setHeader('Set-Cookie', auth.cookie(session.token));
        logger.info('User signed in');
        return send(200, { username: session.username, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
      }
      const session = auth.session(req);
      if (url.pathname === '/repo') {
        res.writeHead(308, { location: '/repo/' }); return res.end();
      }
      const repositoryDirectoryMatch = url.pathname.match(/^\/repo\/(?:([a-zA-Z0-9._-]+)\/?)?$/);
      if (repositoryDirectoryMatch) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Method not allowed' });
        const folder = repositoryDirectoryMatch[1] || null;
        if (folder && !url.pathname.endsWith('/')) {
          res.writeHead(308, { location: `${url.pathname}/` }); return res.end();
        }
        const page = repositoryPage(folder, await store.repositoryEntries(folder));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(page) });
        return res.end(req.method === 'HEAD' ? undefined : page);
      }
      const repositoryMatch = url.pathname.match(/^\/repo\/([^/]+)\/([^/]+\.zip)$/);
      if (repositoryMatch) {
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Method not allowed' });
        const archive = await store.repositoryFile(repositoryMatch[1], repositoryMatch[2]);
        // Deployment profiles can repackage a revision for its channel, so clients must revalidate numbered ZIPs too.
        res.setHeader('Cache-Control', 'no-cache');
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': archive.length, 'content-disposition': `attachment; filename="${repositoryMatch[2]}"` });
        return res.end(req.method === 'HEAD' ? undefined : archive);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!session) return send(401, { error: 'Sign in to continue.' });
        if (!['GET', 'HEAD'].includes(req.method)) auth.checkCSRF(req, session);
        if (url.pathname === '/api/session' && req.method === 'GET') return send(200, { ...session, permissions: { manageUsers: auth.hasCore(session.username, 'manage_users'), createProjects: auth.hasCore(session.username, 'create_projects'), console: auth.hasCore(session.username, 'console') } });
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          auth.logout(req);
          res.setHeader('Set-Cookie', auth.cookie());
          logger.info('User signed out');
          return send(200, { ok: true });
        }
        const accessUserMatch = url.pathname.match(/^\/api\/access\/users(?:\/([^/]+)(?:\/(password))?)?$/);
        const accessGroupMatch = url.pathname.match(/^\/api\/access\/groups(?:\/(\d+)(?:\/(members))?)?$/);
        const accessGrantMatch = url.pathname.match(/^\/api\/access\/grants\/(core|projects\/([^/]+))\/(user|group)\/(\d+)$/);
        if (url.pathname === '/api/access' || accessUserMatch || accessGroupMatch || accessGrantMatch) {
          auth.requireCore(session.username, 'manage_users');
          if (url.pathname === '/api/access' && req.method === 'GET') return send(200, auth.accessModel(await store.list()));
          if (accessUserMatch) {
            const [, encodedUsername, passwordAction] = accessUserMatch;
            if (!encodedUsername && req.method === 'POST') {
              const body = await readBody(req), username = await auth.createManagedUser(body?.username, body?.password);
              logger.info('User created by %s: %s', session.username, username); return send(201, { username });
            }
            let username;
            try { username = encodedUsername ? decodeURIComponent(encodedUsername) : null; } catch { return send(400, { error: 'Invalid username' }); }
            if (username && passwordAction === 'password' && req.method === 'PUT') {
              await auth.resetManagedPassword(username, (await readBody(req))?.password);
              logger.info('User password reset by %s: %s', session.username, username); return send(200, { ok: true });
            }
            if (username && !passwordAction && req.method === 'DELETE') {
              if (username.toLowerCase() === session.username) throw Object.assign(new Error('You cannot delete your own signed-in account.'), { status: 409 });
              auth.deleteManagedUser(username); logger.info('User deleted by %s: %s', session.username, username); return send(200, { ok: true });
            }
          }
          if (accessGroupMatch) {
            const [, idText, membersAction] = accessGroupMatch;
            if (!idText && req.method === 'POST') return send(201, { id: auth.createGroup((await readBody(req))?.name) });
            if (idText && membersAction === 'members' && req.method === 'PUT') { auth.setGroupMembers(Number(idText), (await readBody(req))?.usernames); return send(200, { ok: true }); }
            if (idText && !membersAction && req.method === 'DELETE') { auth.deleteGroup(Number(idText)); return send(200, { ok: true }); }
          }
          if (accessGrantMatch && req.method === 'PUT') {
            const [, scopeText, projectId, principalType, principalId] = accessGrantMatch;
            auth.setGrants(principalType, Number(principalId), scopeText === 'core' ? 'core' : projectId, (await readBody(req))?.permissions);
            return send(200, { ok: true });
          }
          return send(405, { error: 'Method not allowed' });
        }
        if (url.pathname === '/api/projects') {
          if (req.method === 'GET') return send(200, (await store.list()).filter(project => auth.hasProject(session.username, project.id, 'view')).map(project => ({ ...project, access: projectAccess(session.username, project.id) })));
          if (req.method === 'POST') {
            auth.requireCore(session.username, 'create_projects');
            const project = await store.create((await readBody(req))?.name);
            auth.grantProjectOwner(session.username, project.id);
            logger.info('Project created: %s', project.id);
            return send(201, { ...project, access: projectAccess(session.username, project.id) });
          }
        }
        const deploymentConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deployment-configs(?:\/(RC|Prod))?$/);
        if (deploymentConfigMatch) {
          const [, id, channel] = deploymentConfigMatch;
          if (!channel && req.method === 'GET') { auth.requireProject(session.username, id, 'view'); return send(200, await store.deploymentConfigs(id)); }
          if (channel && req.method === 'PUT') {
            auth.requireProject(session.username, id, 'edit');
            const configurations = await store.saveDeploymentConfig(id, channel, await readBody(req));
            logger.info('Project %s deployment settings saved: %s', id, channel);
            return send(200, configurations);
          }
          return send(405, { error: 'Method not allowed' });
        }
        const templateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/templates(?:\/([^/]+))?$/);
        if (templateMatch) {
          const [, id, encodedName] = templateMatch;
          let name = null;
          if (encodedName) {
            try { name = decodeURIComponent(encodedName); }
            catch { return send(400, { error: 'Invalid template name' }); }
          }
          if (req.method === 'GET') auth.requireProject(session.username, id, 'view');
          else auth.requireProject(session.username, id, 'edit');
          if (!name && req.method === 'GET') return send(200, await store.templates(id));
          if (!name) return send(405, { error: 'Method not allowed' });
          if (req.method === 'GET') return send(200, await store.template(id, name));
          if (req.method === 'PUT') {
            const body = await readBody(req);
            const saved = await store.saveTemplate(id, name, body?.contents, body?.previousName ?? null, body?.revision);
            logger.info('Project template saved: %s/%s (revision %d)', id, name, saved.project.revision);
            return send(200, saved);
          }
          if (req.method === 'DELETE') {
            const body = await readBody(req);
            const project = await store.deleteTemplate(id, name, body?.revision);
            logger.info('Project template deleted: %s/%s (revision %d)', id, name, project.revision);
            return send(200, project);
          }
          return send(405, { error: 'Method not allowed' });
        }
        const versionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions(?:\/(\d+)(?:\/(promote|restore))?)?$/);
        if (versionMatch) {
          const [, id, revisionText, action] = versionMatch;
          if (!revisionText && req.method === 'GET') { auth.requireProject(session.username, id, 'view'); return send(200, await store.versions(id)); }
          if (!revisionText) return send(405, { error: 'Method not allowed' });
          const revision = Number(revisionText);
          if (req.method === 'POST' && action === 'promote') {
            auth.requireProject(session.username, id, 'promote');
            const promoted = await store.promote(id, revision);
            logger.info('Project revision promoted: %s (revision %d)', id, revision);
            return send(200, promoted);
          }
          if (req.method === 'POST' && action === 'restore') {
            auth.requireProject(session.username, id, 'edit');
            const body = await readBody(req);
            const restored = await store.restore(id, revision, body?.revision);
            logger.info('Project revision restored: %s (revision %d as revision %d)', id, revision, restored.revision);
            return send(200, restored);
          }
          if (req.method === 'DELETE' && !action) {
            auth.requireProject(session.username, id, 'edit');
            const removed = await store.deleteVersion(id, revision);
            logger.info('Project revision deleted: %s (revision %d)', id, revision);
            return send(200, removed);
          }
          return send(405, { error: 'Method not allowed' });
        }
        const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(blocks|export))?$/);
        if (match) {
          const [, id, action] = match;
          if (req.method === 'GET') auth.requireProject(session.username, id, 'view');
          if (req.method === 'GET' && action === 'blocks') {
            await store.get(id);
            return send(200, [...store.definitions(id).values()].map(({ execute, ...metadata }) => metadata));
          }
          if (req.method === 'GET' && action === 'export') {
            const archive = await store.export(id);
            logger.info('Project exported: %s', id);
            res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="phidias-${id}.zip"` }); return res.end(archive);
          }
          if (req.method === 'GET' && !action) return send(200, { ...(await store.get(id)), access: projectAccess(session.username, id) });
          if (req.method === 'PUT' && !action) {
            auth.requireProject(session.username, id, 'edit');
            const body = await readBody(req);
            if (!body || typeof body !== 'object') return send(400, { error: 'Expected a project document' });
            const project = await store.save(id, body);
            logger.info('Project saved: %s (revision %d)', id, project.revision);
            return send(200, project);
          }
          if (req.method === 'DELETE' && !action) {
            auth.requireProject(session.username, id, 'delete');
            const removed = await store.deleteProject(id); auth.deleteProjectGrants(id);
            logger.info('Project deleted by %s: %s', session.username, id); return send(200, removed);
          }
        }
        return send(404, { error: 'API route not found' });
      }
      if (req.method === 'GET' && ((url.pathname === '/' && !session) || (url.pathname === '/login' && session))) {
        res.writeHead(303, { location: session ? '/' : '/login' }); return res.end();
      }
      if (req.method !== 'GET' || !assets.has(url.pathname)) return send(404, { error: 'Not found' });
      const [file, type] = assets.get(url.pathname);
      const contents = await fs.readFile(path.join(__dirname, 'public', file));
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
      res.end(type === 'text/html' ? contents.toString().replaceAll('{{APP_VERSION}}', htmlVersion) : contents);
    } catch (error) {
      if (!error.status || error.status >= 500) logger.error('Request failed: %s %s: %s', req.method, requestPath, error.stack || error.message);
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      send(error.status || 500, { error: error.status ? error.message : 'An unexpected server error occurred' });
    }
  });
  server.on('close', () => { if (closeResourcesOnClose) { auth.close(); logger.info('Server stopped'); } });
  return { server, store, auth };
}
async function listen(server, host, port) {
  await new Promise((resolve, reject) => {
    const failure = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failure); resolve(); };
    server.once('error', failure); server.once('listening', ready);
    server.listen(port, host);
  });
}
async function closeListener(server) {
  if (!server.listening) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => server.closeAllConnections(), 8000);
    timer.unref();
    server.close(() => { clearTimeout(timer); resolve(); });
    server.closeIdleConnections();
  });
}
if (require.main === module) {
  let logger, terminal, application, state, stopping = false;
  function critical(message, error) {
    try { (logger || createLogger({ level: 0, directory: path.join(__dirname, 'log') })).critical('%s: %s', message, error?.stack || error); }
    catch { process.stderr.write(`${new Date().toISOString()} [CRITICAL] ${message}: ${String(error?.message || error).replace(/[\r\n]/g, ' ')}\n`); }
  }
  process.once('uncaughtException', error => { critical('Uncaught exception', error); process.exit(1); });
  process.once('unhandledRejection', error => { critical('Unhandled rejection', error); process.exit(1); });
  async function shutdown(reason) {
    if (stopping) return;
    stopping = true;
    if (state?.dirty() || application?.auth.pendingUsers.size) logger?.warning('Stopping with unsaved running configuration or accounts');
    logger?.info('Stopping server (%s)', reason);
    terminal?.close();
    if (application) { await closeListener(application.server); application.auth.close(); }
    logger?.info('Server stopped');
  }
  (async () => {
    const config = loadConfig(undefined, { create: true });
    logger = createLogger({ level: config.logLevel, fileLevel: config.fileLogLevel, directory: path.join(__dirname, 'log'),
      stdout: { write: line => terminal ? terminal.log(line) : process.stdout.write(line) },
      stderr: { write: line => terminal ? terminal.log(line, process.stderr) : process.stderr.write(line) }
    });
    application = await createServer({ directory: config.directory, authDatabase: config.authDatabase, secureCookies: config.secureCookies, logger, closeResourcesOnClose: false });
    state = new ConfigState(undefined, async (next, previous) => {
      if (next.host !== previous.host || next.port !== previous.port) {
        await closeListener(application.server);
        try { await listen(application.server, next.host, next.port); }
        catch (error) {
          try { await listen(application.server, previous.host, previous.port); }
          catch (restoreError) { critical('Could not restore previous listener; change host/port to recover', restoreError); }
          throw new Error(`Cannot listen on ${next.host}:${next.port} (${error.code || error.message}). Configuration was not changed.`);
        }
        logger.info('Server listener changed to %s:%d', next.host, next.port);
      }
      logger.setLevel(next['log-level']);
      logger.setFileLevel(next['file-log-level']);
      application.auth.secureCookies = next.auth.secureCookies;
    });
    await listen(application.server, config.host, config.port);
    logger.info('OpacIT Omphalos Phidias v%s: http://%s:%d', version, config.host.includes(':') ? `[${config.host}]` : config.host, config.port);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shutdown(signal).catch(error => { critical('Shutdown failed', error); process.exit(1); }); });
    // Process managers such as CubeCoders AMP expose their console through a
    // pipe rather than a TTY. Readline supports both, so attach whenever stdin
    // is available instead of requiring an interactive terminal.
    if (process.stdin && !process.stdin.destroyed && process.stdin.readable !== false) {
      const { Terminal } = require('./lib/terminal');
      const { CommandConsole } = require('./lib/console');
      terminal = new Terminal();
      const engine = new CommandConsole({ config: state, auth: application.auth, logger,
        ask: (prompt, secret) => terminal.ask(prompt, secret), write: message => terminal.write(message),
        shutdown: () => shutdown('console'),
        status: () => {
          const address = application.server.address();
          return `Listener: ${address ? `${address.address}:${address.port}` : 'not listening'}. Storage path changes require a restart.`;
        }
      });
      terminal.write('OpacIT Omphalos Phidias console. Type help or enable.');
      await terminal.run(engine);
    }
  })().catch(async error => {
    critical('Could not start server', error); process.exitCode = 1;
    await shutdown('startup failure');
  });
}
module.exports = { createServer };
