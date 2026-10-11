'use strict';

module.exports = {
  type: 'form_submit', name: 'Form Submit', category: 'Triggers',
  description: 'Starts a workflow when a form with the same ID is submitted. Form Data is a safely parsed JSON object.',
  trigger: 'form_submit', inputPorts: [],
  fields: [{ key: 'form_id', label: 'Form ID', type: 'text', default: 'my_form' }],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'form_data', name: 'Form Data', kind: 'value', types: ['object'] },
    { id: 'form_id', name: 'Form ID', kind: 'value', types: ['text'] }
  ]
};
