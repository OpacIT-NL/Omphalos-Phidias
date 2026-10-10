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
  fields: [],
  async execute(ctx, options, inputs, setOutput) {
    if (!ctx.request) throw new Error('Check API Token requires an HTTP endpoint trigger');
    const authentication = ctx.authentication();
    const session = await authentication.apiSession(ctx.request, ctx.deployment);
    if (!session) ctx.logger?.debug('API session rejected: reason=%s', await authentication.sessionStatus?.(ctx.request, 'api', ctx.deployment));
    ctx.setLoggedInUser?.(session);
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
