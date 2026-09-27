'use strict';

function parseHeaders(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('HTTP response headers must be a JSON object'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('HTTP response headers must be an object');
  return Object.fromEntries(Object.entries(value).map(([name, header]) => [name, Array.isArray(header) ? header.map(String) : String(header)]));
}

module.exports = {
  type: 'respond', name: 'HTTP response', category: 'Actions',
  description: 'Send the response to an incoming HTTP request. Body and Headers accept connected values or their configured fallbacks.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'body', name: 'Body', kind: 'value', types: ['text', 'list', 'object', 'number', 'boolean', 'null'] },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object', 'text'] }
  ],
  outputs: [], fields: [
    { key: 'status', label: 'Status code', type: 'number', default: 200, min: 200, max: 599 },
    { key: 'body', label: 'Response body', type: 'text', default: 'Hello from Phidias' },
    { key: 'headers', label: 'Headers (JSON object)', type: 'text', default: '{}' }
  ],
  async execute(ctx, options, inputs = {}) {
    if (!ctx.response) throw new Error('HTTP response requires an HTTP endpoint trigger');
    if (ctx.response.writableEnded) throw new Error('Response already sent');
    const body = Object.hasOwn(inputs, 'body') ? inputs.body : ctx.render(options.body);
    const headers = parseHeaders(Object.hasOwn(inputs, 'headers') ? inputs.headers : ctx.render(options.headers));
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
      headers['content-type'] = body !== null && typeof body === 'object' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    }
    ctx.response.writeHead(Number(options.status), headers);
    ctx.response.end(body !== null && typeof body === 'object' ? JSON.stringify(body) : String(body ?? ''));
  }
};
