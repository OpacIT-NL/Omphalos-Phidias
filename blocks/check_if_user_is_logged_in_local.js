'use strict';

module.exports = {
  type: 'check_if_user_is_logged_in_local',
  name: 'Check If User Is Logged In Local',
  category: 'Authentication',
  description: 'Checks the current Application Database browser session and returns the users.id and username values.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['true', 'false'],
  outputPorts: [
    { id: 'true', name: 'True', kind: 'action', types: [] },
    { id: 'false', name: 'False', kind: 'action', types: [] },
    { id: 'userid', name: 'User ID', kind: 'value', types: ['text'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [],
  requiresHttpContext: true,
  async execute(ctx, _options, _inputs, setOutput) {
    if (!ctx.request) throw new Error('Check If User Is Logged In Local requires an HTTP endpoint trigger');
    const authentication = await ctx.localAuthentication();
    const session = authentication.browserSession(ctx.request);
    if (!session) ctx.logger?.debug('Local browser session rejected: reason=%s', authentication.sessionStatus(ctx.request));
    ctx.setLoggedInUser?.(session);
    setOutput('userid', session?.userid || '');
    setOutput('username', session?.username || '');
    return session ? 'true' : 'false';
  }
};
