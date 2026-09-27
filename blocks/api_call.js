'use strict';

function parseHeaders(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('HTTP request headers must be a JSON object'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('HTTP request headers must be an object');
  return Object.fromEntries(Object.entries(value).map(([name, header]) => [name, Array.isArray(header) ? header.map(String).join(', ') : String(header)]));
}

module.exports = {
  type: 'request', name: 'HTTP request', category: 'Actions',
  description: 'Fetch a URL. Result status, headers, and body are stored in the selected variable.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object', 'text'] }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'headers', name: 'Response Headers', kind: 'value', types: ['object'] }
  ],
  fields: [
    { key: 'url', label: 'URL', type: 'text', default: 'https://example.com' },
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { key: 'body', label: 'Body (JSON or text)', type: 'text', default: '' },
    { key: 'headers', label: 'Headers (JSON object)', type: 'text', default: '{}' },
    { key: 'variable', label: 'Result variable', type: 'text', default: 'result' }
  ],
  async execute(ctx, options, inputs = {}, setOutput = () => {}) {
    const url = String(ctx.render(options.url));
    if (!/^https?:\/\//i.test(url)) throw new Error('HTTP request URL must use http or https');
    const body = ctx.render(options.body);
    const headers = parseHeaders(Object.hasOwn(inputs, 'headers') ? inputs.headers : ctx.render(options.headers));
    const hasContentType = Object.keys(headers).some(name => name.toLowerCase() === 'content-type');
    if (options.method !== 'GET' && body !== '' && !hasContentType) headers['content-type'] = 'application/json';
    const response = await fetch(url, {
      method: options.method,
      headers,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]),
      ...(options.method !== 'GET' && body !== '' ? { body: typeof body === 'object' ? JSON.stringify(body) : String(body) } : {})
    });
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 1048576) throw new Error('HTTP response exceeds 1 MB');
      chunks.push(Buffer.from(chunk));
    }
    let value = Buffer.concat(chunks).toString();
    try { value = JSON.parse(value); } catch {}
    const responseHeaders = Object.fromEntries(response.headers.entries());
    ctx.vars[options.variable] = { status: response.status, headers: responseHeaders, body: value };
    setOutput('headers', responseHeaders);
    return 'next';
  }
};
