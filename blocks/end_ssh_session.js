'use strict';

module.exports = {
  type: 'end_ssh_session', name: 'End SSH Session', category: 'System',
  description: 'Ends every active SSH console session connected to the deployed application.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['next'],
  outputPorts: [{ id: 'next', name: 'Action', kind: 'action', types: [] }],
  fields: [],
  async execute(ctx) {
    if (typeof ctx.endSSHSessions !== 'function') throw new Error('SSH session control is unavailable in this runtime');
    ctx.endSSHSessions();
    return 'next';
  }
};
