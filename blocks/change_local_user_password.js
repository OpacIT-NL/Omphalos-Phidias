'use strict';

const { sendAuthPage } = require('./auth_page.cjs');

function fields(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      username: body.username || '',
      currentPassword: body.current_password || '',
      newPassword: body.new_password || '',
      confirmNewPassword: body.confirm_new_password || ''
    };
  }
  const form = new URLSearchParams(String(body || ''));
  return {
    username: form.get('username') || '',
    currentPassword: form.get('current_password') || '',
    newPassword: form.get('new_password') || '',
    confirmNewPassword: form.get('confirm_new_password') || ''
  };
}

module.exports = {
  type: 'change_local_user_password',
  name: 'Change Local User Password',
  category: 'Authentication',
  description: 'Shows a password change form, verifies the current password, and updates the Application Database user with a new Argon2id password hash.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['changed'],
  outputPorts: [
    { id: 'changed', name: 'Password Changed', kind: 'action', types: [] },
    { id: 'userid', name: 'User ID', kind: 'value', types: ['text'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx, _options, _inputs, setOutput) {
    if (!ctx.request || !ctx.response) throw new Error('Change Local User Password requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) return null;
    if (ctx.request.method !== 'POST') {
      await sendAuthPage(ctx, 'changePassword', 200);
      return null;
    }

    const values = fields(ctx.request.body);
    try {
      const authentication = await ctx.localAuthentication();
      const user = await authentication.changePassword(values, ctx.request.ip);
      setOutput('userid', user.userid);
      setOutput('username', user.username);
      return 'changed';
    } catch (error) {
      if (error.retryAfter) ctx.response.setHeader('Retry-After', String(error.retryAfter));
      if (!error.status) ctx.logger?.error('Local password change failed: %s', error?.stack || error);
      await sendAuthPage(ctx, 'changePassword', error.status || 500, {
        error: error.status ? error.message : 'Password change is unavailable.',
        username: values.username
      });
      return null;
    }
  },
  fieldsFromBody: fields
};
