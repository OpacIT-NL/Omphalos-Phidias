module.exports = {
  type: 'http', name: 'HTTP endpoint', category: 'Triggers',
  description: 'Receives a request. The Body output contains text or parsed JSON; use {{request.query.key}} or {{request.method}} for request details.',
  trigger: 'http', outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'body', name: 'Body', kind: 'value', types: ['string', 'object'] }
  ],
  fields: [
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { key: 'path', label: 'Path', type: 'text', default: '/hello' }
  ]
};
