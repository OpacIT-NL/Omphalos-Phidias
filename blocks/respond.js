module.exports = {
  type: 'respond', name: 'HTTP response', category: 'Actions',
  description: 'Send the response to an incoming HTTP request. Objects are sent as JSON.',
  outputs: [], fields: [
    { key: 'status', label: 'Status code', type: 'number', default: 200, min: 200, max: 599 },
    { key: 'body', label: 'Response body', type: 'text', default: 'Hello from Phidias' }
  ],
  async execute(ctx, options) {
    if (!ctx.response) throw new Error('HTTP response requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) throw new Error('Response already sent');
    const body = ctx.render(options.body);
    ctx.response.writeHead(Number(options.status), { 'content-type': typeof body === 'object' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
    ctx.response.end(typeof body === 'object' ? JSON.stringify(body) : String(body));
  }
};
