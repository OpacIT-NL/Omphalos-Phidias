'use strict';

const { credentials, sendPage } = require('./display_login');

module.exports = {
  type: 'login_local',
  name: 'Login Local',
  category: 'Authentication',
  description: 'Shows a browser login page and verifies an Argon2id password against the Application Database users table. Optional remembered sessions persist in its sessions table.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['authenticated'],
  outputPorts: [{ id: 'authenticated', name: 'Already Logged In', kind: 'action', types: [] }],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx) {
    if (!ctx.request || !ctx.response) throw new Error('Login Local requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) return null;
    const authentication = await ctx.localAuthentication();
    if (ctx.request.method !== 'POST') {
      const existing = await authentication.browserSession(ctx.request);
      if (existing) {
        ctx.setLoggedInUser?.(existing);
        if (existing.remembered && !ctx.response.headersSent) {
          const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
          ctx.response.setHeader('Set-Cookie', authentication.browserCookie(authentication.browserToken(ctx.request), secure, true));
        }
        return 'authenticated';
      }
      ctx.logger?.debug('Local browser login required: reason=%s', authentication.sessionStatus(ctx.request));
      await sendPage(ctx, 200, '', '', { localLogin: true });
      return null;
    }

    const values = credentials(ctx.request.body);
    try {
      const session = await authentication.login(values.username, values.password, ctx.request.ip, values.remember);
      ctx.setLoggedInUser?.(session);
      const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      ctx.response.writeHead(303, { location: ctx.request.path, 'set-cookie': authentication.browserCookie(session.token, secure, session.remembered), 'cache-control': 'no-store' });
      ctx.response.end();
    } catch (error) {
      if (error.retryAfter) ctx.response.setHeader('Retry-After', String(error.retryAfter));
      if (!error.status) ctx.logger?.error('Local authentication failed: %s', error?.stack || error);
      await sendPage(ctx, error.status || 500, error.status ? error.message : 'Local authentication is unavailable.', values.username, {
        localLogin: true, remember: values.remember
      });
    }
    return null;
  }
};
