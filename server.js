'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Auth } = require('./lib/auth');
const { loadConfig } = require('./lib/config');
const { Store } = require('./lib/store');
const { readBody } = require('./runtime/app');
const { version } = require('./package.json');
const htmlVersion = version.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const assets = new Map([['/', ['index.html', 'text/html']], ['/login', ['login.html', 'text/html']], ['/login.js', ['login.js', 'text/javascript']], ['/editor.js', ['editor.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
async function createServer({ directory = process.env.PROJECTS_DIR || path.join(__dirname, 'projects'), authDatabase = loadConfig().authDatabase, secureCookies = loadConfig().secureCookies } = {}) {
  const store = new Store(directory); await store.init();
  const auth = new Auth(authDatabase, { secureCookies });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return send(403, { error: 'Cross-origin writes are not allowed' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Send application/json' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const body = await readBody(req);
        const session = await auth.login(body?.username, body?.password, req.socket.remoteAddress);
        auth.logout(req); // Rotate any existing session on a fresh sign-in.
        res.setHeader('Set-Cookie', auth.cookie(session.token));
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
          return send(200, { ok: true });
        }
        if (url.pathname === '/api/projects') {
          if (req.method === 'GET') return send(200, await store.list());
          if (req.method === 'POST') return send(201, await store.create((await readBody(req))?.name));
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
            res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="phidias-${id}.zip"` }); return res.end(archive);
          }
          if (req.method === 'GET' && !action) return send(200, await store.get(id));
          if (req.method === 'PUT' && !action) {
            const body = await readBody(req);
            if (!body || typeof body !== 'object') return send(400, { error: 'Expected a project document' });
            return send(200, await store.save(id, body));
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
      if (!error.status) console.error(error);
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      send(error.status || 500, { error: error.status ? error.message : 'An unexpected server error occurred' });
    }
  });
  server.on('close', () => auth.close());
  return { server, store, auth };
}
if (require.main === module) {
  const { port } = loadConfig();
  createServer().then(({ server }) => {
    server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`OpacIT Omphalos Phidias v${version}: http://${process.env.HOST || '127.0.0.1'}:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeIdleConnections(); });
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { createServer };
