'use strict';

module.exports = {
  type: 'restart_app', name: 'Restart App', category: 'System',
  description: 'Gracefully restarts and reloads the exported automation application.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: [],
  outputPorts: [],
  fields: [],
  async execute(ctx) {
    ctx.controlApplication('restart');
    return null;
  }
};
