'use strict';
module.exports = {
  type: 'check_if_logged_in', name: 'Check If Logged In', category: 'Authentication',
  description: 'Checks whether the current browser request has a valid session cookie.',
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
    if (!ctx.request) throw new Error('Check If Logged In requires an HTTP endpoint trigger');
    const session = ctx.authentication(Object.hasOwn(inputs, 'database') ? inputs.database : ctx.render(options.database)).browserSession(ctx.request);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
