'use strict';
function credentials(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  try { return JSON.parse(String(body || '')); } catch {}
  const form = new URLSearchParams(String(body || ''));
  return { username: form.get('username') || '', password: form.get('password') || '' };
}
module.exports = {
  type: 'login_through_api', name: 'Login Through API', category: 'Authentication',
  description: 'Validates credentials and creates an API bearer token.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'database', name: 'SQLite Database Path', kind: 'value', types: ['text'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] },
    { id: 'password', name: 'Password', kind: 'value', types: ['text'] }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'bearer_token', name: 'Bearer Token', kind: 'value', types: ['text'] },
    { id: 'authorization', name: 'Authorization Header', kind: 'value', types: ['text'] },
    { id: 'result', name: 'Login Result', kind: 'value', types: ['object'] },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [{ key: 'database', label: 'SQLite authentication database', type: 'text', default: './data/auth.sqlite' }],
  async execute(ctx, options, inputs = {}, setOutput) {
    if (!ctx.request) throw new Error('Login Through API requires an HTTP endpoint trigger');
    const body = credentials(ctx.request.body);
    const username = Object.hasOwn(inputs, 'username') ? inputs.username : body.username;
    const password = Object.hasOwn(inputs, 'password') ? inputs.password : body.password;
    try {
      const database = Object.hasOwn(inputs, 'database') ? inputs.database : ctx.render(options.database);
      const session = await ctx.authentication(database).login(username, password, 'api', ctx.request.ip);
      const result = { token: session.token, token_type: 'Bearer', username: session.username, expires_at: session.expiresAt };
      setOutput('bearer_token', session.token); setOutput('authorization', `Bearer ${session.token}`);
      setOutput('result', result); setOutput('username', session.username); setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('bearer_token', ''); setOutput('authorization', ''); setOutput('result', null);
      setOutput('username', ''); setOutput('error_message', error.message);
      return 'error';
    }
  }
};
