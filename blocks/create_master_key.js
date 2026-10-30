'use strict';

const crypto = require('node:crypto');

function createMasterKey() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
  type: 'create_master_key',
  name: 'Create Master Key',
  category: 'Credentials',
  description: 'Creates a cryptographically secure 256-bit master key as raw text. Store this key safely; encrypted data cannot be recovered without it.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'master_key', name: 'Master Key', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, _inputs, setOutput) {
    try {
      setOutput('master_key', createMasterKey());
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('master_key', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  createMasterKey
};
