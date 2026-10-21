'use strict';

const { renderAuthPage, sendAuthPage } = require('./auth_page.cjs');

function fields(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      username: body.username || '', password: body.password || '', confirmPassword: body.confirm_password || '', email: body.email || '',
      acceptTerms: body.accept_terms === true || body.accept_terms === 'yes',
      acceptPrivacy: body.accept_privacy === true || body.accept_privacy === 'yes'
    };
  }
  const form = new URLSearchParams(String(body || ''));
  return {
    username: form.get('username') || '', password: form.get('password') || '', confirmPassword: form.get('confirm_password') || '', email: form.get('email') || '',
    acceptTerms: form.get('accept_terms') === 'yes', acceptPrivacy: form.get('accept_privacy') === 'yes'
  };
}

const page = (directory, title, action, error = '', values = {}) => renderAuthPage(directory, 'register', { appName: title, action, error, ...values });

module.exports = {
  type: 'register_local_account',
  name: 'Register Local Account',
  category: 'Authentication',
  description: 'Shows a registration form and creates an enabled Application Database users row with an Argon2id password hash and allow_login set to 1.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['registered'],
  outputPorts: [
    { id: 'registered', name: 'Registered', kind: 'action', types: [] },
    { id: 'userid', name: 'User ID', kind: 'value', types: ['text'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] },
    { id: 'email', name: 'Email', kind: 'value', types: ['text'] }
  ],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx, _options, _inputs, setOutput) {
    if (!ctx.request || !ctx.response) throw new Error('Register Local Account requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) return null;
    const authentication = await ctx.localAuthentication();
    if (ctx.request.method !== 'POST') {
      const existing = await authentication.browserSession(ctx.request);
      if (existing) {
        ctx.setLoggedInUser?.(existing);
        setOutput('userid', existing.userid);
        setOutput('username', existing.username);
        setOutput('email', existing.email || '');
        return 'registered';
      }
      await sendAuthPage(ctx, 'register', 200);
      return null;
    }

    const values = fields(ctx.request.body);
    try {
      const session = await authentication.register(values, ctx.request.ip);
      ctx.setLoggedInUser?.(session);
      const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      ctx.response.writeHead(303, { location: ctx.request.path, 'set-cookie': authentication.browserCookie(session.token, secure), 'cache-control': 'no-store' });
      ctx.response.end();
    } catch (error) {
      if (error.retryAfter) ctx.response.setHeader('Retry-After', String(error.retryAfter));
      if (!error.status) ctx.logger?.error('Local account registration failed: %s', error?.stack || error);
      await sendAuthPage(ctx, 'register', error.status || 500, {
        error: error.status ? error.message : 'Registration is unavailable.', username: values.username, email: values.email
      });
    }
    return null;
  },
  fieldsFromBody: fields,
  page
};
