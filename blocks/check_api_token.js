'use strict';
module.exports = {
  type: 'check_api_token', name: 'Check API Token', category: 'Authentication',
  description: 'Checks the Bearer token in the current request Authorization header.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['true', 'false'],
  outputPorts: [
    { id: 'true', name: 'True', kind: 'action', types: [] },
    { id: 'false', name: 'False', kind: 'action', types: [] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [{ key: 'database', label: 'SQLite authentication database', type: 'text', default: './data/auth.sqlite' }],
  async execute(ctx, options, _inputs, setOutput) {
    if (!ctx.request) throw new Error('Check API Token requires an HTTP endpoint trigger');
    const session = ctx.authentication(ctx.render(options.database)).apiSession(ctx.request);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
