'use strict';

const { renderAuthPage, sendAuthPage } = require('./auth_page.cjs');
function credentials(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return {
    ...body,
    remember: body.remember_me === true || body.remember_me === 'yes'
  };
  const form = new URLSearchParams(String(body || ''));
  return { username: form.get('username') || '', password: form.get('password') || '', remember: form.get('remember_me') === 'yes' };
}
const page = (directory, title, action, error = '', username = '') => renderAuthPage(directory, 'login', { appName: title, action, error, username });
const sendPage = (ctx, status, error = '', username = '', values = {}) => sendAuthPage(ctx, 'login', status, { error, username, ...values });
module.exports = {
  type: 'display_login', name: 'Display Login', category: 'Authentication',
  description: 'Shows a browser login page backed by the authentication database in config.json.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['authenticated'],
  outputPorts: [{ id: 'authenticated', name: 'Already Logged In', kind: 'action', types: [] }],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx) {
    if (!ctx.request || !ctx.response) throw new Error('Display Login requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) return null;
    const authentication = ctx.authentication();
    if (ctx.request.method !== 'POST') {
      const existing = await authentication.browserSession(ctx.request, ctx.deployment);
      if (existing) { ctx.setLoggedInUser?.(existing); return 'authenticated'; }
      ctx.logger?.debug('Browser login required: reason=%s', await authentication.sessionStatus?.(ctx.request, 'browser', ctx.deployment));
      await sendPage(ctx, 200); return null;
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
      await sendPage(ctx, error.status || 401, error.message, values.username);
    }
    return null;
  },
  credentials,
  page,
  sendPage
};
