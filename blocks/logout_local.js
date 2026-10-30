'use strict';

module.exports = {
  type: 'logout_local',
  name: 'Logout Local',
  category: 'Authentication',
  description: 'Revokes the current Application Database browser session.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['logged_out', 'not_logged_in'],
  outputPorts: [
    { id: 'logged_out', name: 'Logged Out', kind: 'action', types: [] },
    { id: 'not_logged_in', name: 'Not Logged In', kind: 'action', types: [] },
    { id: 'userid', name: 'User ID', kind: 'value', types: ['text'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx, _options, _inputs, setOutput) {
    if (!ctx.request) throw new Error('Logout Local requires an HTTP endpoint trigger');
    const authentication = await ctx.localAuthentication();
    const session = await authentication.logout(ctx.request);
    if (ctx.response && !ctx.response.headersSent) {
      const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      ctx.response.setHeader('Set-Cookie', authentication.clearBrowserCookie(secure));
    }
    setOutput('userid', session?.userid || '');
    setOutput('username', session?.username || '');
    return session ? 'logged_out' : 'not_logged_in';
  }
};
