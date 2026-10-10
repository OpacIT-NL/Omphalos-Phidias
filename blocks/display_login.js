'use strict';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function credentials(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  const form = new URLSearchParams(String(body || ''));
  return { username: form.get('username') || '', password: form.get('password') || '' };
}
function page(title, action, error = '', username = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)} · Sign in</title><link rel="icon" href="/favicon.ico" sizes="any"><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#111821;color:#e8edf5}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:radial-gradient(circle at top,#253243 0,#111821 48%)}main{width:min(380px,calc(100% - 32px));padding:28px;border:1px solid #344254;border-radius:12px;background:#18212c;box-shadow:0 22px 60px #0008}.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:#7fe0ba;color:#10241d;font-size:23px;font-weight:900}.brand strong,.brand span{display:block}.brand span{margin-top:2px;color:#91a0b2;font-size:12px}h1{margin:0 0 18px;font-size:20px}label{display:grid;gap:6px;margin:13px 0;color:#b7c1ce;font-size:12px;font-weight:700}input{width:100%;height:42px;border:1px solid #415064;border-radius:7px;padding:0 12px;background:#101720;color:#f4f7fb;font:inherit}input:focus{outline:2px solid #58b994;border-color:#58b994}button{width:100%;height:42px;margin-top:9px;border:0;border-radius:7px;background:#70d7ad;color:#10241d;font-weight:800;cursor:pointer}p{margin:0 0 14px;border:1px solid #a94b5a;border-radius:6px;padding:9px;background:#3b2027;color:#ffd8de;font-size:12px}</style></head>
<body><main><div class="brand"><span class="mark">P</span><span><strong>OpacIT Omphalos</strong><span>Phidias · ${escapeHTML(title)}</span></span></div><h1>Sign in</h1>${error ? `<p role="alert">${escapeHTML(error)}</p>` : ''}<form method="post" action="${escapeHTML(action)}"><label>Username<input name="username" value="${escapeHTML(username)}" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}
function sendPage(ctx, status, error = '', username = '') {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
  ctx.response.writeHead(status, headers);
  ctx.response.end(page(ctx.appName || 'Application', ctx.request.path, error, username));
}
module.exports = {
  type: 'display_login', name: 'Display Login', category: 'Authentication',
  description: 'Shows a browser login page backed by the authentication database in config.json.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['authenticated'],
  outputPorts: [{ id: 'authenticated', name: 'Already Logged In', kind: 'action', types: [] }],
  fields: [],
  async execute(ctx) {
    if (!ctx.request || !ctx.response) throw new Error('Display Login requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) return null;
    const authentication = ctx.authentication();
    if (ctx.request.method !== 'POST') {
      const existing = await authentication.browserSession(ctx.request, ctx.deployment);
      if (existing) { ctx.setLoggedInUser?.(existing); return 'authenticated'; }
      ctx.logger?.debug('Browser login required: reason=%s', await authentication.sessionStatus?.(ctx.request, 'browser', ctx.deployment));
      sendPage(ctx, 200); return null;
    }
    const values = credentials(ctx.request.body);
    try {
      const session = await authentication.login(values.username, values.password, 'browser', ctx.request.ip, ctx.deployment);
      ctx.setLoggedInUser?.(session);
      const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      ctx.response.writeHead(303, { location: ctx.request.path, 'set-cookie': authentication.browserCookie(session.token, secure), 'cache-control': 'no-store' });
      ctx.response.end();
    } catch (error) {
      if (error.retryAfter) ctx.response.setHeader('Retry-After', String(error.retryAfter));
      sendPage(ctx, error.status || 401, error.message, values.username);
    }
    return null;
  }
};
