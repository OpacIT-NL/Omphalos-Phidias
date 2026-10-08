'use strict';
const { calculate, round } = require('./math_helpers.cjs');

module.exports = {
  type: 'math_operation', name: 'Math Operation', category: 'Math',
  description: 'Performs arithmetic on two connected numbers.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'a', name: 'Number A', kind: 'value', types: ['number', 'text', 'unspecified'], required: true },
    { id: 'b', name: 'Number B', kind: 'value', types: ['number', 'text', 'unspecified'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'result', name: 'Result', kind: 'value', types: ['number'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'operation', label: 'Operation', type: 'select', choices: ['Add', 'Subtract', 'Multiply', 'Divide', 'Modulo', 'Power', 'Minimum', 'Maximum'], default: 'Add' },
    { key: 'rounding', label: 'Rounding', type: 'select', choices: ['None', 'Decimal Places', 'Significant Digits', 'Floor', 'Ceiling', 'Truncate'], default: 'None' },
    { key: 'decimal_places', label: 'Decimal Places / Significant Digits', type: 'number', min: 0, max: 12, default: 2 }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try { setOutput('result', round(calculate(inputs.a, inputs.b, options.operation), options.rounding, options.decimal_places)); setOutput('error_message', ''); return 'success'; }
    catch (error) { setOutput('result', null); setOutput('error_message', error.message); return 'error'; }
  },
  calculate
};
