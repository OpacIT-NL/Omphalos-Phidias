'use strict';

module.exports = {
  type: 'get_sub_endpoint_by_name',
  name: 'Get sub-endpoint by name',
  category: 'HTTP',
  description: 'Gets the part of the request path after the matched HTTP endpoint.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'sub_endpoint', name: 'Sub-endpoint', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, _inputs, setOutput) {
    if (!ctx.request) throw new Error('Get sub-endpoint by name requires an HTTP endpoint trigger');
    setOutput('sub_endpoint', ctx.request.subpath || '/');
    return 'next';
  }
};
