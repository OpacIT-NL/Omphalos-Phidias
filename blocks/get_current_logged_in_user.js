'use strict';
module.exports = {
  type: 'get_current_logged_in_user', name: 'Get Current Logged In User', category: 'Authentication',
  description: 'Gets the username for the current browser session or API bearer token.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['found', 'not_logged_in'],
  outputPorts: [
    { id: 'found', name: 'Found', kind: 'action', types: [] },
    { id: 'not_logged_in', name: 'Not Logged In', kind: 'action', types: [] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'sessionType', label: 'Session type', type: 'select', choices: ['Browser', 'API'], default: 'Browser' }
  ],
  async execute(ctx, options, inputs = {}, setOutput) {
    if (!ctx.request) throw new Error('Get Current Logged In User requires an HTTP endpoint trigger');
    const authentication = ctx.authentication();
    const session = await (options.sessionType === 'API' ? authentication.apiSession(ctx.request, ctx.deployment) : authentication.browserSession(ctx.request, ctx.deployment));
    ctx.setLoggedInUser?.(session);
    setOutput('username', session?.username || '');
    return session ? 'found' : 'not_logged_in';
  }
};
