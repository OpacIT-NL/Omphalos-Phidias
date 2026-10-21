'use strict';

module.exports = {
  type: 'browser_api_reply',
  name: 'Browser API Reply',
  category: 'Triggers',
  description: 'Starts a workflow when Browser API Request sends a supplier response back with the same Request ID. Connect HTTP response to display HTML or redirect the browser; without it, the callback is acknowledged automatically.',
  trigger: 'browser_api_reply',
  inputPorts: [],
  fields: [{ key: 'request_id', label: 'Request ID', type: 'text', default: 'browser_request' }],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Successful Response', kind: 'action', types: [] },
    { id: 'error', name: 'Failed Request', kind: 'action', types: [] },
    { id: 'response', name: 'Complete Response', kind: 'value', types: ['object'] },
    { id: 'body', name: 'Response Body', kind: 'value', types: ['text', 'object', 'list', 'number', 'unspecified'] },
    { id: 'status', name: 'HTTP Status', kind: 'value', types: ['number'] },
    { id: 'headers', name: 'Response Headers', kind: 'value', types: ['object'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] },
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'] }
  ]
};
