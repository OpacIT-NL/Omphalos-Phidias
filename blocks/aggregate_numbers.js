'use strict';
const { aggregateNumbers } = require('./math_helpers.cjs');

module.exports = {
  type: 'aggregate_numbers', name: 'Aggregate Numbers', category: 'Math',
  description: 'Calculates count, sum, average, minimum, maximum, median, range, variance, and standard deviation from JSON or a list.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'values', name: 'Values / JSON', kind: 'value', types: ['text', 'object', 'list'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] },
    ...['count', 'sum', 'average', 'minimum', 'maximum', 'median', 'range', 'variance', 'standard_deviation'].map(id => ({ id, name: id.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join(' '), kind: 'value', types: ['number'] })),
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'field_path', label: 'Value Field Path (blank = all numeric values)', type: 'text', default: '' },
    { key: 'invalid_values', label: 'Invalid Values', type: 'select', choices: ['Ignore', 'Zero', 'Error'], default: 'Ignore' },
    { key: 'variance_type', label: 'Variance Type', type: 'select', choices: ['Population', 'Sample'], default: 'Population' },
    { key: 'rounding', label: 'Rounding', type: 'select', choices: ['None', 'Decimal Places', 'Significant Digits', 'Floor', 'Ceiling', 'Truncate'], default: 'None' },
    { key: 'decimal_places', label: 'Decimal Places / Significant Digits', type: 'number', min: 0, max: 12, default: 2 }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      const result = aggregateNumbers(inputs.values, options); for (const [key, value] of Object.entries(result)) setOutput(key, value);
      setOutput('error_message', ''); return 'success';
    } catch (error) { setOutput('error_message', error.message); return 'error'; }
  },
  aggregateNumbers
};
