'use strict';
const { percentage, round } = require('./math_helpers.cjs');

module.exports = {
  type: 'percentage_calculator', name: 'Percentage Calculator', category: 'Math',
  description: 'Calculates percentages, percentage changes, and percentage-based increases or decreases.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'value', name: 'Value / Percentage', kind: 'value', types: ['number', 'text', 'unspecified'], required: true },
    { id: 'reference', name: 'Reference', kind: 'value', types: ['number', 'text', 'unspecified'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'result', name: 'Result', kind: 'value', types: ['number'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'calculation', label: 'Calculation', type: 'select', choices: ['Value as Percentage of Reference', 'Percentage of Reference', 'Increase Reference by Percentage', 'Decrease Reference by Percentage', 'Percentage Change', 'Percentage Point Difference'], default: 'Value as Percentage of Reference' },
    { key: 'rounding', label: 'Rounding', type: 'select', choices: ['None', 'Decimal Places', 'Significant Digits', 'Floor', 'Ceiling', 'Truncate'], default: 'Decimal Places' },
    { key: 'decimal_places', label: 'Decimal Places / Significant Digits', type: 'number', min: 0, max: 12, default: 2 }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try { setOutput('result', round(percentage(inputs.value, inputs.reference, options.calculation), options.rounding, options.decimal_places)); setOutput('error_message', ''); return 'success'; }
    catch (error) { setOutput('result', null); setOutput('error_message', error.message); return 'error'; }
  },
  percentage
};
