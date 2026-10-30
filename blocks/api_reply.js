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
  description: 'Respond to an HTTP endpoint, Form Submit, or Browser API Reply. Browser API Reply displays HTML responses and navigates for redirects. Body and Headers accept connected values or their configured fallbacks.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'body', name: 'Body', kind: 'value', types: ['text', 'list', 'object', 'number', 'boolean', 'null'] },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object', 'text'] }
  ],
  outputs: [], fields: [
    { key: 'status', label: 'Status code', type: 'number', default: 200, min: 200, max: 599 },
    { key: 'format', label: 'Reply format', type: 'select', choices: ['JSON', 'HTML', 'Text', 'Auto'], default: 'JSON' },
    { key: 'body', label: 'Response body', type: 'text', default: 'Hello from Phidias' },
    { key: 'headers', label: 'Headers (JSON object)', type: 'text', default: '{}' }
  ],
  requiresHttpContext: true,
  async execute(ctx, options, inputs = {}) {
    if (!ctx.response) throw new Error('HTTP response requires an HTTP endpoint, Form Submit, or Browser API Reply trigger');
    if (ctx.response.writableEnded) throw new Error('Response already sent');
    const body = Object.hasOwn(inputs, 'body') ? inputs.body : ctx.render(options.body);
    const headers = parseHeaders(Object.hasOwn(inputs, 'headers') ? inputs.headers : ctx.render(options.headers));
    const locationKey = Object.keys(headers).find(name => name.toLowerCase() === 'location');
    if (ctx.request?.browserAPIRequestID && [301, 302, 303, 307, 308].includes(Number(options.status)) && locationKey) {
      // Let the browser navigate directly instead of following a redirect inside fetch.
      headers['x-phidias-redirect'] = headers[locationKey];
      delete headers[locationKey];
      ctx.response.writeHead(200, headers);
      ctx.response.end();
      return;
    }
    const format = options.format || 'Auto';
    const resolvedFormat = format === 'Auto' ? (body !== null && typeof body === 'object' ? 'JSON' : 'Text') : format;
    const contentTypes = { JSON: 'application/json; charset=utf-8', HTML: 'text/html; charset=utf-8', Text: 'text/plain; charset=utf-8' };
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = contentTypes[resolvedFormat];
    let payload;
    if (resolvedFormat === 'JSON') {
      if (typeof body === 'string') {
        try { JSON.parse(body); payload = body; } catch { payload = JSON.stringify(body); }
      } else payload = JSON.stringify(body);
    } else payload = String(body ?? '');
    ctx.response.writeHead(Number(options.status), headers);
    ctx.response.end(payload);
  }
};
