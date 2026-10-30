module.exports = {
  type: 'http', name: 'HTTP endpoint', category: 'Triggers',
  description: 'Receives a request. Path contains the complete requested URL path, Query contains its query parameters, and Body contains text or parsed JSON.',
  trigger: 'http', outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'path', name: 'Path', kind: 'value', types: ['text'] },
    { id: 'query', name: 'Query', kind: 'value', types: ['object'] },
    { id: 'body', name: 'Body', kind: 'value', types: ['text', 'object'] },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object'] }
  ],
  fields: [
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'], default: 'GET' },
    { key: 'path', label: 'Path', type: 'text', default: '/hello' }
  ]
};
