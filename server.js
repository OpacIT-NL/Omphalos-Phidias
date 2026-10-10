'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Auth } = require('./lib/auth');
const { openAuth } = require('./lib/auth-backend');
const { createAuthBroker } = require('./lib/auth-broker');
const { loadConfig, ConfigState } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { Store } = require('./lib/store');
const { WebConsoleSession } = require('./lib/web-console');
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)} · OpacIT Omphalos Phidias</title><link rel="icon" href="/favicon.ico" sizes="any"><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#1e1f22;color:#f2f3f5}*{box-sizing:border-box}body{margin:0;padding:32px;background:#1e1f22}.repo{width:min(900px,100%);margin:auto}.repo-head{padding-bottom:18px;border-bottom:1px solid #47494f}.repo-head h1{margin:6px 0 0;font-size:22px}.repo-head small,.repo-parent,.repo-row span,.repo-row time,.repo-empty{color:#b5bac1}.repo-parent{display:inline-block;text-decoration:none}.repo-list{margin-top:12px;border:1px solid #47494f;border-radius:7px;overflow:hidden;background:#2b2d31}.repo-row{display:grid;grid-template-columns:minmax(180px,1fr) 90px 180px;gap:16px;padding:12px 14px;border-bottom:1px solid #47494f;color:#f2f3f5;text-decoration:none}.repo-row:last-child{border-bottom:0}.repo-row:hover{background:#35373c}.repo-row span,.repo-row time{text-align:right;font-size:12px}.repo-empty{padding:28px;text-align:center}@media(max-width:620px){body{padding:16px}.repo-row{grid-template-columns:1fr auto}.repo-row time{display:none}}</style></head><body><main class="repo"><header class="repo-head">${parent}<small>OpacIT Omphalos Phidias</small><h1>${escapeHTML(title)}</h1></header><section class="repo-list">${rows}</section></main></body></html>`;
};
const assets = new Map([['/', ['index.html', 'text/html']], ['/login', ['login.html', 'text/html']], ['/login.js', ['login.js', 'text/javascript']], ['/editor.js', ['editor.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/favicon.ico', ['favicon.ico', 'image/x-icon']]]);
async function readArchive(request, limit = 25 * 1024 * 1024) {
  if (Number(request.headers['content-length'] || 0) > limit) throw Object.assign(new Error('ZIP archive exceeds 25 MB'), { status: 413 });
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw Object.assign(new Error('ZIP archive exceeds 25 MB'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return publicAddress(normalized.slice(7));
    return normalized !== '::' && normalized !== '::1' && !normalized.startsWith('fc') && !normalized.startsWith('fd') && !normalized.startsWith('ff') && !/^fe[89ab]/.test(normalized) && !normalized.startsWith('2001:db8:');
  }
  return false;
}
async function downloadArchive(value, ownAuthority, limit = 25 * 1024 * 1024) {
  let current;
  try { current = new URL(value); } catch { throw Object.assign(new Error('Enter a valid HTTP or HTTPS ZIP URL'), { status: 400 }); }
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password) throw Object.assign(new Error('Enter an HTTP or HTTPS URL without embedded credentials'), { status: 400 });
    const sameOrigin = current.host === ownAuthority;
    const addresses = await dns.lookup(current.hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || (!sameOrigin && addresses.some(item => !publicAddress(item.address)))) throw Object.assign(new Error('ZIP URL must resolve to a public address or this Phidias server'), { status: 400 });
    const selected = addresses[0];
    const result = await new Promise((resolve, reject) => {
      const request = (current.protocol === 'https:' ? https : http).request(current, {
        method: 'GET', headers: { accept: 'application/zip, application/octet-stream;q=0.9' },
        lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family), timeout: 30_000
      }, response => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) { response.resume(); return resolve({ redirect: new URL(response.headers.location, current) }); }
        if (status < 200 || status >= 300) { response.resume(); return reject(Object.assign(new Error(`ZIP URL returned HTTP ${status}`), { status: 400 })); }
        if (Number(response.headers['content-length'] || 0) > limit) { response.destroy(); return reject(Object.assign(new Error('Downloaded ZIP archive exceeds 25 MB'), { status: 413 })); }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > limit) response.destroy(Object.assign(new Error('Downloaded ZIP archive exceeds 25 MB'), { status: 413 })); else chunks.push(chunk); });
        response.on('end', () => resolve({ archive: Buffer.concat(chunks) })); response.on('error', reject);
      });
      request.on('timeout', () => request.destroy(new Error('ZIP download timed out'))); request.on('error', reject); request.end();
    }).catch(failure => { throw Object.assign(new Error(`Could not download ZIP archive: ${failure.message}`), { status: failure.status || 400 }); });
    if (result.archive) return result.archive;
    current = result.redirect;
  }
  throw Object.assign(new Error('ZIP URL redirected too many times'), { status: 400 });
}
async function createServer({ directory = loadConfig().directory, repositoryDirectory, authDatabase = loadConfig().authDatabase, authConfig = null, authConfigFile = null, secureCookies = loadConfig().secureCookies, logger = createLogger({ level: loadConfig().logLevel, fileLevel: loadConfig().fileLogLevel, directory: path.join(__dirname, 'log') }), closeResourcesOnClose = true } = {}) {
  authConfig ||= { provider: 'sqlite', database: authDatabase, secureCookies };
  const keyFile = authConfigFile ? path.join(path.dirname(authConfigFile), 'data', 'phidias.key') : path.join(path.dirname(authDatabase), 'phidias.key');
  const auth = await openAuth(authConfig, { secureCookies, keyFile });
  const store = new Store(directory, repositoryDirectory, { authDatabase, authConfigFile, authProvider: authConfig.provider, databaseCredential: id => auth.databaseCredential(id), applicationKey: async id => { const key = await auth.ensureApplicationKey(id); await auth.flush?.(); return key; } }); await store.init();
  const brokerServer = authConfig.broker?.enabled ? createAuthBroker({ auth, mysqlConfig: authConfig.provider === 'mysql' ? authConfig.mysql : null, logger }) : null;
  const webConsoles = new Map();
  let commandConsoleFactory = null;
  const consoleKey = session => `${session.username}:${session.csrfToken}`;
  const closeWebConsole = session => { const key = consoleKey(session), current = webConsoles.get(key); current?.close(); webConsoles.delete(key); };
  const cleanWebConsoles = () => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [key, current] of webConsoles) if (current.lastUsed < cutoff) { current.close(); webConsoles.delete(key); }
  };
  const webConsole = (session, reset = false) => {
    if (!commandConsoleFactory) throw Object.assign(new Error('The application console is not available.'), { status: 503 });
    cleanWebConsoles();
    const key = consoleKey(session);
    if (reset) closeWebConsole(session);
    if (!webConsoles.has(key)) webConsoles.set(key, new WebConsoleSession(commandConsoleFactory));
    return webConsoles.get(key);
  };
  const projectAccess = async (username, id) => (await Promise.all(['login_rc', 'login_prod', 'view', 'edit', 'promote', 'delete'].map(async permission => [permission, await auth.hasProject(username, id, permission)]))).filter(([, allowed]) => allowed).map(([permission]) => permission);
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
    const send = async (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      requestPath = url.pathname;
      logger.debug('Request received: %s %s', req.method, requestPath);
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return send(403, { error: 'Cross-origin writes are not allowed' });
        const archiveUpload = req.method === 'POST' && url.pathname === '/api/projects/import' && ['application/zip', 'application/octet-stream'].some(type => (req.headers['content-type'] || '').startsWith(type));
        if (!archiveUpload && !(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Send application/json' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const body = await readBody(req);
        const session = await auth.login(body?.username, body?.password, req.socket.remoteAddress);
        await auth.logout(req); // Rotate any existing session on a fresh sign-in.
        res.setHeader('Set-Cookie', auth.cookie(session.token));
        logger.info('User signed in');
        return send(200, { username: session.username, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
      }
      const session = await auth.session(req);
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
        if (url.pathname === '/api/session' && req.method === 'GET') return send(200, { ...session, permissions: { manageUsers: await auth.hasCore(session.username, 'manage_users'), createProjects: await auth.hasCore(session.username, 'create_projects'), console: await auth.hasCore(session.username, 'console') } });
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          closeWebConsole(session);
          await auth.logout(req);
          res.setHeader('Set-Cookie', auth.cookie());
          logger.info('User signed out');
          return send(200, { ok: true });
        }
        if (url.pathname === '/api/console' || url.pathname === '/api/console/reset' || url.pathname === '/api/console/input') {
          await auth.requireCore(session.username, 'console');
          if (url.pathname === '/api/console/reset' && req.method === 'POST') return send(200, webConsole(session, true).snapshot());
          if (url.pathname === '/api/console/input' && req.method === 'POST') return send(200, await webConsole(session).submit((await readBody(req))?.input));
          if (url.pathname === '/api/console' && req.method === 'GET') return send(200, webConsole(session).snapshot());
          if (url.pathname === '/api/console' && req.method === 'DELETE') { closeWebConsole(session); return send(200, { ok: true }); }
          return send(405, { error: 'Method not allowed' });
        }
        const credentialMatch = url.pathname.match(/^\/api\/credentials(?:\/([a-f0-9-]{36}))?$/);
        if (credentialMatch) {
          await auth.requireCore(session.username, 'manage_users');
          const id = credentialMatch[1];
          if (!id && req.method === 'GET') return send(200, await auth.listCredentials());
          if (!id && req.method === 'POST') {
            const credential = await auth.createCredential(await readBody(req));
            logger.info('Credential created by %s: %s (%s)', session.username, credential.id, credential.type);
            return send(201, credential);
          }
          if (id && req.method === 'PUT') {
            const credential = await auth.updateCredential(id, await readBody(req));
            logger.info('Credential updated by %s: %s (%s)', session.username, id, credential.type);
            return send(200, credential);
          }
          if (id && req.method === 'DELETE') {
            const usage = await store.databaseCredentialUsage(id);
            if (usage.length) throw Object.assign(new Error(`This credential is selected by ${usage.map(item => `${item.projectName} ${item.channel} (${item.role} database)`).join(', ')}.`), { status: 409 });
            await auth.deleteCredential(id);
            logger.info('Credential deleted by %s: %s', session.username, id);
            return send(200, { ok: true });
          }
          return send(405, { error: 'Method not allowed' });
        }
        const databaseCredentialMatch = url.pathname.match(/^\/api\/database-credentials(?:\/([a-f0-9-]{36}))?$/);
        if (databaseCredentialMatch) {
          const id = databaseCredentialMatch[1];
          if (!id && req.method === 'GET') return send(200, await auth.listDatabaseCredentials());
          await auth.requireCore(session.username, 'manage_users');
          if (!id && req.method === 'POST') {
            const credential = await auth.createDatabaseCredential(await readBody(req));
            logger.info('Database credential set created by %s: %s', session.username, credential.id);
            return send(201, credential);
          }
          if (id && req.method === 'PUT') {
            const credential = await auth.updateDatabaseCredential(id, await readBody(req));
            logger.info('Database credential set updated by %s: %s', session.username, id);
            return send(200, credential);
          }
          if (id && req.method === 'DELETE') {
            const usage = await store.databaseCredentialUsage(id);
            if (usage.length) throw Object.assign(new Error(`This credential set is selected by ${usage.map(item => `${item.projectName} ${item.channel} (${item.role} database)`).join(', ')}.`), { status: 409 });
            await auth.deleteDatabaseCredential(id);
            logger.info('Database credential set deleted by %s: %s', session.username, id);
            return send(200, { ok: true });
          }
          return send(405, { error: 'Method not allowed' });
        }
        const accessUserMatch = url.pathname.match(/^\/api\/access\/users(?:\/([^/]+)(?:\/(password))?)?$/);
        const accessGroupMatch = url.pathname.match(/^\/api\/access\/groups(?:\/(\d+)(?:\/(members))?)?$/);
        const accessGrantMatch = url.pathname.match(/^\/api\/access\/grants\/(core|projects\/([^/]+))\/(user|group)\/(\d+)$/);
        if (url.pathname === '/api/access' || accessUserMatch || accessGroupMatch || accessGrantMatch) {
          await auth.requireCore(session.username, 'manage_users');
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
              await auth.deleteManagedUser(username); logger.info('User deleted by %s: %s', session.username, username); return send(200, { ok: true });
            }
          }
          if (accessGroupMatch) {
            const [, idText, membersAction] = accessGroupMatch;
            if (!idText && req.method === 'POST') return send(201, { id: await auth.createGroup((await readBody(req))?.name) });
            if (idText && membersAction === 'members' && req.method === 'PUT') { await auth.setGroupMembers(Number(idText), (await readBody(req))?.usernames); return send(200, { ok: true }); }
            if (idText && !membersAction && req.method === 'DELETE') { await auth.deleteGroup(Number(idText)); return send(200, { ok: true }); }
          }
          if (accessGrantMatch && req.method === 'PUT') {
            const [, scopeText, projectId, principalType, principalId] = accessGrantMatch;
            await auth.setGrants(principalType, Number(principalId), scopeText === 'core' ? 'core' : projectId, (await readBody(req))?.permissions);
            return send(200, { ok: true });
          }
          return send(405, { error: 'Method not allowed' });
        }
        if (url.pathname === '/api/projects') {
          if (req.method === 'GET') { const projects = await store.list(); const visible = []; for (const project of projects) if (await auth.hasProject(session.username, project.id, 'view')) visible.push({ ...project, access: await projectAccess(session.username, project.id) }); return send(200, visible); }
          if (req.method === 'POST') {
            await auth.requireCore(session.username, 'create_projects');
            const project = await store.create((await readBody(req))?.name);
            await auth.grantProjectOwner(session.username, project.id);
            logger.info('Project created: %s', project.id);
            return send(201, { ...project, access: await projectAccess(session.username, project.id) });
          }
        }
        if (url.pathname === '/api/projects/import' || url.pathname === '/api/projects/import-url') {
          if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
          await auth.requireCore(session.username, 'create_projects');
          const archive = url.pathname.endsWith('import-url') ? await downloadArchive((await readBody(req))?.url, req.headers.host) : await readArchive(req);
          const project = await store.importArchive(archive);
          await auth.grantProjectOwner(session.username, project.id);
          logger.info('Project imported by %s: %s', session.username, project.id);
          return send(201, { ...project, access: await projectAccess(session.username, project.id) });
        }
        const blockCacheMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/blocks\/cache$/);
        if (blockCacheMatch) {
          const id = blockCacheMatch[1];
          await auth.requireProject(session.username, id, 'edit');
          if (req.method !== 'DELETE') return send(405, { error: 'Method not allowed' });
          const result = await store.clearBlockCache(id);
          logger.info('Block cache cleared by %s for project %s (%d modules)', session.username, id, result.cleared);
          return send(200, { cleared: result.cleared, definitions: [...result.definitions.values()].map(({ execute, ...metadata }) => metadata) });
        }
        const deploymentConfigMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deployment-configs(?:\/(RC|Prod))?$/);
        if (deploymentConfigMatch) {
          const [, id, channel] = deploymentConfigMatch;
          if (!channel && req.method === 'GET') { await auth.requireProject(session.username, id, 'view'); return send(200, await store.deploymentConfigs(id)); }
          if (channel && req.method === 'PUT') {
            await auth.requireProject(session.username, id, 'edit');
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
          if (req.method === 'GET') await auth.requireProject(session.username, id, 'view');
          else await auth.requireProject(session.username, id, 'edit');
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
        const versionCleanupMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/cleanup-rc$/);
        if (versionCleanupMatch) {
          const id = versionCleanupMatch[1];
          if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
          await auth.requireProject(session.username, id, 'edit');
          const result = await store.deleteRCVersionsBefore(id, (await readBody(req))?.beforeRevision);
          logger.info('Old RC revisions deleted: %s (deleted %s; preserved Prod %s)', id, result.deleted.join(',') || 'none', result.skippedProd.join(',') || 'none');
          return send(200, result);
        }
        const versionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions(?:\/(\d+)(?:\/(promote|restore))?)?$/);
        if (versionMatch) {
          const [, id, revisionText, action] = versionMatch;
          if (!revisionText && req.method === 'GET') { await auth.requireProject(session.username, id, 'view'); return send(200, await store.versions(id)); }
          if (!revisionText) return send(405, { error: 'Method not allowed' });
          const revision = Number(revisionText);
          if (req.method === 'POST' && action === 'promote') {
            await auth.requireProject(session.username, id, 'promote');
            const promoted = await store.promote(id, revision);
            logger.info('Project revision promoted: %s (revision %d)', id, revision);
            return send(200, promoted);
          }
          if (req.method === 'POST' && action === 'restore') {
            await auth.requireProject(session.username, id, 'edit');
            const body = await readBody(req);
            const restored = await store.restore(id, revision, body?.revision);
            logger.info('Project revision restored: %s (revision %d as revision %d)', id, revision, restored.revision);
            return send(200, restored);
          }
          if (req.method === 'DELETE' && !action) {
            await auth.requireProject(session.username, id, 'edit');
            const removed = await store.deleteVersion(id, revision);
            logger.info('Project revision deleted: %s (revision %d)', id, revision);
            return send(200, removed);
          }
          return send(405, { error: 'Method not allowed' });
        }
        const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(blocks|export))?$/);
        if (match) {
          const [, id, action] = match;
          if (req.method === 'GET') await auth.requireProject(session.username, id, 'view');
          if (req.method === 'GET' && action === 'blocks') {
            await store.get(id);
            return send(200, [...store.definitions(id).values()].map(({ execute, ...metadata }) => metadata));
          }
          if (req.method === 'GET' && action === 'export') {
            const archive = await store.export(id);
            logger.info('Project exported: %s', id);
            res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="phidias-${id}.zip"` }); return res.end(archive);
          }
          if (req.method === 'GET' && !action) return send(200, { ...(await store.get(id)), access: await projectAccess(session.username, id) });
          if (req.method === 'PUT' && !action) {
            await auth.requireProject(session.username, id, 'edit');
            const body = await readBody(req);
            if (!body || typeof body !== 'object') return send(400, { error: 'Expected a project document' });
            const project = await store.save(id, body);
            logger.info('Project saved: %s (revision %d)', id, project.revision);
            return send(200, project);
          }
          if (req.method === 'DELETE' && !action) {
            await auth.requireProject(session.username, id, 'delete');
            const removed = await store.deleteProject(id); await auth.deleteProjectGrants(id);
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
      res.writeHead(200, { 'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type });
      res.end(type === 'text/html' ? contents.toString().replaceAll('{{APP_VERSION}}', htmlVersion) : contents);
    } catch (error) {
      if (!error.status || error.status >= 500) logger.error('Request failed: %s %s: %s', req.method, requestPath, error.stack || error.message);
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      send(error.status || 500, { error: error.status ? error.message : 'An unexpected server error occurred' });
    }
  });
  server.on('close', () => {
    for (const current of webConsoles.values()) current.close();
    webConsoles.clear();
    if (closeResourcesOnClose) { Promise.resolve(auth.close()).catch(() => {}); logger.info('Server stopped'); }
  });
  return { server, brokerServer, store, auth, setCommandConsoleFactory(factory) {
    for (const current of webConsoles.values()) current.close();
    webConsoles.clear();
    commandConsoleFactory = factory;
  } };
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
    if (state?.dirty() || application?.auth.pendingChanges) logger?.warning('Stopping with unsaved running configuration or accounts');
    logger?.info('Stopping server (%s)', reason);
    terminal?.close();
    if (application) { await Promise.all([closeListener(application.server), application.brokerServer ? closeListener(application.brokerServer) : Promise.resolve()]); await application.auth.close(); }
    logger?.info('Server stopped');
  }
  (async () => {
    const config = loadConfig(undefined, { create: true });
    logger = createLogger({ level: config.logLevel, fileLevel: config.fileLogLevel, directory: path.join(__dirname, 'log'),
      stdout: { write: line => terminal ? terminal.log(line) : process.stdout.write(line) },
      stderr: { write: line => terminal ? terminal.log(line, process.stderr) : process.stderr.write(line) }
    });
    application = await createServer({ directory: config.directory, authDatabase: config.authDatabase, authConfig: config.authConfig, authConfigFile: config.configFile, secureCookies: config.secureCookies, logger, closeResourcesOnClose: false });
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
    const { CommandConsole } = require('./lib/console');
    const consoleStatus = () => {
      const address = application.server.address();
      return `Listener: ${address ? `${address.address}:${address.port}` : 'not listening'}. Storage path changes require a restart.`;
    };
    application.setCommandConsoleFactory(({ ask, write }) => new CommandConsole({
      config: state,
      auth: application.auth,
      logger,
      ask,
      write,
      // Respond to the browser before closing its HTTP connection.
      shutdown: () => { setImmediate(() => shutdown('web console').catch(error => critical('Shutdown failed', error))); },
      status: consoleStatus
    }));
    await listen(application.server, config.host, config.port);
    logger.info('OpacIT Omphalos Phidias v%s: http://%s:%d', version, config.host.includes(':') ? `[${config.host}]` : config.host, config.port);
    if (application.brokerServer) {
      await listen(application.brokerServer, config.document.auth.broker.host, config.document.auth.broker.port);
      logger.info('Authentication broker listening on %s:%d', config.document.auth.broker.host, config.document.auth.broker.port);
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shutdown(signal).catch(error => { critical('Shutdown failed', error); process.exit(1); }); });
    // Process managers such as CubeCoders AMP expose their console through a
    // pipe rather than a TTY. Readline supports both, so attach whenever stdin
    // is available instead of requiring an interactive terminal.
    if (process.stdin && !process.stdin.destroyed && process.stdin.readable !== false) {
      const { Terminal } = require('./lib/terminal');
      terminal = new Terminal();
      const engine = new CommandConsole({ config: state, auth: application.auth, logger,
        ask: (prompt, secret) => terminal.ask(prompt, secret), write: message => terminal.write(message),
        shutdown: () => shutdown('console'),
        status: consoleStatus
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
