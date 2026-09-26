module.exports = {
  type: 'request', name: 'HTTP request', category: 'Actions',
  description: 'Fetch a URL. Result is available as {{vars.result.status}} and {{vars.result.body}}.',
  outputs: ['next'], fields: [
    { key: 'url', label: 'URL', type: 'text', default: 'https://example.com' },
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { key: 'body', label: 'Body (JSON or text)', type: 'text', default: '' },
    { key: 'variable', label: 'Result variable', type: 'text', default: 'result' }
  ],
  async execute(ctx, options) {
    const url = String(ctx.render(options.url));
    if (!/^https?:\/\//i.test(url)) throw new Error('HTTP request URL must use http or https');
    const body = ctx.render(options.body);
    const response = await fetch(url, {
      method: options.method, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]),
      ...(options.method !== 'GET' && body !== '' ? { body: typeof body === 'object' ? JSON.stringify(body) : String(body), headers: { 'content-type': 'application/json' } } : {})
    });
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 1048576) throw new Error('HTTP response exceeds 1 MB');
      chunks.push(Buffer.from(chunk));
    }
    let value = Buffer.concat(chunks).toString();
    try { value = JSON.parse(value); } catch {}
    ctx.vars[options.variable] = { status: response.status, body: value };
    return 'next';
  }
};
