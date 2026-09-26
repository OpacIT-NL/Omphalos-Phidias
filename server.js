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
const assets = new Map([['/', ['index.html', 'text/html']], ['/login', ['login.html', 'text/html']], ['/login.js', ['login.js', 'text/javascript']], ['/editor.js', ['editor.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
async function createServer({ directory = loadConfig().directory, authDatabase = loadConfig().authDatabase, secureCookies = loadConfig().secureCookies, logger = createLogger({ level: loadConfig().logLevel }), closeResourcesOnClose = true } = {}) {
  const store = new Store(directory); await store.init();
  const auth = new Auth(authDatabase, { secureCookies });
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
      if (url.pathname.startsWith('/api/')) {
        if (!session) return send(401, { error: 'Sign in to continue.' });
        if (!['GET', 'HEAD'].includes(req.method)) auth.checkCSRF(req, session);
        if (url.pathname === '/api/session' && req.method === 'GET') return send(200, session);
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          auth.logout(req);
          res.setHeader('Set-Cookie', auth.cookie());
          logger.info('User signed out');
          return send(200, { ok: true });
        }
        if (url.pathname === '/api/projects') {
          if (req.method === 'GET') return send(200, await store.list());
          if (req.method === 'POST') {
            const project = await store.create((await readBody(req))?.name);
            logger.info('Project created: %s', project.id);
            return send(201, project);
          }
        }
        const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(blocks|export))?$/);
        if (match) {
          const [, id, action] = match;
          if (req.method === 'GET' && action === 'blocks') {
            await store.get(id);
            return send(200, [...store.definitions(id).values()].map(({ execute, ...metadata }) => metadata));
          }
          if (req.method === 'GET' && action === 'export') {
            const archive = await store.export(id);
            logger.info('Project exported: %s', id);
            res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="phidias-${id}.zip"` }); return res.end(archive);
          }
          if (req.method === 'GET' && !action) return send(200, await store.get(id));
          if (req.method === 'PUT' && !action) {
            const body = await readBody(req);
            if (!body || typeof body !== 'object') return send(400, { error: 'Expected a project document' });
            const project = await store.save(id, body);
            logger.info('Project saved: %s (revision %d)', id, project.revision);
            return send(200, project);
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
    try { (logger || createLogger({ level: 0 })).critical('%s: %s', message, error?.stack || error); }
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
    logger = createLogger({ level: config.logLevel,
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
