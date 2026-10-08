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
  fields: [],
  async execute(ctx, options, inputs, setOutput) {
    if (!ctx.request) throw new Error('Check If Logged In requires an HTTP endpoint trigger');
    const session = ctx.authentication().browserSession(ctx.request, ctx.deployment);
    ctx.setLoggedInUser?.(session);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
