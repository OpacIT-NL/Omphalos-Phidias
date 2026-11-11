'use strict';

const definition = {
  type: 'browser_api_reply',
  name: 'Browser API Reply',
  category: 'Triggers',
  description: 'Starts a workflow when Browser API Request sends a supplier response back with the same Request ID. Value Passthrough retrieves text, lists, or objects temporarily stored in the browser cookie. Connect HTTP response to display HTML or redirect the browser; without it, the callback is acknowledged automatically.',
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
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'] },
    { id: 'passthrough', name: 'Value Passthrough', kind: 'value', types: ['text', 'object', 'list'] }
  ]
};

function createBatchDefinition(count) {
  if (![2, 3].includes(count)) throw new Error('Browser API Reply batch size must be 2 or 3');
  const outputPorts = [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'responses', name: 'Complete Responses', kind: 'value', types: ['list'] }
  ];
  for (let index = 1; index <= count; index++) outputPorts.push(
    { id: `response${index}`, name: `Complete Response ${index}`, kind: 'value', types: ['object'] },
    { id: `body${index}`, name: `Response Body ${index}`, kind: 'value', types: ['text', 'object', 'list', 'number', 'unspecified'] },
    { id: `status${index}`, name: `HTTP Status ${index}`, kind: 'value', types: ['number'] },
    { id: `headers${index}`, name: `Response Headers ${index}`, kind: 'value', types: ['object'] },
    { id: `error_message${index}`, name: `Error Message ${index}`, kind: 'value', types: ['text'] }
  );
  outputPorts.push(
    { id: 'error_message', name: 'Combined Error Message', kind: 'value', types: ['text'] },
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'] },
    { id: 'passthrough', name: 'Value Passthrough', kind: 'value', types: ['text', 'object', 'list'] }
  );
  return {
    type: `browser_api_reply_${count}x`,
    name: `Browser API Reply ${count}x`,
    category: 'Triggers',
    description: `Starts one workflow after a Browser API Request ${count}x batch and exposes all ${count} responses separately.`,
    trigger: 'browser_api_reply',
    browserAPIBatchSize: count,
    inputPorts: [],
    fields: [{ key: 'request_id', label: 'Request ID', type: 'text', default: 'browser_request' }],
    outputs: ['success', 'error'],
    outputPorts
  };
}

module.exports = definition;
module.exports.createBatchDefinition = createBatchDefinition;
