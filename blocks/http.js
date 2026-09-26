module.exports = {
  type: 'http', name: 'HTTP endpoint', category: 'Triggers',
  description: 'Receives a request. Use {{request.body}}, {{request.query.key}}, or {{request.method}}.',
  trigger: 'http', outputs: ['next'], fields: [
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { key: 'path', label: 'Path', type: 'text', default: '/hello' }
  ]
};
