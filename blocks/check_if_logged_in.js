'use strict';
module.exports = {
  type: 'check_if_logged_in', name: 'Check If Logged In', category: 'Authentication',
  description: 'Checks whether the current browser request has a valid session cookie.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['true', 'false'],
  outputPorts: [
    { id: 'true', name: 'True', kind: 'action', types: [] },
    { id: 'false', name: 'False', kind: 'action', types: [] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [{ key: 'database', label: 'SQLite authentication database', type: 'text', default: './data/auth.sqlite' }],
  async execute(ctx, options, _inputs, setOutput) {
    if (!ctx.request) throw new Error('Check If Logged In requires an HTTP endpoint trigger');
    const session = ctx.authentication(ctx.render(options.database)).browserSession(ctx.request);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
