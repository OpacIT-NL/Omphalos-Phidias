'use strict';
module.exports = {
  type: 'check_api_token', name: 'Check API Token', category: 'Authentication',
  description: 'Checks the Bearer token in the current request Authorization header.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'database', name: 'SQLite Database Path', kind: 'value', types: ['text'] }
  ],
  outputs: ['true', 'false'],
  outputPorts: [
    { id: 'true', name: 'True', kind: 'action', types: [] },
    { id: 'false', name: 'False', kind: 'action', types: [] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [{ key: 'database', label: 'SQLite authentication database', type: 'text', default: './data/auth.sqlite' }],
  async execute(ctx, options, inputs = {}, setOutput) {
    if (!ctx.request) throw new Error('Check API Token requires an HTTP endpoint trigger');
    const session = ctx.authentication(Object.hasOwn(inputs, 'database') ? inputs.database : ctx.render(options.database)).apiSession(ctx.request, ctx.deployment);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
