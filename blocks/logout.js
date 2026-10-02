'use strict';
module.exports = {
  type: 'logout', name: 'Logout', category: 'Authentication',
  description: 'Revokes the current browser session or API bearer token.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'database', name: 'SQLite Database Path', kind: 'value', types: ['text'] }
  ],
  outputs: ['logged_out', 'not_logged_in'],
  outputPorts: [
    { id: 'logged_out', name: 'Logged Out', kind: 'action', types: [] },
    { id: 'not_logged_in', name: 'Not Logged In', kind: 'action', types: [] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'database', label: 'SQLite authentication database', type: 'text', default: './data/auth.sqlite' },
    { key: 'sessionType', label: 'Session type', type: 'select', choices: ['Browser', 'API'], default: 'Browser' }
  ],
  async execute(ctx, options, inputs = {}, setOutput) {
    if (!ctx.request) throw new Error('Logout requires an HTTP endpoint trigger');
    const database = Object.hasOwn(inputs, 'database') ? inputs.database : ctx.render(options.database);
    const authentication = ctx.authentication(database);
    const kind = options.sessionType === 'API' ? 'api' : 'browser';
    const session = authentication.logout(ctx.request, kind);
    if (kind === 'browser' && ctx.response && !ctx.response.headersSent) {
      const secure = String(ctx.request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      ctx.response.setHeader('Set-Cookie', authentication.clearBrowserCookie(secure));
    }
    setOutput('username', session?.username || '');
    return session ? 'logged_out' : 'not_logged_in';
  }
};
