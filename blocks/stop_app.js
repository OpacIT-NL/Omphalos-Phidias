'use strict';

module.exports = {
  type: 'stop_app', name: 'Stop App', category: 'System',
  description: 'Gracefully stops the exported automation application.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: [],
  outputPorts: [],
  fields: [],
  async execute(ctx) {
    ctx.controlApplication('stop');
    return null;
  }
};
